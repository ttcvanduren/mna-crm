/* global clip, state, esc, $, Engine, Enricher, Taxonomy, clsEditorHtml, applyClsChange, toast, today, eur, mult, usdm, stat, percentile, med, isDead, txRegion, EUROPE, splitBuyers, compareTx, phrasesOf, words, FX, crmIndex, txDetail, renderComps, cf, dealOf, buyerTypeIndex, XLSX, perEmployee */
// Comp set builder: value one company against the transactions database. The target comes from its website (Claude) or the CRM,
// filters and single deals can be included or excluded, and the result exports as PDF slides or an Excel workbook.

const CS_KEY = 'mna-crm-compset';
const CS_SECTIONS = [['title', 'Title slide'], ['summary', 'Valuation summary'], ['charts', 'Multiples charts'], ['time', 'Over time & buyers'], ['table', 'Comparable transactions'], ['method', 'Filters & methodology']];
const csFresh = () => ({
  target: { name: '', website: '', description: '', tags: [], sector: '', subsector: '', country: '', business_model: '', customers: '', revenue: null, arr: null, ebitda: null, growth: null, employees: null },
  f: { years: 8, region: '', n: 30, minFit: 30, minSize: '', maxSize: '', buyer: 'all', done: false, minority: false, needMult: true, noMined: false, trim: true, must: '', exclude: '' },
  pin: [], exc: [], methods: { rev: true, arr: true, ebitda: true }, adj: 0, sections: Object.fromEntries(CS_SECTIONS.map(([k]) => [k, true])), open: null, sort: 'fit',
});
let cs = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(CS_KEY) || 'null'), d = csFresh();
    if (s?.target) return { ...d, ...s, target: { ...d.target, ...s.target }, f: { ...d.f, ...s.f }, methods: { ...d.methods, ...s.methods }, sections: { ...d.sections, ...s.sections } };
  } catch { /* private window or blocked storage */ }
  return csFresh();
})();
// The same builder also runs inside a pitch (pitch.js): csUse(ctx, pitchState) points it at the pitch's own state and container.
let csCtx = null, csOwn = null;
function csUse(ctx, st) {
  if (ctx) { if (!csCtx) csOwn = cs; cs = st; csCtx = ctx; } else if (csCtx) { cs = csOwn; csCtx = null; }
}
const csSave = () => { if (csCtx) return csCtx.save(); try { localStorage.setItem(CS_KEY, JSON.stringify(cs)); } catch { /* not critical */ } };
const csTerms = s => String(s || '').toLowerCase().split(/[;,]+/).map(x => x.trim()).filter(Boolean);
const csTxText = t => [t.target, t.description, t.tags, t.industry, t.summary].join(' ').toLowerCase();

// ---------- Ranking (cached: only recomputed when the target or a filter changes) ----------
let csMemo = { sig: null };
let csRegionList = null;
function csRegions() {
  csRegionList ??= ['Europe', ...[...new Set(state.transactions.map(txRegion).filter(Boolean))].sort()];
  return csRegionList;
}
function csRegionOk(t, r) {
  if (!r) return true;
  if (r === 'same') return !cs.target.country || String(t.country || '').toLowerCase().includes(cs.target.country.toLowerCase());
  return r === 'Europe' ? EUROPE.has(txRegion(t)) : txRegion(t) === r;
}
function csRanked() {
  const T = cs.target, f = cs.f;
  const sig = JSON.stringify([T.description, T.tags, T.sector, T.subsector, T.cls_industry, T.cls_sector, T.cls_subsector, T.niche, T.country, T.revenue, T.arr, T.employees, f.years, f.region, f.minSize, f.maxSize, f.buyer, f.done, f.minority, f.needMult, f.noMined, f.must, f.exclude, state.transactions.length]);
  if (csMemo.sig === sig) return csMemo;
  const kw = T.tags.join('; ');
  const profile = { revenue: T.revenue || T.arr, employees: T.employees, country: T.country, keywords: kw, description: T.description };
  const prep = { phrases: phrasesOf([kw, T.subsector].filter(Boolean).join('; ')), words: words([T.description, kw, T.sector, T.subsector].join(' ')), segments: phrasesOf([T.sector, T.subsector].filter(Boolean).join('/')),
    path: Engine.dealPath({ ...profile, sector: T.sector, subsector: T.subsector, tags: T.tags, cls_industry: T.cls_industry, cls_sector: T.cls_sector, cls_subsector: T.cls_subsector, niche: T.niche }) };
  const minYear = f.years ? new Date().getFullYear() - Number(f.years) + 1 : 0;
  const must = csTerms(f.must), not = csTerms(f.exclude);
  const typeOf = f.buyer !== 'all' ? csIndex().typeOf : null;
  const size = t => t.deal_value ?? t.ev;
  const pool = state.transactions.filter(t => {
    if (isDead(t) || (f.done && !/complet|closed|effective/i.test(t.status || ''))) return false;
    if (!f.minority && /minority/i.test(t.type || '')) return false;
    if (f.needMult && !t.ev_revenue && !t.ev_ebitda) return false;
    if (f.noMined && t.mult_src) return false;
    if (minYear && t.year && t.year < minYear) return false;
    if (!csRegionOk(t, f.region)) return false;
    if (f.minSize !== '' && !(size(t) >= +f.minSize)) return false;
    if (f.maxSize !== '' && !(size(t) <= +f.maxSize)) return false;
    if (must.length || not.length) { const x = csTxText(t); if (must.length && !must.some(w => x.includes(w))) return false; if (not.some(w => x.includes(w))) return false; }
    if (typeOf) { const fin = splitBuyers(t.buyer).some(b => typeOf(b) === 'Investor'); if ((f.buyer === 'financial') !== fin) return false; }
    return true;
  });
  const ranked = pool.map(t => compareTx(profile, t, prep)).sort((a, b) => b.score - a.score);
  csMemo = { sig, ranked, profile, prep, pool: pool.length, byKey: new Map(ranked.map(r => [r.t.key, r])) };
  return csMemo;
}
const csScore = (k, m) => m.byKey.get(k) || (t => (t ? compareTx(m.profile, t, m.prep) : null))(state.transactions.find(x => x.key === k));

function csFence(vals) {
  if (vals.length < 8) return [-Infinity, Infinity];
  const q1 = percentile(vals, 0.25), q3 = percentile(vals, 0.75), d = (q3 - q1) * 1.5;
  return [q1 - d, q3 + d];
}

// The comp set: pinned deals + the best matches above the fit threshold, minus excluded deals.
function csSelection() {
  const m = csRanked(), exc = new Set(cs.exc), pin = new Set(cs.pin);
  const pinned = cs.pin.map(k => csScore(k, m)).filter(Boolean).map(x => ({ ...x, pinned: true }));
  const auto = m.ranked.filter(x => x.score >= cs.f.minFit && !exc.has(x.t.key) && !pin.has(x.t.key)).slice(0, Math.max(1, Number(cs.f.n) || 30)).map(x => ({ ...x }));
  const used = [...pinned, ...auto];
  const [rl, rh] = cs.f.trim ? csFence(used.map(x => x.t.ev_revenue).filter(v => v != null)) : [-Infinity, Infinity];
  const [el, eh] = cs.f.trim ? csFence(used.map(x => x.t.ev_ebitda).filter(v => v != null)) : [-Infinity, Infinity];
  for (const x of used) {
    x.outR = x.t.ev_revenue != null && (x.t.ev_revenue < rl || x.t.ev_revenue > rh);
    x.outE = x.t.ev_ebitda != null && (x.t.ev_ebitda < el || x.t.ev_ebitda > eh);
  }
  const rev = stat(used.filter(x => !x.outR && x.t.ev_revenue != null).map(x => x.t.ev_revenue));
  const ebitda = stat(used.filter(x => !x.outE && x.t.ev_ebitda != null).map(x => x.t.ev_ebitda));
  const usedKeys = new Set(used.map(x => x.t.key)), next = [];
  for (const x of m.ranked) { if (next.length >= 15) break; if (!usedKeys.has(x.t.key) && !exc.has(x.t.key)) next.push(x); }
  const excluded = cs.exc.map(k => csScore(k, m)).filter(Boolean);

  const T = cs.target, factor = 1 + (Number(cs.adj) || 0) / 100, methods = [];
  if (T.revenue > 0 && rev.n >= 3) methods.push({ k: 'rev', label: 'EV / Revenue × revenue', short: 'EV/Revenue', metric: T.revenue, s: rev });
  if (T.arr > 0 && rev.n >= 3) methods.push({ k: 'arr', label: 'EV / Revenue × ARR', short: 'EV/ARR', metric: T.arr, s: rev });
  if (T.ebitda > 0 && ebitda.n >= 3) methods.push({ k: 'ebitda', label: 'EV / EBITDA × EBITDA', short: 'EV/EBITDA', metric: T.ebitda, s: ebitda });
  // Revenue and EBITDA per employee in the comparable deals (USD k); without revenue, a headcount implies one (EUR m).
  const pe = perEmployee(used.map(x => x.t));
  const impliedRev = !(T.revenue > 0) && !(T.arr > 0) && T.employees > 0 && pe.rev.n >= 3 ? Math.round(((T.employees * pe.rev.median) / 1000 / FX.EUR) * 10) / 10 : null;
  if (impliedRev && rev.n >= 3) methods.push({ k: 'emp', label: `EV / Revenue × revenue implied by ${Engine.fmt(T.employees)} employees (€${Engine.fmt(impliedRev)}m)`, short: 'EV/Rev (headcount)', metric: impliedRev, s: rev });
  for (const x of methods) { x.on = cs.methods[x.k] !== false; x.range = [x.s.p25, x.s.median, x.s.p75].map(q => q * factor * x.metric); }
  const on = methods.filter(x => x.on);
  const blend = on.length ? [0, 1, 2].map(i => on.reduce((a, x) => a + x.range[i], 0) / on.length) : null;
  return { m, used, rev, ebitda, next, excluded, methods, blend, factor, pe, impliedRev };
}

