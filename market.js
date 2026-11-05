/* global state, esc, Engine, $, showTab, renderComps, cf, stat, mult, usdm, isDead, bigRegion, splitBuyers, percentile, dealOf, toast */
// Market heat map: which segments are hot, what is being bought right now, by whom and at what multiples.
// Momentum compares a segment's SHARE of all deals in the last 12 months with its share in the 24 months before,
// so it isn't distorted by how many deals a given export happens to contain per year.

const mk = { dim: 'tags', region: '', buyer: '', sort: 'heat', min: 8, open: null };
const MONTH = 30.44 * 864e5;
const segmentsOf = (t, dim) => dim === 'industry' ? [t.industry].filter(Boolean)
  : dim === 'country' ? [t.country].filter(Boolean)
  : String(t.tags || '').split(/,\s*/).filter(x => x && !/^(software development|enterprise software as a service \(saas\))$/i.test(x));

// Financial or strategic buyer, from the CRM's type where the buyer is known, otherwise from the name.
function buyerTypeIndex() {
  const m = new Map();
  for (const c of state.companies) { if (c.role) m.set(Engine.normName(c.name), c.role); for (const a of c.aliases || []) m.set(Engine.normName(a), c.role); }
  return name => m.get(Engine.normName(name)) || Engine.guessRole({ name });
}