const CS_SORT = {
  fit: (a, b) => b.score - a.score, date: (a, b) => String(b.t.date || '').localeCompare(String(a.t.date || '')),
  size: (a, b) => (b.t.deal_value ?? -1) - (a.t.deal_value ?? -1), evr: (a, b) => (b.t.ev_revenue ?? -1) - (a.t.ev_revenue ?? -1), eve: (a, b) => (b.t.ev_ebitda ?? -1) - (a.t.ev_ebitda ?? -1),
};
const csSorted = used => [...used].sort(CS_SORT[cs.sort] || CS_SORT.fit);

// ---------- Charts (plain SVG with fixed colours, so they look the same on screen, in the PDF and in print) ----------
const CC = { blue: '#1d4ed8', soft: '#c7d2fe', grey: '#98a2b3', faint: '#eef0f3', line: '#d0d5dd', text: '#14181f', muted: '#667085', red: '#b42318', amber: '#dc6803', green: '#067647' };
const svgOpen = (w, h) => `<svg class="cs-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="11">`;
const yStep = max => (max <= 6 ? 1 : max <= 15 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20);

// Multiple (y) against deal size (x, log scale). Included deals filled, others hollow; median line and the target's implied EV.
function csScatter(pts, { w = 560, h = 300, refY = null, refX = null, refXLabel = 'target', yLabel = 'EV / Revenue', click = false } = {}) {
  const P = pts.filter(p => p.x > 0 && p.y > 0);
  if (P.length < 3) return '<div class="empty small">Not enough deals with both a deal value and a multiple.</div>';
  const L = 40, R = 26, T = 12, B = 34, iw = w - L - R, ih = h - T - B;
  const lx = P.map(p => Math.log10(p.x));
  let x0 = Math.floor(Math.min(...lx)), x1 = Math.ceil(Math.max(...lx));
  if (refX > 0) { x0 = Math.min(x0, Math.floor(Math.log10(refX))); x1 = Math.max(x1, Math.ceil(Math.log10(refX))); }
  if (x1 === x0) x1++;
  const yMax = Math.max(2, Math.ceil(percentile(P.map(p => p.y), 0.95) * 1.15));
  const sx = v => L + ((Math.log10(v) - x0) / (x1 - x0)) * iw, sy = v => T + ih - (Math.min(v, yMax) / yMax) * ih;
  let out = svgOpen(w, h);
  for (let y = 0; y <= yMax; y += yStep(yMax)) out += `<line x1="${L}" x2="${w - R}" y1="${sy(y)}" y2="${sy(y)}" stroke="${CC.faint}"/><text x="${L - 6}" y="${sy(y) + 4}" text-anchor="end" fill="${CC.muted}">${y}x</text>`;
  for (let k = x0; k <= x1; k++) out += `<line x1="${sx(10 ** k)}" x2="${sx(10 ** k)}" y1="${T}" y2="${T + ih}" stroke="${CC.faint}"/><text x="${sx(10 ** k)}" y="${h - B + 16}" text-anchor="middle" fill="${CC.muted}">$${usdm(10 ** k)}</text>`;
  out += `<text x="${L + iw / 2}" y="${h - 4}" text-anchor="middle" fill="${CC.muted}">Deal value (USD, log scale)</text><text x="12" y="${T + ih / 2}" transform="rotate(-90 12 ${T + ih / 2})" text-anchor="middle" fill="${CC.muted}">${esc(yLabel)}</text>`;
  for (const p of [...P].sort((a, b) => a.on - b.on)) {
    const clipped = p.y > yMax;
    out += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.on ? 4.5 : 3.5}" fill="${p.on ? (p.out ? CC.amber : CC.blue) : '#fff'}" fill-opacity="${p.on ? 0.8 : 1}" stroke="${clipped ? CC.red : p.on ? (p.out ? CC.amber : CC.blue) : CC.grey}" ${click && p.key ? `data-cs-pt="${esc(p.key)}" style="cursor:pointer"` : ''}><title>${esc(p.label)}${clipped ? ' (above the chart)' : ''}</title></circle>`;
  }
  if (refY > 0) out += `<line x1="${L}" x2="${w - R}" y1="${sy(refY)}" y2="${sy(refY)}" stroke="${CC.blue}" stroke-dasharray="5 4"/><text x="${w - R - 2}" y="${sy(refY) - 5}" text-anchor="end" fill="${CC.blue}" font-weight="600">median ${mult(refY)}</text>`;
  if (refX > 0) out += `<line x1="${sx(refX)}" x2="${sx(refX)}" y1="${T}" y2="${T + ih}" stroke="${CC.green}" stroke-dasharray="5 4"/><text x="${sx(refX) + 4}" y="${T + 11}" fill="${CC.green}" font-weight="600">${esc(refXLabel)}</text>`;
  return out + '</svg>';
}

// Distribution of a multiple in buckets, with the median marked.
function csHist(vals, { w = 560, h = 230, step = 1, max = 12, label = 'EV / Revenue' } = {}) {
  if (vals.length < 3) return '<div class="empty small">Not enough multiples.</div>';
  const nb = Math.round(max / step) + 1, counts = Array(nb).fill(0);
  for (const v of vals) counts[Math.min(nb - 1, Math.floor(v / step))]++;
  const L = 14, R = 14, T = 18, B = 34, iw = w - L - R, ih = h - T - B, bw = iw / nb, top = Math.max(...counts);
  const m = med(vals);
  let out = svgOpen(w, h);
  counts.forEach((c, i) => {
    const bh = (c / top) * ih, x = L + i * bw;
    out += `<rect x="${x + 2}" y="${T + ih - bh}" width="${bw - 4}" height="${bh}" rx="2" fill="${m >= i * step && m < (i + 1) * step ? CC.blue : CC.soft}"><title>${i === nb - 1 ? `${max}x+` : `${i * step}–${(i + 1) * step}x`}: ${c} deals</title></rect>`;
    if (c) out += `<text x="${x + bw / 2}" y="${T + ih - bh - 4}" text-anchor="middle" fill="${CC.muted}" font-size="10">${c}</text>`;
    out += `<text x="${x + bw / 2}" y="${h - B + 14}" text-anchor="middle" fill="${CC.muted}" font-size="10">${i === nb - 1 ? `${max}+` : i * step}</text>`;
  });
  out += `<text x="${L + iw / 2}" y="${h - 4}" text-anchor="middle" fill="${CC.muted}">${esc(label)} (x) · median ${mult(m)} · n=${vals.length}</text>`;
  return out + '</svg>';
}