function marketData() {
  const deals = state.transactions.filter(t => t.date && !isDead(t) && (!mk.region || bigRegion(t) === mk.region));
  if (!deals.length) return null;
  const end = Math.max(...deals.map(t => Date.parse(t.date)).filter(Boolean));
  const ago = t => (end - Date.parse(t.date)) / MONTH;
  const L12 = deals.filter(t => ago(t) < 12), P24 = deals.filter(t => ago(t) >= 12 && ago(t) < 36);
  const typeOf = buyerTypeIndex();
  const isFin = t => splitBuyers(t.buyer).some(b => typeOf(b) === 'Investor');
  const endYear = new Date(end).getUTCFullYear(), years = Array.from({ length: 8 }, (_, i) => endYear - 7 + i);
  const perYear = Object.fromEntries(years.map(y => [y, 0]));
  deals.forEach(t => { if (t.year in perYear) perYear[t.year]++; });
  const seg = new Map();
  const get = k => { if (!seg.has(k)) seg.set(k, { k, L: [], P: [], years: Object.fromEntries(years.map(y => [y, 0])), all: [] }); return seg.get(k); };
  for (const t of deals) {
    const a = ago(t);
    for (const k of new Set(segmentsOf(t, mk.dim))) {
      const s = get(k);
      s.all.push(t);
      if (t.year in s.years) s.years[t.year]++;
      if (a < 12) s.L.push(t); else if (a < 36) s.P.push(t);
    }
  }
  const rows = [...seg.values()].filter(s => s.L.length + s.P.length >= mk.min).map(s => {
    const shareL = s.L.length / Math.max(1, L12.length), shareP = s.P.length / Math.max(1, P24.length);
    const momentum = shareP > 0 ? shareL / shareP - 1 : s.L.length >= 3 ? 1 : 0;
    const recent = [...s.L, ...s.P];
    const finShare = s.L.length ? s.L.filter(isFin).length / s.L.length : null;
    const buyers = [...s.L.flatMap(t => splitBuyers(t.buyer)).reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
    // Heat: momentum weighted by volume, so a big segment that's growing beats a tiny one that doubled.
    const heat = momentum * Math.log2(1 + s.L.length);
    return { ...s, shareL, shareP, momentum, heat, finShare, buyers,
      evr: stat(recent.map(t => t.ev_revenue).filter(x => x != null)), eve: stat(recent.map(t => t.ev_ebitda).filter(x => x != null)),
      size: percentile(recent.map(t => t.deal_value).filter(x => x > 0), 0.5) };
  });
  const by = { heat: (a, b) => b.heat - a.heat, momentum: (a, b) => b.momentum - a.momentum, volume: (a, b) => b.L.length - a.L.length, evr: (a, b) => (b.evr.median ?? -1) - (a.evr.median ?? -1), pe: (a, b) => (b.finShare ?? -1) - (a.finShare ?? -1) };
  rows.sort(by[mk.sort] || by.heat);
  const finL = L12.filter(isFin).length, finP = P24.filter(isFin).length;
  const finYear = years.map(y => { const ys = deals.filter(t => t.year === y); return { y, n: ys.length, fin: ys.length ? ys.filter(isFin).length / ys.length : 0 }; });
  const allBuyers = [...L12.flatMap(t => splitBuyers(t.buyer)).reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return { deals, end, L12, P24, rows, years, perYear, finL: finL / Math.max(1, L12.length), finP: finP / Math.max(1, P24.length), finYear, allBuyers, typeOf,
    evrL: stat(L12.map(t => t.ev_revenue).filter(x => x != null)), evrP: stat(P24.map(t => t.ev_revenue).filter(x => x != null)) };
}

const heatBadge = m => m >= 0.35 ? '<span class="heat-badge hot">🔥 Hot</span>' : m >= 0.1 ? '<span class="heat-badge up">↗ Rising</span>' : m <= -0.25 ? '<span class="heat-badge down">↘ Cooling</span>' : '<span class="heat-badge flat">→ Stable</span>';
const pctTxt = x => (x == null ? '–' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);
const monthName = ms => new Date(ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

// Project keywords against the market: how is each live mandate's space doing?
function projectPulse(d) {
  return (state.projects || []).map(p => {
    const prof = dealOf(p), kws = String(prof.keywords || '').split(/[;,]/).map(s => s.trim().toLowerCase()).filter(s => s.length > 2);
    if (!kws.length) return null;
    const hit = t => { const x = ' ' + [t.tags, t.industry, t.description].join(' ').toLowerCase() + ' '; return kws.some(k => x.includes(k)); };
    const L = d.L12.filter(hit), P = d.P24.filter(hit);
    const m = P.length ? (L.length / d.L12.length) / (P.length / d.P24.length) - 1 : 0;
    return { name: p.name, L: L.length, P: P.length, m, evr: stat([...L, ...P].map(t => t.ev_revenue).filter(x => x != null)), buyers: [...L.flatMap(t => splitBuyers(t.buyer)).reduce((mm, b) => mm.set(b, (mm.get(b) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }).filter(Boolean);
}

function segmentDetail(s, d) {
  const crm = new Map(state.companies.map(c => [Engine.normName(c.name), c]));
  const q = [];
  for (let i = 11; i >= 0; i--) q.push(s.all.filter(t => { const a = (d.end - Date.parse(t.date)) / MONTH; return a >= i * 3 && a < (i + 1) * 3; }).length);
  const qmax = Math.max(1, ...q);
  const recent = [...s.L].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  return `<tr class="mk-detail"><td colspan="${d.years.length + 9}"><div class="mk-d">
    <div><h3 style="margin-top:0">${esc(s.k)} ${heatBadge(s.momentum)}</h3>
      <div class="small muted">Deals per quarter, last 3 years</div>
      <div class="mk-q">${q.map((n, i) => `<i style="height:${Math.round((n / qmax) * 100)}%" title="${n} deals"></i>`).join('')}</div>
      <p class="small">${s.L.length} deals in the last 12 months (${(s.shareL * 100).toFixed(1)}% of all deals) vs ${s.P.length} in the 24 months before (${(s.shareP * 100).toFixed(1)}%).
        ${s.finShare != null ? `Financial buyers: ${Math.round(s.finShare * 100)}% (market ${Math.round(d.finL * 100)}%).` : ''}
        Median EV/Revenue ${mult(s.evr.median)} (n=${s.evr.n}), EV/EBITDA ${mult(s.eve.median)} (n=${s.eve.n}), median deal ${usdm(s.size)}.</p>
      <button class="btn sm" data-mk="comps" data-k="${esc(s.k)}">Open these deals in Comps</button></div>
    <div><h3 style="margin-top:0">Who's buying (last 12 months)</h3>${s.buyers.slice(0, 8).map(([b, n]) => { const c = crm.get(Engine.normName(b)); return `<div class="buyer-row"><span>${esc(b)}</span>${d.typeOf(b) === 'Investor' ? '<span class="chip role-Investor">Financial</span>' : ''}${c ? `<button class="chip blue" data-open="${c.id}">in CRM</button>` : ''}<span class="muted small">${n}</span></div>`; }).join('') || '<p class="muted small">No deals in the last 12 months.</p>'}</div>
    <div><h3 style="margin-top:0">Latest deals</h3>${recent.map(t => `<div class="mk-deal"><span class="muted small">${esc(t.date)}</span> <b>${esc(t.target)}</b> <span class="small">← ${esc(splitBuyers(t.buyer)[0] || '')}</span>${t.deal_value ? ` <span class="muted small">${usdm(t.deal_value)}</span>` : ''}${t.ev_revenue ? ` <span class="chip">${mult(t.ev_revenue)}</span>` : ''}</div>`).join('')}</div>
  </div></td></tr>`;
}

function renderMarket() {
  const el = $('#marketView');
  if (!el) return;
  const d = marketData();
  if (!d) { el.innerHTML = `<div class="page-head"><div><h1>Market heat map</h1></div></div><div class="empty">Import transactions under <b>Data &amp; sources</b> first.</div>`; return; }
  const rows = d.rows.slice(0, 40);
  if (mk.open && !rows.some(r => r.k === mk.open)) { const r = d.rows.find(x => x.k === mk.open); if (r) rows.unshift(r); }
  const regions = [...new Set(state.transactions.map(bigRegion))].sort();
  const yearMax = r => Math.max(1e-9, ...d.years.map(y => r.years[y] / Math.max(1, d.perYear[y])));
  const hot = [...d.rows].filter(r => r.L.length >= 10 && r.momentum > 0).sort((a, b) => b.heat - a.heat).slice(0, 6);
  const cool = [...d.rows].filter(r => r.P.length >= 15 && r.momentum < 0).sort((a, b) => a.heat - b.heat).slice(0, 4);
  const pulse = projectPulse(d);
  const th = (k, label) => `<th class="num sortable ${mk.sort === k ? 'on' : ''}" data-mksort="${k}">${label}${mk.sort === k ? ' ↓' : ''}</th>`;
  el.innerHTML = `<div class="page-head"><div><h1>Market heat map</h1><div class="muted">${d.deals.length.toLocaleString()} deals · latest ${monthName(d.end)} · last 12 months vs the 24 months before</div></div>
      <div class="actions"><select id="mkDim"><option value="tags" ${mk.dim === 'tags' ? 'selected' : ''}>By topic (S&P tags)</option><option value="industry" ${mk.dim === 'industry' ? 'selected' : ''}>By industry</option><option value="country" ${mk.dim === 'country' ? 'selected' : ''}>By target country</option></select>
        <select id="mkRegion"><option value="">All regions</option>${regions.map(r => `<option ${r === mk.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        <label class="row-label small">Min. deals <input id="mkMin" value="${mk.min}" style="width:46px"></label></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k">Deals, last 12 months</div><div class="v">${d.L12.length.toLocaleString()}</div><div class="muted small">${d.P24.length.toLocaleString()} in the 24 months before</div></div>
      <div class="kpi"><div class="k">Median EV/Revenue</div><div class="v">${mult(d.evrL.median)}</div><div class="muted small">was ${mult(d.evrP.median)} · n=${d.evrL.n}</div></div>
      <div class="kpi"><div class="k">Financial buyers</div><div class="v">${Math.round(d.finL * 100)}%</div><div class="muted small">was ${Math.round(d.finP * 100)}% · rest strategic</div></div>
      <div class="kpi"><div class="k">Hottest now</div>${(() => { const h = hot.find(r => r.L.length >= 25) || hot[0]; return `<div class="v" style="font-size:18px">${esc(h?.k || '–')}</div><div class="muted small">${h ? `${h.L.length} deals · share ${pctTxt(h.momentum)}` : ''}</div>`; })()}</div>
    </div>
    <div class="mk-grid">
      <div class="card"><h2>🔥 What's hot</h2>${hot.map(r => `<div class="mk-line" data-mkopen="${esc(r.k)}"><b>${esc(r.k)}</b><span class="ok">${pctTxt(r.momentum)}</span><span class="muted small">${r.L.length} deals · ${mult(r.evr.median)}</span></div>`).join('')}</div>
      <div class="card"><h2>↘ Cooling</h2>${cool.map(r => `<div class="mk-line" data-mkopen="${esc(r.k)}"><b>${esc(r.k)}</b><span class="err">${pctTxt(r.momentum)}</span><span class="muted small">${r.L.length} deals</span></div>`).join('')}
        <h2 style="margin-top:14px">Most active buyers (12 months)</h2>${d.allBuyers.slice(0, 8).map(([b, n]) => `<div class="buyer-row"><span>${esc(b)}</span>${d.typeOf(b) === 'Investor' ? '<span class="chip role-Investor">Financial</span>' : ''}<span class="muted small">${n}</span></div>`).join('')}</div>
      <div class="card"><h2>Your mandates in the market</h2>${pulse.length ? pulse.map(p => `<div class="mk-pulse"><div><b>${esc(p.name)}</b> ${heatBadge(p.m)}</div><div class="small">${p.L} deals in the space last 12 months (${p.P} in the 24 before) · median ${mult(p.evr.median)} EV/Rev</div>${p.buyers.length ? `<div class="small muted">Active: ${p.buyers.map(([b]) => esc(b)).join(', ')}</div>` : ''}</div>`).join('') : '<p class="muted small">Add keywords to a project\'s deal profile to see how its market is moving.</p>'}
        <h2 style="margin-top:14px">Strategic vs financial</h2><div class="mk-fin">${(() => { const top = Math.max(0.01, ...d.finYear.map(y => y.fin)); return d.finYear.map(y => `<div title="${y.y}: ${Math.round(y.fin * 100)}% financial of ${y.n} deals"><b>${Math.round(y.fin * 100)}%</b><i style="height:${Math.round((y.fin / top) * 100)}%"></i><span>${String(y.y).slice(2)}</span></div>`).join(''); })()}</div><div class="muted small">Share of deals with a financial buyer (PE / funds), per year.</div></div>
    </div>
    <div class="table-wrap"><table class="data heat"><thead><tr><th>${mk.dim === 'tags' ? 'Topic' : mk.dim === 'industry' ? 'Industry' : 'Country'}</th><th>Trend</th>
        ${d.years.map(y => `<th class="num">${y}${y === d.years[d.years.length - 1] ? '*' : ''}</th>`).join('')}
        ${th('volume', '12m deals')}${th('heat', 'Heat')}${th('momentum', 'Momentum')}${th('pe', 'PE share')}${th('evr', 'EV/Rev')}<th class="num">Deal size</th><th>Top buyers (12m)</th></tr></thead><tbody>
      ${rows.map(r => { const mx = yearMax(r); return `<tr class="mk-row ${mk.open === r.k ? 'open' : ''}" data-mkopen="${esc(r.k)}"><td><b>${esc(r.k)}</b></td><td>${heatBadge(r.momentum)}</td>
        ${d.years.map(y => { const share = r.years[y] / Math.max(1, d.perYear[y]), v = share / mx; return `<td class="num hc" style="background:rgba(240,68,56,${(v * 0.62).toFixed(2)})" title="${y}: ${r.years[y]} deals, ${(share * 100).toFixed(1)}% of all deals">${r.years[y] || ''}</td>`; }).join('')}
        <td class="num">${r.L.length}</td><td class="num"><b>${r.heat.toFixed(1)}</b></td><td class="num ${r.momentum > 0.05 ? 'ok' : r.momentum < -0.05 ? 'err' : ''}">${pctTxt(r.momentum)}</td><td class="num">${r.finShare == null ? '–' : Math.round(r.finShare * 100) + '%'}</td>
        <td class="num" title="n=${r.evr.n}">${r.evr.n >= 3 ? mult(r.evr.median) : '–'}</td><td class="num">${usdm(r.size)}</td><td class="small">${esc(r.buyers.slice(0, 3).map(([b]) => b).join(', '))}</td></tr>${mk.open === r.k ? segmentDetail(r, d) : ''}`; }).join('')}
    </tbody></table></div>
    <p class="muted small">Cells: deals per year, coloured by the segment's share of that year's deals (darker = bigger share for this row), so years with more data in your exports don't distort the picture. * = year to date. Momentum = change in share of all deals, last 12 months vs the 24 months before. Heat = momentum × log₂(1 + deals in the last 12 months), so growth in a big segment counts more than in a tiny one. 🔥 Hot ≥ +35%, ↗ Rising ≥ +10%, ↘ Cooling ≤ −25%. Multiples and deal size: last 36 months. Click a row for buyers and latest deals.</p>`;
}

document.addEventListener('click', e => {
  if (!e.target.closest('#marketView') || e.target.closest('[data-open]')) return;
  const sort = e.target.closest('[data-mksort]')?.dataset.mksort;
  if (sort) { mk.sort = sort; return renderMarket(); }
  const go = e.target.closest('[data-mk="comps"]');
  if (go) {
    Object.assign(cf, { q: '', industry: '', limit: 200, open: null });
    if (mk.dim === 'industry') cf.industry = go.dataset.k; else cf.q = go.dataset.k;
    return showTab('comps');
  }
  const open = e.target.closest('[data-mkopen]')?.dataset.mkopen;
  if (open != null && !e.target.closest('.mk-detail')) { mk.open = mk.open === open ? null : open; renderMarket(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'mkDim') { mk.dim = t.value; mk.open = null; renderMarket(); }
  if (t.id === 'mkRegion') { mk.region = t.value; renderMarket(); }
  if (t.id === 'mkMin') { mk.min = Math.max(1, parseInt(t.value, 10) || 8); renderMarket(); }
});