// Deals per year (bars) and the median EV/Revenue (line).
function csYears(list, { w = 560, h = 230 } = {}) {
  const by = new Map();
  for (const t of list) if (t.year >= 2000) { if (!by.has(t.year)) by.set(t.year, []); by.get(t.year).push(t); }
  const ys = [...by.keys()].sort((a, b) => a - b);
  if (ys.length < 2) return '<div class="empty small">The deals span less than two years.</div>';
  const rows = ys.map(y => { const ts = by.get(y), v = ts.map(t => t.ev_revenue).filter(x => x != null); return { y, n: ts.length, m: v.length >= 2 ? med(v) : null }; });
  const L = 34, R = 34, T = 18, B = 24, iw = w - L - R, ih = h - T - B, bw = iw / rows.length;
  const nMax = Math.max(...rows.map(r => r.n)), mMax = Math.max(2, ...rows.map(r => r.m || 0)) * 1.15;
  let out = svgOpen(w, h), path = '';
  rows.forEach((r, i) => {
    const x = L + i * bw, bh = (r.n / nMax) * ih;
    out += `<rect x="${x + 3}" y="${T + ih - bh}" width="${bw - 6}" height="${bh}" rx="2" fill="${CC.faint}" stroke="${CC.line}"><title>${r.y}: ${r.n} deals${r.m != null ? ` · median ${mult(r.m)}` : ''}</title></rect>`;
    out += `<text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle" fill="${CC.muted}" font-size="10">’${String(r.y).slice(2)}</text><text x="${x + bw / 2}" y="${T + ih - bh - 3}" text-anchor="middle" fill="${CC.muted}" font-size="9">${r.n}</text>`;
    if (r.m != null) { const cy = T + ih - (r.m / mMax) * ih; path += `${path ? 'L' : 'M'}${x + bw / 2},${cy.toFixed(1)}`; out += `<circle cx="${x + bw / 2}" cy="${cy}" r="3.5" fill="${CC.blue}"/><text x="${x + bw / 2}" y="${cy - 7}" text-anchor="middle" fill="${CC.blue}" font-size="10" font-weight="600">${mult(r.m)}</text>`; }
  });
  out += `<path d="${path}" fill="none" stroke="${CC.blue}" stroke-width="2"/>`;
  return out + `<text x="${L}" y="11" fill="${CC.muted}">bars: deals · line: median EV/Revenue</text></svg>`;
}

// Valuation ranges per method (P25–P75 bar, median tick).
function csFootball(rows, { w = 560 } = {}) {
  if (!rows.length) return '<div class="empty small">Add revenue, ARR or EBITDA to see the valuation range.</div>';
  const L = 150, R = 60, rh = 34, T = 8, h = T + rows.length * rh + 26, iw = w - L - R;
  const max = Math.max(...rows.map(r => r.hi)) * 1.08, sx = v => L + (v / max) * iw;
  let out = svgOpen(w, h);
  rows.forEach((r, i) => {
    const y = T + i * rh;
    out += `<text x="${L - 8}" y="${y + 19}" text-anchor="end" fill="${CC.text}" font-weight="${r.total ? 700 : 400}">${esc(r.label)}</text>
      <rect x="${sx(r.lo)}" y="${y + 6}" width="${Math.max(2, sx(r.hi) - sx(r.lo))}" height="18" rx="3" fill="${r.total ? CC.blue : r.off ? CC.faint : CC.soft}"/>
      <line x1="${sx(r.mid)}" x2="${sx(r.mid)}" y1="${y + 3}" y2="${y + 27}" stroke="${r.total ? CC.text : CC.blue}" stroke-width="2.5"/>
      <text x="${sx(r.lo) - 4}" y="${y + 19}" text-anchor="end" fill="${CC.muted}" font-size="10">${r.lo < max * 0.12 ? '' : eur(r.lo)}</text>
      <text x="${sx(r.hi) + 4}" y="${y + 19}" fill="${CC.muted}" font-size="10">${eur(r.hi)}</text>`;
  });
  return out + `<text x="${L}" y="${h - 6}" fill="${CC.muted}" font-size="10">Enterprise value, EUR m · bar = P25–P75 · tick = median</text></svg>`;
}

function csBars(rows, { w = 360, color = CC.blue } = {}) {
  if (!rows.length) return '<div class="empty small">–</div>';
  const rh = 22, L = Math.min(170, 8 + Math.max(...rows.map(r => String(r.label).length)) * 6), h = rows.length * rh + 4, iw = w - L - 36, max = Math.max(...rows.map(r => r.n));
  let out = svgOpen(w, h);
  rows.forEach((r, i) => {
    const y = i * rh;
    out += `<text x="${L - 6}" y="${y + 15}" text-anchor="end" fill="${CC.text}">${esc(String(r.label).length > 26 ? String(r.label).slice(0, 25) + '…' : r.label)}</text><rect x="${L}" y="${y + 5}" width="${Math.max(2, (r.n / max) * iw)}" height="13" rx="2" fill="${color}" fill-opacity=".8"/><text x="${L + (r.n / max) * iw + 5}" y="${y + 15}" fill="${CC.muted}">${r.n}</text>`;
  });
  return out + '</svg>';
}

// CRM lookups are rebuilt only when the number of companies changes (building them over 15,000 companies takes a moment).
let csIdx = { n: -1 };
function csIndex() {
  if (csIdx.n !== state.companies.length) {
    const byDomain = new Map();
    for (const c of state.companies) { const d = c.website && Engine.rootDomain(c.website); if (d && !byDomain.has(d)) byDomain.set(d, c); }
    csIdx = { n: state.companies.length, crm: crmIndex(), byDomain, typeOf: typeof buyerTypeIndex === 'function' ? buyerTypeIndex() : name => Engine.guessRole({ name }) };
  }
  return csIdx;
}
const csCount = arr => [...arr.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
function csMix(used) {
  const typeOf = csIndex().typeOf, ts = used.map(x => x.t);
  return {
    type: csCount(ts.map(t => (splitBuyers(t.buyer).some(b => typeOf(b) === 'Investor') ? 'Financial (PE / fund)' : 'Strategic'))),
    region: csCount(ts.map(t => txRegion(t) || 'Other')).slice(0, 6),
    buyers: csCount(ts.flatMap(t => splitBuyers(t.buyer))).filter(r => r.n > 1).slice(0, 8),
    tags: csCount(ts.flatMap(t => String(t.tags || '').split(', ').filter(Boolean))).slice(0, 10),
  };
}
const csPoints = (list, on, outKey) => list.filter(x => x.t.ev_revenue && x.t.deal_value > 0).map(x => ({ x: x.t.deal_value, y: x.t.ev_revenue, on, out: outKey && x.outR, key: x.t.key, label: `${x.t.target} (${x.t.year || ''}) · ${mult(x.t.ev_revenue)} · $${usdm(x.t.deal_value)} · ${splitBuyers(x.t.buyer)[0] || ''}` }));
const csFootRows = s => [...s.methods.map(x => ({ label: x.short + (x.on ? '' : ' (off)'), lo: x.range[0], mid: x.range[1], hi: x.range[2], off: !x.on })), ...(s.blend ? [{ label: 'Valuation range', lo: s.blend[0], mid: s.blend[1], hi: s.blend[2], total: true }] : [])];
const csImpliedUsd = s => (s.blend ? s.blend[1] * FX.EUR : null);

// ---------- Target ----------
function csFromCompany(c, overwrite = false) {
  const T = cs.target, put = (k, v) => { if (v != null && v !== '' && (overwrite || T[k] == null || T[k] === '')) T[k] = v; };
  put('name', c.name); put('website', c.website); put('description', c.description || c.summary || c.short_description);
  put('sector', c.sector); put('subsector', c.subsector); put('country', c.country);
  put('revenue', c.revenue); put('ebitda', c.ebitda); put('employees', c.employees);
  const tags = [...(c.tags || []), ...csTerms(c.keywords)];
  T.tags = [...new Set([...T.tags, ...tags.map(x => String(x).trim()).filter(Boolean)])].slice(0, 20);
}
function csCrmMatch() {
  const T = cs.target, dom = T.website && Engine.rootDomain(T.website);
  const idx = csIndex();
  return (dom && idx.byDomain.get(dom)) || (T.name ? idx.crm.get(Engine.normName(T.name)) : null) || null;
}
async function csReadWebsite(btn) {
  const T = cs.target, url = String(T.website || '').trim();
  if (!url) return toast('Enter the website first.');
  const c = csCrmMatch();
  if (c) csFromCompany(c);
  if (!state.settings.anthropicKey) {
    csSave(); renderCompSet();
    return toast(c ? `Filled from ${c.name} in your CRM. To read websites too, add an Anthropic API key in Settings.` : 'To read websites, add your Anthropic API key in Settings (a few cents per site). Or type the description and tags yourself.', 8000);
  }
  btn.disabled = true; btn.textContent = 'Reading website…';
  try {
    const { profile: p, usd } = await Enricher.readWebsite(url, { apiKey: state.settings.anthropicKey, model: state.settings.enrichModel });
    for (const k of ['name', 'sector', 'subsector', 'country', 'business_model', 'customers']) if (p[k] && (k !== 'name' || !T.name)) T[k] = p[k];
    if (p.description || p.short_description) T.description = p.description || p.short_description;
    if (!T.employees && Engine.parseNumber(p.employees)) T.employees = Engine.parseNumber(p.employees);
    T.tags = [...new Set([...T.tags, ...String(p.tags || '').split(/[;,]+/).map(x => x.trim()).filter(Boolean)])].slice(0, 20);
    cs.pin = []; cs.exc = [];
    toast(`Read ${Engine.rootDomain(url)}: ${csTerms(p.tags).length} tags · about $${usd.toFixed(2)}`);
  } catch (e) {
    toast('Could not read the website: ' + e.message, 8000);
  }
  csSave(); renderCompSet();
}
function csFromProject(name) {
  const proj = state.projects.find(p => p.name === name);
  if (!proj) return;
  const d = dealOf(proj), base = csFresh();
  cs.target = { ...base.target, name: d.name, website: d.website || '', description: d.description || '', sector: d.sector || '', subsector: d.subsector || '', country: d.country || '', revenue: d.revenue ?? null, ebitda: d.ebitda ?? null, employees: d.employees ?? null, tags: csTerms(d.keywords).length ? String(d.keywords).split(/[;,]+/).map(x => x.trim()).filter(Boolean) : [] };
  cs.pin = []; cs.exc = [];
}

// ---------- Page ----------
function renderCompSet() {
  const T = cs.target, f = cs.f;
  const ready = !!(T.description || T.tags.length || T.sector);
  const s = ready ? csSelection() : null;
  const crm = csCrmMatch();
  const num = k => `<input data-cst="${k}" data-num="1" value="${T[k] ?? ''}" placeholder="–" style="width:80px">`;
  const fin = (k, ph = '', wd = 64) => `<input data-csf="${k}" value="${esc(f[k] ?? '')}" placeholder="${ph}" style="width:${wd}px">`;
  const chk = (k, label, title = '') => `<label class="check" title="${esc(title)}"><input type="checkbox" data-csf="${k}" ${f[k] ? 'checked' : ''}> ${label}</label>`;
  const suggest = s ? csCount(s.m.ranked.slice(0, 40).flatMap(x => String(x.t.tags || '').split(', ').filter(Boolean))).filter(r => r.n >= 3 && !T.tags.some(t => t.toLowerCase() === r.label.toLowerCase())).slice(0, 12) : [];
  const th = (k, label, cls = 'num') => `<th class="${cls} sortable ${cs.sort === k ? 'on' : ''}" data-cs-sort="${k}">${label}${cs.sort === k ? ' ↓' : ''}</th>`;
  const mix = s ? csMix(s.used) : null;

  const host = csCtx ? $(csCtx.el) : $('#compsView');
  if (!host) return;
  host.innerHTML = `${csCtx ? '' : `<div class="page-head"><div><h1>Value a company</h1><div class="muted">Comparable transactions, multiples and a valuation range from ${state.transactions.length.toLocaleString()} deals</div></div>
      <div class="actions"><button class="btn" data-csx="reset">New company</button><button class="btn" data-csx="xlsx" ${s ? '' : 'disabled'}>Excel</button><button class="btn primary" data-csx="pdf" ${s ? '' : 'disabled'}>PDF slides</button></div></div>`}

    <div class="cs-grid">
      <div class="card">
        <h2>1. Company to value</h2>
        <div class="toolbar"><input data-cst="website" value="${esc(T.website)}" placeholder="Website, e.g. acme-software.nl" style="flex:1;min-width:200px"><button class="btn primary" data-csx="read">Read website</button>
          <select id="csProj"><option value="">Load a project…</option>${state.projects.map(p => `<option>${esc(p.name)}</option>`).join('')}</select></div>
        ${crm && crm.name !== T.name ? `<div class="cs-note">In your CRM: <b>${esc(crm.name)}</b> <button class="link" data-csx="fromcrm">fill from it</button> <button class="chip blue" data-open="${crm.id}">open</button></div>` : ''}
        <div class="small muted" style="margin:6px 0 2px">Industry › sector › sub-sector › niche <span class="muted">(ranks the comparable deals; empty = derived from the description)</span></div>
        ${clsEditorHtml(T.cls_industry || T.niche ? Taxonomy.pathOfCompany(T) : Engine.dealPath({ sector: T.sector, subsector: T.subsector, description: T.description, tags: T.tags }), 'data-cscls', 'cs')}
        <div class="cs-fields">
          <label>Name<input data-cst="name" value="${esc(T.name)}" placeholder="Company or codename"></label>
          <label>Country<input data-cst="country" value="${esc(T.country)}" placeholder="Netherlands"></label>
          <label>Sector<input data-cst="sector" value="${esc(T.sector)}" placeholder="Software"></label>
          <label>Subsector<input data-cst="subsector" value="${esc(T.subsector)}" placeholder="Field service management"></label>
          <label>Business model<select data-cst="business_model">${['', 'SaaS', 'Licence + maintenance', 'Services / IT', 'Marketplace / platform', 'Hardware + software', 'Mixed'].map(x => `<option ${x === T.business_model ? 'selected' : ''} value="${x}">${x || '–'}</option>`).join('')}</select></label>
          <label>Customers<input data-cst="customers" value="${esc(T.customers)}" placeholder="Mid-sized logistics companies"></label>
          <label class="wide">Description<textarea data-cst="description" rows="3" placeholder="What the company does: products, customers, verticals. This drives the matching.">${esc(T.description)}</textarea></label>
        </div>
        <div class="cs-tags"><span class="muted small">Tags</span>${T.tags.map(x => `<span class="chip blue">${esc(x)} <button class="link" data-cs-tagdel="${esc(x)}" title="Remove">×</button></span>`).join('')}
          <input id="csTagAdd" placeholder="+ add tags (Enter; separate with ;)" style="min-width:200px"></div>
        ${suggest.length ? `<div class="cs-tags"><span class="muted small">Common in similar deals</span>${suggest.map(r => `<button class="chip" data-cs-tagadd="${esc(r.label)}" title="${r.n} of the 40 closest deals">+ ${esc(r.label)}</button>`).join('')}</div>` : ''}
        <h2 style="margin-top:14px">Financials <span class="muted small">(EUR m)</span></h2>
        <div class="toolbar"><label class="row-label small">Revenue ${num('revenue')}</label><label class="row-label small">ARR ${num('arr')}</label><label class="row-label small">EBITDA ${num('ebitda')}</label>
          <label class="row-label small">Growth % ${num('growth')}</label><label class="row-label small">Employees ${num('employees')}</label></div>
      </div>

      <div class="card">
        <h2>2. Include / exclude</h2>
        <div class="cs-filters">
          <label class="row-label small">Last ${fin('years', 'all', 46)} years</label>
          <label class="row-label small">Region <select data-csf="region"><option value="">All</option><option value="same" ${f.region === 'same' ? 'selected' : ''}>Same country as target</option>${csRegions().map(r => `<option ${r === f.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label class="row-label small">Deal value ${fin('minSize', 'min', 54)}–${fin('maxSize', 'max', 54)} USD m</label>
          <label class="row-label small">Buyers <select data-csf="buyer">${[['all', 'Strategic + financial'], ['strategic', 'Strategic only'], ['financial', 'Financial only']].map(([v, l]) => `<option value="${v}" ${f.buyer === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="row-label small">Comp set size ${fin('n', '30', 46)}</label>
          <label class="row-label small">Minimum fit ${fin('minFit', '30', 46)}</label>
          <label class="row-label small wide">Must mention (any) ${fin('must', 'e.g. saas; logistics', 220)}</label>
          <label class="row-label small wide">Exclude words ${fin('exclude', 'e.g. hardware; consulting', 220)}</label>
          ${chk('needMult', 'Only deals with a multiple')}${chk('trim', 'Leave out outliers', 'Multiples outside 1.5× the interquartile range are left out of the statistics (shown in orange)')}
          ${chk('noMined', 'Exclude multiples read from deal text')}${chk('done', 'Completed deals only')}${chk('minority', 'Include minority stakes')}
        </div>
        ${s ? `<p class="muted small">${s.m.pool.toLocaleString()} deals pass the filters · <b>${s.used.length}</b> in the comp set${cs.pin.length ? ` (${cs.pin.length} added by hand)` : ''}${cs.exc.length ? ` · ${cs.exc.length} excluded by hand <button class="link small" data-csx="clearexc">restore all</button>` : ''}. Untick a deal below, or click a dot in the chart, to exclude it.</p>` : '<p class="muted small">Fill in a description or tags (or read the website) to find comparable transactions.</p>'}
        ${s && !csCtx ? `<h2 style="margin-top:10px">Export</h2><div class="cs-filters">${CS_SECTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" data-css="${k}" ${cs.sections[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
          <p class="muted small">PDF slides open in a new tab: print → save as PDF (landscape). Excel has the summary with live formulas, every comparable deal in rows, the excluded deals and the next candidates.</p>` : ''}
      </div>
    </div>
    ${s ? csResultHtml(s, mix, th) : ''}`;
}

function csResultHtml(s, mix, th) {
  const T = cs.target;
  return `<div class="kpis">
      <div class="kpi"><div class="k">Comparable deals</div><div class="v">${s.used.length}</div><div class="muted small">of ${s.m.pool.toLocaleString()} that pass the filters</div></div>
      <div class="kpi"><div class="k">Median EV/Revenue</div><div class="v">${mult(s.rev.median)}</div><div class="muted small">P25–P75 ${mult(s.rev.p25)}–${mult(s.rev.p75)} · n=${s.rev.n}</div></div>
      <div class="kpi"><div class="k">Median EV/EBITDA</div><div class="v">${mult(s.ebitda.median)}</div><div class="muted small">P25–P75 ${mult(s.ebitda.p25)}–${mult(s.ebitda.p75)} · n=${s.ebitda.n}</div></div>
      <div class="kpi"><div class="k">Implied EV (mid)</div><div class="v">${s.blend ? eur(s.blend[1]) : '–'}</div><div class="muted small">${s.blend ? `${eur(s.blend[0])} – ${eur(s.blend[2])}` : 'add revenue, ARR, EBITDA or employees'}</div></div>
      ${s.pe.rev.n ? `<div class="kpi"><div class="k">Revenue / employee</div><div class="v">$${Engine.fmt(s.pe.rev.median)}k</div><div class="muted small">P25–P75 $${Engine.fmt(s.pe.rev.p25)}k–$${Engine.fmt(s.pe.rev.p75)}k · n=${s.pe.rev.n}${s.pe.ebitda.n >= 3 ? ` · EBITDA $${Engine.fmt(s.pe.ebitda.median)}k` : ''}${s.impliedRev ? ` · implies €${Engine.fmt(s.impliedRev)}m revenue` : ''}</div></div>` : ''}
    </div>
    <div class="comps-grid">
      <div class="card span2"><div class="toolbar" style="margin-bottom:4px"><h2 style="margin:0">Valuation</h2><span class="spacer"></span>
          <label class="row-label small">Premium / discount <input data-csadj value="${cs.adj || ''}" placeholder="0" style="width:50px"> %</label></div>
        <div class="cs-two cs-val"><div><table class="compact"><thead><tr><th>Use</th><th>Method</th><th class="num">Metric</th><th class="num">P25</th><th class="num">Median</th><th class="num">P75</th><th class="num">n</th><th class="num">Mid EV</th></tr></thead><tbody>
          ${s.methods.map(x => `<tr class="${x.on ? '' : 'muted'}"><td><input type="checkbox" data-csm="${x.k}" ${x.on ? 'checked' : ''}></td><td>${x.label}</td><td class="num">${eur(x.metric)}</td><td class="num">${mult(x.s.p25)}</td><td class="num"><b>${mult(x.s.median)}</b></td><td class="num">${mult(x.s.p75)}</td><td class="num">${x.s.n}</td><td class="num"><b>${eur(x.range[1])}</b></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Add revenue, ARR or EBITDA (EUR m) to the company, and make sure at least 3 comparable deals have the multiple.</td></tr>'}
          </tbody></table>${T.arr && !T.revenue ? '<p class="muted small">ARR is valued with revenue multiples of the comparable deals (S&P doesn\'t report ARR).</p>' : ''}${cs.adj ? `<p class="muted small">Multiples adjusted ${cs.adj > 0 ? '+' : ''}${cs.adj}%.</p>` : ''}</div>
          <div>${csFootball(csFootRows(s))}</div></div></div>
      <div class="card"><h2>EV/Revenue vs deal size</h2>${csScatter([...csPoints(s.used, true, true), ...csPoints(s.next, false)], { refY: s.rev.median, refX: csImpliedUsd(s), refXLabel: 'target (implied EV)', click: true })}
        <div class="legend small muted"><i class="sw b"></i> in comp set · ○ next candidates · orange = outlier · click a dot to include / exclude it</div></div>
      <div class="card"><h2>Distribution</h2>${csHist(s.used.filter(x => !x.outR).map(x => x.t.ev_revenue).filter(v => v != null))}
        ${s.ebitda.n >= 3 ? csHist(s.used.filter(x => !x.outE).map(x => x.t.ev_ebitda).filter(v => v != null), { step: 4, max: 40, label: 'EV / EBITDA' }) : ''}</div>
      <div class="card"><h2>Over time</h2>${csYears(s.used.map(x => x.t))}</div>
      <div class="card"><h2>Who bought them</h2><div class="cs-two"><div><h3 class="small muted">Buyer type</h3>${csBars(mix.type, { w: 300 })}<h3 class="small muted">Region</h3>${csBars(mix.region, { w: 300, color: CC.green })}</div>
        <div><h3 class="small muted">Common tags</h3>${csBars(mix.tags, { w: 300, color: CC.grey })}${mix.buyers.length ? `<h3 class="small muted">Repeat buyers</h3>${csBars(mix.buyers, { w: 300, color: CC.amber })}` : ''}</div></div></div>
    </div>
    <div class="table-wrap"><table class="data tx-table cs-table"><thead><tr><th title="Include in the comp set">In</th>${th('fit', 'Fit')}${th('date', 'Date', '')}<th>Target</th><th>Buyer</th><th>Country</th>${th('size', 'Deal value')}<th class="num">Revenue</th>${th('evr', 'EV/Rev')}${th('eve', 'EV/EBITDA')}</tr></thead><tbody>
      ${csSorted(s.used).map(x => csRow(x, true)).join('')}
    </tbody></table></div>
    ${s.next.length ? `<h2 style="margin:18px 0 6px">Next best candidates</h2><div class="table-wrap"><table class="data tx-table cs-table"><tbody>${s.next.map(x => csRow(x, false)).join('')}</tbody></table></div>` : ''}
    ${s.excluded.length ? `<h2 style="margin:18px 0 6px">Excluded by hand</h2><div class="table-wrap"><table class="data tx-table cs-table"><tbody>${s.excluded.map(x => csRow(x, false, true)).join('')}</tbody></table></div>` : ''}
    <p class="muted small">Fit = similarity of business description and tags (40%), industry (15%), size (20%), recency (15%) and geography (10%). Amounts of deals in USD m; your company in EUR m. * = multiple read from the deal summary.</p>`;
}

function csRow(x, inSet, excluded = false) {
  const t = x.t, b = splitBuyers(t.buyer);
  const ctl = inSet ? `<input type="checkbox" checked data-cs-inc="${esc(t.key)}" title="Untick to exclude">` : excluded ? `<button class="btn sm" data-cs-restore="${esc(t.key)}">restore</button>` : `<button class="btn sm" data-cs-pin="${esc(t.key)}">+ add</button>`;
  return `<tr class="tx-row ${cs.open === t.key ? 'open' : ''} ${inSet ? '' : 'muted'}" data-cs-row="${esc(t.key)}"><td>${ctl}</td><td class="num"><span class="chip">${x.score}</span>${x.pinned ? '<div class="chip blue">added</div>' : ''}</td>
    <td class="small">${esc(t.date || t.year || '')}</td><td><b>${esc(t.target)}</b><div class="co-sub">${esc(x.why.join(' · '))}</div></td>
    <td class="small"><div class="tx-buyer">${esc(b.slice(0, 2).join('; '))}${b.length > 2 ? ` +${b.length - 2}` : ''}</div></td><td class="small">${esc(t.country || '')}</td>
    <td class="num">${t.deal_value != null ? usdm(t.deal_value) : ''}</td><td class="num">${t.revenue != null ? usdm(t.revenue) : ''}</td>
    <td class="num ${x.outR ? 'cs-out' : ''}" ${x.outR ? 'title="Outlier: left out of the statistics"' : ''}>${mult(t.ev_revenue)}</td><td class="num ${x.outE ? 'cs-out' : ''}">${mult(t.ev_ebitda)}${t.mult_src ? '<sup title="Read from the deal summary">*</sup>' : ''}</td></tr>
    ${cs.open === t.key ? txDetail(t).replace('colspan="9"', 'colspan="10"') : ''}`;
}

// ---------- PDF slides ----------
const csSlide = (title, body, sub = '') => `<section class="slide"><div class="hd"><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="bd">${body}</div></section>`;
const csFacts = T => [T.sector, T.subsector, T.country, T.business_model].filter(Boolean).map(esc).join(' · ');
const csCover = (name, lead, meta) => `<section class="slide title"><div class="brand">33 Equity</div><h1>${esc(name)}</h1><div class="lead">${esc(lead)}</div>${meta.filter(Boolean).map(m => `<div class="meta">${m}</div>`).join('')}</section>`;
const csSlides = s => csOpenDeck(csSlideList(s, cs.sections), cs.target.name || 'Target', 'comparable transactions');

// Slides for the comp set. Without financials (or with every method off) the summary shows the multiples instead of a valuation.
function csSlideList(s, sec) {
  const T = cs.target, name = T.name || 'Target', date = today(), mix = csMix(s.used);
  const slides = [];
  const slide = (title, body, sub = '') => slides.push(csSlide(title, body, sub));
  const valued = s.methods.some(x => x.on);
  if (sec.title) slides.push(csCover(name, 'Comparable transactions analysis', [csFacts(T), date]));
  if (sec.summary && !valued) slide('Market multiples', `<div class="row"><div class="col">
      <div class="kp">${[['Comparable deals', s.used.length], ['Median EV/Revenue', mult(s.rev.median)], ['Median EV/EBITDA', mult(s.ebitda.median)], ['Median deal value', s.used.some(x => x.t.deal_value) ? '$' + usdm(med(s.used.map(x => x.t.deal_value).filter(v => v > 0))) : '–']].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <table><tr><th>Multiple</th><th class="n">P25</th><th class="n">Median</th><th class="n">P75</th><th class="n">Deals</th></tr>
      ${[['EV / Revenue', s.rev], ['EV / EBITDA', s.ebitda]].map(([k, st]) => `<tr><td>${k}</td><td class="n">${mult(st.p25)}</td><td class="n"><b>${mult(st.median)}</b></td><td class="n">${mult(st.p75)}</td><td class="n">${st.n}</td></tr>`).join('')}</table>
      <h3>Closest transactions</h3><table class="tx">${[...s.used].sort(CS_SORT.fit).slice(0, 6).map(x => `<tr><td>${esc(String(x.t.date || x.t.year || '').slice(0, 7))}</td><td><b>${esc(x.t.target)}</b> <span class="muted">→ ${esc(splitBuyers(x.t.buyer)[0] || '')}</span></td><td class="n">${mult(x.t.ev_revenue)}</td><td class="n">${mult(x.t.ev_ebitda)}</td></tr>`).join('')}</table></div>
      <div class="col">${csHist(s.used.filter(x => !x.outR).map(x => x.t.ev_revenue).filter(v => v != null), { w: 520, h: 300 })}</div></div>`, `EV/Revenue of the ${s.used.length} most comparable deals: median ${mult(s.rev.median)}, P25–P75 ${mult(s.rev.p25)}–${mult(s.rev.p75)}`);
  if (sec.summary && valued) slide('Valuation summary', `<div class="row"><div class="col">
      <div class="kp">${[['Comparable deals', s.used.length], ['Median EV/Revenue', mult(s.rev.median)], ['Median EV/EBITDA', mult(s.ebitda.median)], ['Implied EV (mid)', s.blend ? eur(s.blend[1]) : '–']].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <table><tr><th>Method</th><th class="n">Metric</th><th class="n">P25</th><th class="n">Median</th><th class="n">P75</th><th class="n">Low – high EV</th></tr>
      ${s.methods.filter(x => x.on).map(x => `<tr><td>${x.label}</td><td class="n">${eur(x.metric)}</td><td class="n">${mult(x.s.p25)}</td><td class="n"><b>${mult(x.s.median)}</b></td><td class="n">${mult(x.s.p75)}</td><td class="n">${eur(x.range[0])} – ${eur(x.range[2])}</td></tr>`).join('')}</table>
      ${T.description ? `<p class="muted">${esc(T.description.slice(0, 420))}</p>` : ''}
      <h3>Closest transactions</h3><table class="tx">${[...s.used].sort(CS_SORT.fit).slice(0, 5).map(x => `<tr><td>${esc(String(x.t.date || x.t.year || '').slice(0, 7))}</td><td><b>${esc(x.t.target)}</b> <span class="muted">→ ${esc(splitBuyers(x.t.buyer)[0] || '')}</span></td><td class="n">${mult(x.t.ev_revenue)}</td><td class="n">${mult(x.t.ev_ebitda)}</td></tr>`).join('')}</table></div>
      <div class="col">${csFootball(csFootRows(s), { w: 520 })}</div></div>`, s.blend ? `Indicative enterprise value <b>${eur(s.blend[0])} – ${eur(s.blend[2])}</b>, mid ${eur(s.blend[1])}${cs.adj ? ` (multiples adjusted ${cs.adj > 0 ? '+' : ''}${cs.adj}%)` : ''}` : '');
  if (sec.charts) slide('Multiples of comparable transactions', `<div class="row"><div class="col">${csScatter(csPoints(s.used, true, true), { w: 520, h: 330, refY: s.rev.median, refX: csImpliedUsd(s), refXLabel: name })}</div>
      <div class="col">${csHist(s.used.filter(x => !x.outR).map(x => x.t.ev_revenue).filter(v => v != null), { w: 520, h: s.ebitda.n >= 3 ? 165 : 330 })}${s.ebitda.n >= 3 ? csHist(s.used.filter(x => !x.outE).map(x => x.t.ev_ebitda).filter(v => v != null), { w: 520, h: 165, step: 4, max: 40, label: 'EV / EBITDA' }) : ''}</div></div>`,
    `EV/Revenue P25–P75 ${mult(s.rev.p25)}–${mult(s.rev.p75)}, median ${mult(s.rev.median)} (n=${s.rev.n})`);
  if (sec.time) slide('Activity over time and buyers', `<div class="row"><div class="col">${csYears(s.used.map(x => x.t), { w: 520, h: 300 })}</div>
      <div class="col"><div class="row"><div class="col"><h3>Buyer type</h3>${csBars(mix.type, { w: 250 })}<h3>Region</h3>${csBars(mix.region, { w: 250, color: CC.green })}</div>
      <div class="col"><h3>Common tags</h3>${csBars(mix.tags.slice(0, 8), { w: 250, color: CC.grey })}</div></div></div></div>`);
  if (sec.table) {
    const rows = csSorted(s.used), per = 9;
    for (let i = 0; i < rows.length; i += per) slide(`Comparable transactions${rows.length > per ? ` (${i / per + 1}/${Math.ceil(rows.length / per)})` : ''}`, `<table class="tx"><tr><th>Date</th><th>Target</th><th>Buyer</th><th>Country</th><th class="n">Deal value</th><th class="n">EV/Rev</th><th class="n">EV/EBITDA</th></tr>
      ${rows.slice(i, i + per).map(x => `<tr><td class="n">${esc(String(x.t.date || x.t.year || '').slice(0, 7))}</td><td><b>${esc(x.t.target)}</b><div class="muted">${esc(clip(String(x.t.description || x.t.industry || ''), 105))}</div></td><td>${esc(splitBuyers(x.t.buyer).slice(0, 2).join('; '))}</td><td>${esc(x.t.country || '')}</td>
        <td class="n">${x.t.deal_value != null ? '$' + usdm(x.t.deal_value) : '–'}</td><td class="n ${x.outR ? 'out' : ''}">${mult(x.t.ev_revenue)}</td><td class="n ${x.outE ? 'out' : ''}">${mult(x.t.ev_ebitda)}</td></tr>`).join('')}</table>`);
  }
  if (sec.method) {
    const f = cs.f, region = f.region === 'same' ? `same country (${T.country || '–'})` : f.region || 'all regions';
    slide('Filters and methodology', `<div class="row"><div class="col"><h3>Selection</h3><ul>
      <li>${s.m.pool.toLocaleString()} transactions passed the filters; the ${s.used.length} most similar are used${cs.pin.length ? ` (${cs.pin.length} added by hand)` : ''}${cs.exc.length ? `, ${cs.exc.length} excluded by hand` : ''}.</li>
      <li>Period: ${f.years ? `last ${f.years} years` : 'all years'} · ${esc(region)} · ${f.buyer === 'all' ? 'strategic and financial buyers' : f.buyer + ' buyers only'}${f.minSize !== '' || f.maxSize !== '' ? ` · deal value ${f.minSize || 0}–${f.maxSize || '∞'} USD m` : ''}.</li>
      ${f.must ? `<li>Must mention: ${esc(f.must)}.</li>` : ''}${f.exclude ? `<li>Excluded words: ${esc(f.exclude)}.</li>` : ''}
      <li>${f.done ? 'Completed deals only' : 'Completed and pending deals'}; ${f.minority ? 'minority stakes included' : 'majority deals only'}${f.noMined ? '; reported multiples only' : ''}.</li>
      <li>${f.trim ? 'Outliers (beyond 1.5× the interquartile range) are left out of the statistics.' : 'All multiples are used in the statistics.'}</li></ul>
      <h3>Company profile used for matching</h3><p class="muted">${esc((T.tags || []).join(' · ') || '–')}</p></div>
      <div class="col"><h3>Method</h3><ul><li>Similarity score: business description and tags (40%), industry (15%), size (20%), recency (15%), geography (10%).</li>
      <li>Valuation: P25 / median / P75 multiples of the comp set applied to the company's revenue${T.arr ? ', ARR' : ''} and EBITDA; the range is the average of the selected methods.</li>
      <li>Source: S&P Capital IQ and other transaction databases; deal amounts in USD, company figures in EUR. Some multiples are derived from deal announcements and are approximate.</li></ul>
      <p class="muted">Indicative only, based on public transaction data and the information provided; not a fairness opinion.</p></div></div>`);
  }
  return slides;
}

function csOpenDeck(slides, name, what) {
  const date = today();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} – ${esc(what)} ${date}</title><style>
    @page{size:297mm 167mm;margin:0}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;background:#e5e7eb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#14181f;font-size:11.5px}
    .bar{position:sticky;top:0;background:#0f172a;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;z-index:2}.bar button{font:inherit;padding:6px 14px;border-radius:6px;border:0;background:#1d4ed8;color:#fff;cursor:pointer}
    .slide{width:297mm;height:167mm;margin:8mm auto;background:#fff;padding:11mm 13mm 12mm;position:relative;overflow:hidden;break-after:page;page-break-after:always;box-shadow:0 2px 8px rgba(0,0,0,.12);counter-increment:pg}
    .slide::after{content:"33 Equity · ${esc(name).replace(/"/g, '')} · ${date}    " counter(pg);position:absolute;left:13mm;right:13mm;bottom:5mm;font-size:9px;color:#98a2b3;text-align:right;white-space:pre}
    .slide::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:#1d4ed8}
    .hd{border-bottom:2px solid #eef0f3;margin-bottom:10px;padding-bottom:6px}.hd h2{margin:0;font-size:20px;color:#0f172a}.sub{color:#475467;margin-top:3px;font-size:12.5px}
    .title{display:flex;flex-direction:column;justify-content:center;padding-left:22mm;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff}.title::after{color:#cbd5e1}
    .title h1{font-size:40px;margin:6px 0}.title .lead{font-size:20px;color:#c7d2fe}.title .meta{color:#cbd5e1;margin-top:6px;font-size:13px}.brand{letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:#93c5fd}
    .row{display:flex;gap:16px}.col{flex:1;min-width:0}.col svg{max-width:100%;height:auto}
    h3{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#667085;margin:8px 0 4px}
    table{border-collapse:collapse;width:100%;margin:6px 0}td,th{text-align:left;padding:4px 6px;border-bottom:1px solid #eef0f3;vertical-align:top}th{font-size:9.5px;color:#667085;text-transform:uppercase}
    .tx td{font-size:10.5px}.n{text-align:right;white-space:nowrap}.out{color:#dc6803}.muted{color:#667085}ul{margin:4px 0;padding-left:16px}li{margin:3px 0}
    .kp{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px}.kp div{border:1px solid #e6e8ec;border-radius:8px;padding:8px;text-align:center}.kp span{display:block;font-size:9.5px;color:#667085;text-transform:uppercase}.kp b{font-size:18px}
    .tier{display:inline-block;min-width:18px;text-align:center;border-radius:4px;font-weight:700;font-size:9.5px;padding:1px 4px;color:#fff;background:#1d4ed8}.tier.t2{background:#6941c6}.tier.t3{background:#98a2b3}
    .lead-text{font-size:13px;line-height:1.55;color:#344054}.box{border:1px solid #e6e8ec;border-radius:8px;padding:10px 12px;margin-bottom:8px}
    @media print{body{background:#fff}.bar{display:none}.slide{margin:0;box-shadow:none}}
  </style></head><body><div class="bar"><b>${slides.length} slides</b><span>Print → Save as PDF. Layout landscape; margins none.</span><button onclick="print()">Print / save as PDF</button></div>${slides.join('')}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to open the slides.');
  w.document.write(html);
  w.document.close();
}

// ---------- Excel ----------
const csExcel = s => XLSX.writeFile(csWorkbook(s), `comps-${(cs.target.name || 'target').replace(/[^\w-]+/g, '-').toLowerCase()}-${today()}.xlsx`);
function csWorkbook(s) {
  const T = cs.target, f = cs.f, X = XLSX.utils;
  const COLS = [['In comp set', x => (x.pinned ? 'Added by hand' : 'Yes')], ['Fit', x => x.score], ['Date', x => x.t.date || x.t.year || ''], ['Target', x => x.t.target], ['Buyer', x => x.t.buyer || ''], ['Seller', x => x.t.seller || ''],
    ['Country', x => x.t.country || ''], ['Region', x => txRegion(x.t)], ['Industry', x => x.t.industry || ''], ['Tags', x => x.t.tags || ''], ['Status', x => x.t.status || ''],
    ['Deal value (USD m)', x => x.t.deal_value ?? ''], ['EV (USD m)', x => x.t.ev ?? ''], ['Revenue (USD m)', x => x.t.revenue ?? ''], ['EBITDA (USD m)', x => x.t.ebitda ?? ''],
    ['EV/Revenue', x => x.t.ev_revenue ?? ''], ['EV/Revenue used', x => (x.outR ? '' : x.t.ev_revenue ?? '')], ['EV/EBITDA', x => x.t.ev_ebitda ?? ''], ['EV/EBITDA used', x => (x.outE ? '' : x.t.ev_ebitda ?? '')],
    ['Outlier', x => [x.outR && 'EV/Revenue', x.outE && 'EV/EBITDA'].filter(Boolean).join(', ')], ['Multiple from deal text', x => x.t.mult_src || ''], ['Why similar', x => x.why.join('; ')],
    ['Target description', x => x.t.description || ''], ['Deal summary', x => x.t.summary || ''], ['Transaction ID', x => x.t.id || '']];
  const sheetOf = (list, cols = COLS) => {
    const ws = X.aoa_to_sheet([cols.map(c => c[0]), ...list.map(x => cols.map(c => c[1](x)))]);
    ws['!cols'] = cols.map(([h]) => ({ wch: /description|summary|tags|why/i.test(h) ? 50 : /target|buyer|seller|industry/i.test(h) ? 28 : 12 }));
    ws['!autofilter'] = { ref: X.encode_range({ s: { r: 0, c: 0 }, e: { r: list.length, c: cols.length - 1 } }) };
    return ws;
  };
  const used = csSorted(s.used), n = used.length + 1;
  const col = h => X.encode_col(COLS.findIndex(c => c[0] === h));
  const rng = h => `Comparables!${col(h)}2:${col(h)}${n}`;
  // QUARTILE (not QUARTILE.INC): same result, and it needs no _xlfn prefix in the file.
  const q = (h, fn, v) => ({ t: 'n', f: `IFERROR(${fn}(${rng(h)}${fn === 'QUARTILE' ? `,${v}` : ''}),"")` });
  const mRow = (label, h, st) => [label, { ...q(h, 'QUARTILE', 1), v: st.p25 ?? '' }, { ...q(h, 'MEDIAN'), v: st.median ?? '' }, { ...q(h, 'QUARTILE', 3), v: st.p75 ?? '' }, { t: 'n', f: `COUNT(${rng(h)})`, v: st.n }];
  const adj = Number(cs.adj) || 0;
  // Rows 4-5 hold the multiples, row 12 the adjustment; the valuation rows refer to them so edits in Excel flow through.
  const val = (r, label, metric, multRow) => { const st = multRow === 4 ? s.rev : s.ebitda; return [label, metric ?? '', ...['B', 'C', 'D'].map((c, i) => (metric ? { t: 'n', f: `IFERROR($B${r}*${c}${multRow}*(1+$B$12),"")`, v: (st[['p25', 'median', 'p75'][i]] ?? 0) * metric * (1 + adj / 100) } : ''))]; };
  const aoa = [
    [`Comparable transactions – ${T.name || 'target'}`, '', '', '', `33 Equity · ${today()}`], [],
    ['Multiple (comp set)', 'P25', 'Median', 'P75', 'n'],
    mRow('EV / Revenue', 'EV/Revenue used', s.rev), mRow('EV / EBITDA', 'EV/EBITDA used', s.ebitda), [],
    ['Valuation (EUR m)', 'Metric', 'Low (P25)', 'Mid (median)', 'High (P75)'],
    val(8, 'EV/Revenue × revenue', T.revenue, 4), val(9, 'EV/Revenue × ARR', T.arr, 4), val(10, 'EV/EBITDA × EBITDA', T.ebitda, 5),
    ['Methods used in the range', s.methods.filter(x => x.on).map(x => x.short).join(', ') || '–'],
    ['Premium / discount', { t: 'n', v: adj / 100, z: '0%' }], [],
    ['Company'], ['Name', T.name], ['Website', T.website], ['Country', T.country], ['Sector', [T.sector, T.subsector].filter(Boolean).join(' / ')], ['Business model', T.business_model],
    ['Description', T.description], ['Tags', T.tags.join('; ')], ['Revenue (EUR m)', T.revenue ?? ''], ['ARR (EUR m)', T.arr ?? ''], ['EBITDA (EUR m)', T.ebitda ?? ''], ['Growth %', T.growth ?? ''], [],
    ['Filters'], ['Deals passing filters', s.m.pool], ['Comp set', `${s.used.length} deals (top ${f.n} with fit ≥ ${f.minFit}${cs.pin.length ? `, ${cs.pin.length} added by hand` : ''}${cs.exc.length ? `, ${cs.exc.length} excluded by hand` : ''})`],
    ['Period', f.years ? `last ${f.years} years` : 'all'], ['Region', f.region === 'same' ? `same country (${T.country})` : f.region || 'all'], ['Buyers', f.buyer], ['Deal value (USD m)', `${f.minSize || 0} – ${f.maxSize || 'no max'}`],
    ['Must mention', f.must], ['Exclude words', f.exclude], ['Outliers', f.trim ? 'left out of the statistics (1.5× IQR)' : 'included'], ['Multiples from deal text', f.noMined ? 'excluded' : 'included'],
    [], ['Tip: delete a row on the Comparables sheet, or clear its "used" multiple, and the statistics and valuation above update.'],
  ];
  const sum = X.aoa_to_sheet(aoa);
  for (const r of [8, 9, 10]) for (const c of ['B', 'C', 'D', 'E']) if (sum[`${c}${r}`]) sum[`${c}${r}`].z = '#,##0.0';
  for (const r of [4, 5]) for (const c of ['B', 'C', 'D']) if (sum[`${c}${r}`]) sum[`${c}${r}`].z = '0.0"x"';
  sum['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = X.book_new();
  X.book_append_sheet(wb, sum, 'Summary');
  X.book_append_sheet(wb, sheetOf(used), 'Comparables');
  if (s.excluded.length) X.book_append_sheet(wb, sheetOf(s.excluded, COLS.map(c => (c[0] === 'In comp set' ? ['In comp set', () => 'Excluded by hand'] : c))), 'Excluded');
  X.book_append_sheet(wb, sheetOf(s.m.ranked.filter(x => !used.some(u => u.t.key === x.t.key)).slice(0, 200), COLS.map(c => (c[0] === 'In comp set' ? ['In comp set', () => 'No'] : c))), 'Next candidates');
  const years = [...new Set(used.map(x => x.t.year).filter(Boolean))].sort();
  X.book_append_sheet(wb, X.aoa_to_sheet([['Year', 'Deals', 'Median EV/Revenue', 'Median EV/EBITDA'], ...years.map(y => { const ts = used.filter(x => x.t.year === y).map(x => x.t); return [y, ts.length, med(ts.map(t => t.ev_revenue).filter(v => v != null)) ?? '', med(ts.map(t => t.ev_ebitda).filter(v => v != null)) ?? '']; })]), 'By year');
  return wb;
}

// ---------- Events ----------
const csRedraw = () => { csSave(); renderCompSet(); };
const csToggle = key => {
  if (cs.exc.includes(key)) cs.exc = cs.exc.filter(k => k !== key);
  else { cs.exc.push(key); cs.pin = cs.pin.filter(k => k !== key); }
};
const csActive = e => (csCtx ? !!e.target.closest(csCtx.el) : cf.view === 'set' && !!e.target.closest('#compsView'));
document.addEventListener('click', e => {
  if (!csActive(e)) return;
  const a = (s) => e.target.closest(`[${s}]`)?.getAttribute(s);
  const x = a('data-csx');
  if (x === 'read') return csReadWebsite(e.target.closest('button'));
  if (x === 'pdf') return csSlides(csSelection());
  if (x === 'xlsx') return csExcel(csSelection());
  if (x === 'reset') { if (confirm('Start a new company? The current inputs and choices are cleared.')) { cs = { ...csFresh(), f: cs.f, sections: cs.sections }; csRedraw(); } return; }
  if (x === 'clearexc') { cs.exc = []; return csRedraw(); }
  if (x === 'fromcrm') { const c = csCrmMatch(); if (c) { csFromCompany(c, true); cs.pin = []; cs.exc = []; } return csRedraw(); }
  if (a('data-cs-tagdel')) { const t = a('data-cs-tagdel'); cs.target.tags = cs.target.tags.filter(x => x !== t); return csRedraw(); }
  if (a('data-cs-tagadd')) { cs.target.tags.push(a('data-cs-tagadd')); return csRedraw(); }
  if (a('data-cs-pin')) { const k = a('data-cs-pin'); cs.pin.push(k); cs.exc = cs.exc.filter(x => x !== k); return csRedraw(); }
  if (a('data-cs-restore')) { const k = a('data-cs-restore'); cs.exc = cs.exc.filter(x => x !== k); return csRedraw(); }
  if (a('data-cs-pt')) {
    const k = a('data-cs-pt'), sel = csSelection();
    if (sel.used.some(u => u.t.key === k)) csToggle(k); else { cs.pin.push(k); cs.exc = cs.exc.filter(x => x !== k); }
    return csRedraw();
  }
  if (a('data-cs-sort')) { cs.sort = a('data-cs-sort'); return csRedraw(); }
  if (a('data-ctag')) { const t = a('data-ctag'); if (!cs.target.tags.includes(t)) cs.target.tags.push(t); toast(`Added tag “${t}”`); return csRedraw(); }
  if (e.target.closest('input, button, a, .tx-detail')) return;
  if (a('data-cs-row')) { const k = a('data-cs-row'); cs.open = cs.open === k ? null : k; return csRedraw(); }
});
document.addEventListener('change', e => {
  if (!csActive(e)) return;
  const el = e.target, d = el.dataset;
  if (el.id === 'csProj') { if (el.value) csFromProject(el.value); return csRedraw(); }
  if (el.id === 'csTagAdd') { cs.target.tags = [...new Set([...cs.target.tags, ...el.value.split(/[;,]+/).map(x => x.trim()).filter(Boolean)])]; return csRedraw(); }
  if (d.cst) { cs.target[d.cst] = d.num ? Engine.parseNumber(el.value) : el.value.trim(); if (d.cst === 'website' || d.cst === 'description') { cs.pin = []; } return csRedraw(); }
  if (d.cscls) { const T = cs.target; applyClsChange(T, d.cscls, el.value, T.cls_industry || T.niche ? null : Engine.dealPath({ sector: T.sector, subsector: T.subsector, description: T.description, tags: T.tags })); return csRedraw(); }
  if (d.csf) { cs.f[d.csf] = el.type === 'checkbox' ? el.checked : el.value.trim() === '' ? '' : /^(years|n|minFit)$/.test(d.csf) ? Number(el.value) || 0 : el.value.trim(); return csRedraw(); }
  if (d.csm) { cs.methods[d.csm] = el.checked; return csRedraw(); }
  if (d.css) { cs.sections[d.css] = el.checked; return csSave(); }
  if ('csadj' in d) { cs.adj = Engine.parseNumber(el.value) || 0; return csRedraw(); }
  if (d.csInc) { csToggle(d.csInc); return csRedraw(); }
});
