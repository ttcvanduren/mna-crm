/* global Engine, Store, XLSX, state, esc, norm, toast, showTab, saveProjects, dealOf, eur, members, renderProjects, today */
// Comparable-transactions valuation: a transactions database (e.g. Capital IQ exports), similarity matching against a
// project's deal profile, a 10-factor software scorecard that adjusts the median multiples, and a printable report.

// ---------- Transactions store (chunked, so thousands of rows fit in shared state) ----------
const TX_CHUNK = 500;
async function loadTransactions() {
  const meta = await Store.getState('tx:meta', null);
  if (!meta?.chunks) { state.transactions = []; return; }
  const parts = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => Store.getState('tx:' + i, [])));
  state.transactions = parts.flat();
}
async function saveTransactions() {
  const list = state.transactions;
  const chunks = Math.ceil(list.length / TX_CHUNK);
  const old = (await Store.getState('tx:meta', null))?.chunks || 0;
  for (let i = 0; i < chunks; i++) await Store.setState('tx:' + i, list.slice(i * TX_CHUNK, (i + 1) * TX_CHUNK));
  for (let i = chunks; i < old; i++) await Store.setState('tx:' + i, []);
  await Store.setState('tx:meta', { chunks, count: list.length, updated: new Date().toISOString() });
}

// ---------- Import (Capital IQ "Transactions" screens and similar exports) ----------
// Rules are tried in order and each field is claimed by the first matching column (header text, lowercased letters/digits).
const TX_RULES = [
  ['id', /transactionid|dealid|^id$|capitaliqtransactionid/],
  ['closed', /closeddate|completeddate|completiondate|effectivedate|dateclosed/],
  ['date', /announceddate|announcementdate|dateannounced|^date$|transactiondate/],
  ['ev_revenue', /(enterprisevalue|^ev|impliedev).*(revenue|sales)|evrevenue|evsales/],
  ['ev_ebitda', /(enterprisevalue|^ev|impliedev).*ebitda|evebitda/],
  ['ev_ebit', /(enterprisevalue|^ev|impliedev).*ebit(?!da)/],
  ['ev', /impliedenterprisevalue|enterprisevalue|^ev(usd|eur|mm)?/],
  ['deal_value', /transactionvalue|dealvalue|purchaseprice|considerationvalue|dealsize/],
  ['revenue', /revenue|sales|turnover/],
  ['ebitda', /ebitda/],
  ['employees', /employee|fte|headcount/],
  ['description', /description|overview|businessdesc/],
  ['industry', /industry|sector|classification|vertical/],
  ['country', /country|geographic|location|region|headquarter/],
  ['buyer', /buyer|acquirer|investor|bidder|acquiring/],
  ['seller', /seller|vendor|divestor/],
  ['stake', /percentsought|percentacquired|stake|percentage|percent/],
  ['status', /status/],
  ['type', /transactiontype|dealtype|^type/],
  ['consideration', /consideration|payment/],
  ['website', /website|url|web/],
  ['target', /target|issuer|company|name/],
];
const TX_LABELS = { id: 'Transaction ID', date: 'Announced', closed: 'Closed', target: 'Target', buyer: 'Buyer', seller: 'Seller', ev: 'EV (m)', deal_value: 'Deal value (m)', revenue: 'Target revenue (m)', ebitda: 'Target EBITDA (m)', employees: 'Employees', ev_revenue: 'EV/Revenue', ev_ebitda: 'EV/EBITDA', ev_ebit: 'EV/EBIT', description: 'Business description', industry: 'Industry', country: 'Country / location', stake: '% acquired', status: 'Status', type: 'Type', consideration: 'Consideration', website: 'Website' };
const hk = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function mapTxHeaders(headers) {
  const out = headers.map(() => null), taken = new Set();
  for (const [field, re] of TX_RULES) {
    const i = headers.findIndex((h, j) => !out[j] && h && re.test(hk(h)));
    if (i >= 0 && !taken.has(field)) { out[i] = field; taken.add(field); }
  }
  return out;
}
function detectTxHeaderRow(rows) {
  let best = 0, bestScore = -1;
  rows.slice(0, 30).forEach((r, i) => {
    const m = mapTxHeaders(r.map(v => (typeof v === 'string' ? v : ''))).filter(Boolean);
    const score = m.length + (m.includes('target') ? 2 : 0) + (m.includes('ev_revenue') || m.includes('ev_ebitda') ? 2 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}
const num = v => Engine.parseNumber(v);
const validMult = (x, lo, hi) => (x != null && isFinite(x) && x >= lo && x <= hi ? Math.round(x * 100) / 100 : null);
const yearOf = t => +String(t.date || t.closed || '').slice(0, 4) || null;
// Capital IQ is US-based: text dates are month/day/year unless the first number can only be a day.
function txDate(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (!m) return Engine.parseDate(v);
  let [a, b] = [+m[1], +m[2]];
  if (a > 12) [a, b] = [b, a];
  return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}
// "Germany (Primary); Austria" -> "Germany"
const cleanCountry = s => String(s || '').split(/[;|]/)[0].replace(/\(.*?\)/g, '').trim();

function rowToTx(row, map, file, currency) {
  const t = { source: file, currency };
  map.forEach((f, i) => {
    if (!f) return;
    const v = row[i];
    if (v === '' || v == null) return;
    if (['ev', 'deal_value', 'revenue', 'ebitda', 'employees', 'ev_revenue', 'ev_ebitda', 'ev_ebit', 'stake'].includes(f)) t[f] = num(v);
    else if (f === 'date' || f === 'closed') t[f] = txDate(v);
    else if (f === 'country') t[f] = cleanCountry(v);
    else t[f] = norm(v);
  });
  if (!t.target) return null;
  // Fill multiples from EV and financials where the export didn't include them; drop implausible values.
  const ev = t.ev ?? (t.deal_value != null && (t.stake == null || t.stake >= 95) ? t.deal_value : null);
  if (t.ev_revenue == null && ev && t.revenue > 0) t.ev_revenue = ev / t.revenue;
  if (t.ev_ebitda == null && ev && t.ebitda > 0) t.ev_ebitda = ev / t.ebitda;
  t.ev_revenue = validMult(t.ev_revenue, 0.1, 40);
  t.ev_ebitda = validMult(t.ev_ebitda, 1, 80);
  t.ev_ebit = validMult(t.ev_ebit, 1, 120);
  if (t.ev == null && ev != null) t.ev = ev;
  t.year = yearOf(t);
  t.key = t.id || `${Engine.normName(t.target)}|${t.year || ''}|${Engine.normName(t.buyer || '')}`;
  return t;
}

async function importTransactionFiles(files) {
  const incoming = [], report = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
        if (rows.length < 2) continue;
        const h = detectTxHeaderRow(rows);
        const headers = rows[h].map(v => norm(v));
        const map = mapTxHeaders(headers);
        if (!map.includes('target')) continue;
        const title = rows.slice(0, h + 1).flat().join(' ');
        const currency = /usd|\$/i.test(title) ? 'USD' : /gbp|£/i.test(title) ? 'GBP' : /eur|€/i.test(title) ? 'EUR' : 'USD';
        const txs = rows.slice(h + 1).map(r => rowToTx(r, map, f.name, currency)).filter(Boolean);
        incoming.push(...txs);
        report.push({ file: f.name, sheet: name, rows: txs.length, map: headers.map((x, i) => map[i] ? `${x} → ${TX_LABELS[map[i]]}` : null).filter(Boolean), ignored: headers.filter((x, i) => x && !map[i]) });
      }
    } catch (err) { toast(`Could not read ${f.name}: ${err.message}`, 7000); }
  }
  if (!incoming.length) return toast('No transactions found. The sheet needs at least a target/company column.', 7000);
  const preview = report.map(r => `${r.file} › ${r.sheet}: ${r.rows} rows\n   ${r.map.join('\n   ')}${r.ignored.length ? `\n   ignored: ${r.ignored.join(', ')}` : ''}`).join('\n\n');
  if (!confirm(`Import ${incoming.length} transactions?\n\n${preview.slice(0, 2500)}`)) return;
  const byKey = new Map(state.transactions.map(t => [t.key, t]));
  let added = 0, updated = 0;
  for (const t of incoming) {
    const cur = byKey.get(t.key);
    if (cur) { for (const [k, v] of Object.entries(t)) if (v != null && v !== '' && (cur[k] == null || cur[k] === '')) cur[k] = v; updated++; }
    else { byKey.set(t.key, t); added++; }
  }
  state.transactions = [...byKey.values()];
  await saveTransactions();
  renderComps();
  toast(`Transactions: ${added} new, ${updated} already known (details filled in).`, 7000);
}

// ---------- Similarity ----------
const STOP = new Set('the and for with from that this its are was has have which their into over also other more based provider providers company companies group holding services service solutions solution software platform platforms products product offering offers provides developer develops leading global international inc ltd gmbh bv ag sa llc limited corp corporation business businesses customers clients market markets industry industries technology technologies digital data management systems system'.split(' '));
const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)));
const phrasesOf = s => [...new Set(String(s || '').toLowerCase().split(/[;,|/]+/).map(x => x.trim()).filter(x => x.length > 2 && !STOP.has(x)))];
const REGION_OF = c => Engine.regionOf({ country: c }) || (/europe/i.test(c || '') ? 'Europe' : /america|united states|usa|canada/i.test(c || '') ? 'North America' : '');
const EUROPE = new Set(['Benelux', 'DACH', 'UK & Ireland', 'Nordics', 'France', 'Southern Europe', 'CEE', 'Europe']);

function compareTx(profile, t, prep) {
  const text = ' ' + [t.description, t.industry, t.target].join(' ').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ') + ' ';
  const hits = prep.phrases.filter(p => text.includes(' ' + p.replace(/[^a-z0-9à-ÿ]+/g, ' ').trim() + ' '));
  const tw = words(text);
  const shared = [...prep.words].filter(w => tw.has(w));
  const cos = prep.words.size && tw.size ? Math.min(1, (shared.length / Math.sqrt(prep.words.size * tw.size)) * 2.5) : 0;
  const textScore = Math.max(prep.phrases.length ? hits.length / Math.min(3, prep.phrases.length) : 0, cos);
  const ind = String(t.industry || '').toLowerCase();
  const indScore = prep.segments.some(s => ind.includes(s)) ? 1 : prep.segments.some(s => s.split(' ').some(w => w.length > 4 && ind.includes(w))) ? 0.5 : 0;
  let sizeScore = 0.4, sizeWhy = '';
  if (profile.revenue > 0 && t.revenue > 0) { const r = Math.abs(Math.log(profile.revenue / t.revenue)); sizeScore = Math.max(0, 1 - r / Math.log(10)); if (sizeScore > 0.6) sizeWhy = `similar size (${Engine.fmt(t.revenue)}m revenue)`; }
  else if (profile.employees > 0 && t.employees > 0) { const r = Math.abs(Math.log(profile.employees / t.employees)); sizeScore = Math.max(0, 1 - r / Math.log(10)); }
  const age = t.year ? new Date().getFullYear() - t.year : null;
  const recency = age == null ? 0.4 : age <= 2 ? 1 : age <= 5 ? 0.8 : age <= 8 ? 0.55 : 0.3;
  const tc = String(t.country || '').toLowerCase(), pc = String(profile.country || '').toLowerCase();
  const tr = REGION_OF(t.country), pr = REGION_OF(profile.country);
  const geo = !tc ? 0.4 : pc && tc.includes(pc) ? 1 : pr && tr === pr ? 0.75 : EUROPE.has(pr) && EUROPE.has(tr) ? 0.5 : 0.25;
  const score = 0.4 * textScore + 0.15 * indScore + 0.2 * sizeScore + 0.15 * recency + 0.1 * geo;
  const why = [hits.length ? `matches ${hits.slice(0, 3).join(', ')}` : shared.length ? `shares ${shared.slice(0, 3).join(', ')}` : '', indScore === 1 ? 'same industry' : '', sizeWhy, geo >= 0.75 && t.country ? `${t.country}` : '', age != null && age <= 3 ? `recent (${t.year})` : ''].filter(Boolean);
  return { t, score: Math.round(score * 100), why };
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const stat = list => ({ n: list.length, p25: percentile(list, 0.25), median: percentile(list, 0.5), p75: percentile(list, 0.75) });

// ---------- 10-factor software scorecard ----------
const GRADES = ['A', 'B', 'C', 'D', 'E'];
const PREMIUM = { A: 0.25, B: 0.12, C: 0, D: -0.12, E: -0.25 };
const band = (v, cuts, lowerIsBetter) => { if (v == null || v === '' || isNaN(v)) return null; const x = Number(v); const i = cuts.findIndex(c => (lowerIsBetter ? x <= c : x >= c)); return GRADES[i < 0 ? 4 : i]; };
const FACTORS = [
  { k: 'growth', label: 'Revenue growth', unit: '% YoY', w: 15, grade: v => band(v, [30, 20, 10, 0]), why: 'Buyers pay for growth: fast-growing software companies trade at clearly higher revenue multiples.', tip: 'Show a credible pipeline and 2–3 years of growth; push upsell and new logos ahead of the sale.' },
  { k: 'recurring', label: 'Recurring revenue', unit: '% of revenue', w: 15, grade: v => band(v, [80, 60, 40, 20]), why: 'Subscription and maintenance revenue is predictable and valued far above project or licence revenue.', tip: 'Convert licences and services into subscriptions or multi-year contracts; report ARR monthly.' },
  { k: 'margin', label: 'EBITDA margin', unit: '%', w: 12, grade: v => band(v, [30, 20, 10, 0]), why: 'Profitability drives EBITDA-based valuations and shows the business model is scalable.', tip: 'Normalise one-offs and owner costs (adjusted EBITDA); keep cost growth below revenue growth.' },
  { k: 'gross', label: 'Gross margin', unit: '%', w: 8, grade: v => band(v, [80, 70, 60, 50]), why: 'High gross margins signal a product business rather than a services business.', tip: 'Reduce hosting and third-party costs; separate services revenue so the product margin is visible.' },
  { k: 'retention', label: 'Net revenue retention', unit: '%', w: 12, grade: v => band(v, [115, 105, 95, 85]), why: 'Customers that stay and spend more are the strongest proof of product value.', tip: 'Track cohorts, reduce churn with customer success, and price for expansion (modules, seats, usage).' },
  { k: 'concentration', label: 'Top-10 customers', unit: '% of revenue', w: 8, lower: true, grade: v => band(v, [15, 25, 40, 60], true), why: 'Dependence on a few customers is a key risk and often leads to earn-outs or price reductions.', tip: 'Broaden the customer base; secure long-term contracts with the largest accounts before the process.' },
  { k: 'scale', label: 'Scale', unit: 'revenue EUR m', w: 8, grade: v => band(v, [50, 20, 10, 3]), why: 'Larger companies attract more (and larger) buyers and carry less execution risk.', tip: 'Consider a buy-and-build step or partnership to cross the next size threshold.' },
  { k: 'position', label: 'Market position & product differentiation', w: 8, qual: true, why: 'A defensible niche, IP or a top-3 position in a vertical commands a premium.', tip: 'Document USPs, win rates against competitors and references; protect IP.' },
  { k: 'management', label: 'Management depth (independent of founders)', w: 7, qual: true, why: 'Buyers discount businesses that depend on the founders for sales or product.', tip: 'Build a second management layer and hand over key customer relationships before the sale.' },
  { k: 'international', label: 'International footprint & addressable market', w: 7, qual: true, why: 'A large addressable market and proven international sales widen the buyer universe.', tip: 'Show traction outside the home market, localisation and partner channels.' },
];

function scorecard(proj) {
  const v = proj.valuation || {}, inp = v.inputs || {}, t = proj.target || {};
  const auto = { margin: inp.margin ?? (t.revenue > 0 && t.ebitda != null ? (t.ebitda / t.revenue) * 100 : null), scale: inp.scale ?? t.revenue };
  const rows = FACTORS.map(f => {
    const value = f.qual ? null : (inp[f.k] ?? auto[f.k] ?? null);
    const computed = f.qual ? null : f.grade(value);
    const grade = v.grades?.[f.k] || computed || 'C';
    return { ...f, value, grade, assessed: !!(v.grades?.[f.k] || computed), premium: PREMIUM[grade] };
  });
  const adj = rows.reduce((a, r) => a + (r.w * r.premium) / 100, 0);
  return { rows, adj, assessed: rows.filter(r => r.assessed).length };
}

// ---------- Valuation ----------
function compsFor(proj) {
  const v = proj.valuation || {};
  const profile = dealOf(proj);
  const prep = { phrases: phrasesOf(profile.keywords), words: words([profile.description, profile.keywords, profile.sector, profile.subsector].join(' ')), segments: phrasesOf([profile.sector, profile.subsector].join('/')) };
  const yearsBack = Number(v.yearsBack) || 10, minYear = new Date().getFullYear() - yearsBack;
  const region = v.region || '';
  const pool = state.transactions.filter(t => (t.ev_revenue || t.ev_ebitda) && (!t.year || t.year >= minYear) && (!region || (region === 'Europe' ? EUROPE.has(REGION_OF(t.country)) : REGION_OF(t.country) === region)) && !/minority/i.test(t.type || ''));
  const ranked = pool.map(t => compareTx(profile, t, prep)).sort((a, b) => b.score - a.score);
  const used = ranked.slice(0, Number(v.nComps) || 50);
  return { pool: pool.length, used, closest: used.slice(0, 6), rev: stat(used.map(x => x.t.ev_revenue).filter(x => x != null)), ebitda: stat(used.map(x => x.t.ev_ebitda).filter(x => x != null)) };
}

function valuate(proj) {
  const t = proj.target || {};
  const comps = compsFor(proj), sc = scorecard(proj);
  const f = 1 + sc.adj;
  const methods = [];
  if (t.revenue > 0 && comps.rev.n >= 3) methods.push({ k: 'EV / Revenue', metric: t.revenue, s: comps.rev });
  const margin = t.revenue > 0 && t.ebitda != null ? t.ebitda / t.revenue : null;
  if (t.ebitda > 0 && comps.ebitda.n >= 3) methods.push({ k: 'EV / EBITDA', metric: t.ebitda, s: comps.ebitda, weak: margin != null && margin < 0.1 });
  for (const m of methods) m.range = ['p25', 'median', 'p75'].map(q => m.s[q] * f * m.metric);
  const useful = methods.filter(m => !m.weak);
  const blend = useful.length ? [0, 1, 2].map(i => useful.reduce((a, m) => a + m.range[i], 0) / useful.length) : null;
  const netDebt = Number(proj.valuation?.inputs?.net_debt) || 0;
  const levers = sc.rows.filter(r => r.grade !== 'A').map(r => ({ ...r, uplift: (r.w * (PREMIUM[GRADES[Math.max(0, GRADES.indexOf(r.grade) - 1)]] - r.premium)) / 100 }))
    .sort((a, b) => b.uplift - a.uplift).slice(0, 4);
  return { comps, sc, methods, blend, equity: blend ? blend.map(x => x - netDebt) : null, netDebt, levers };
}

// ---------- Rendering: Valuation tab ----------
const vpct = x => (x == null ? '–' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);
const mult = x => (x == null ? '–' : `${x.toFixed(1)}x`);
function gradeChip(g, k) { return `<span class="grade g${g}" ${k ? `data-gk="${k}"` : ''}>${g}</span>`; }

function renderValuationTab(proj, el) {
  if (!state.transactions.length) {
    el.innerHTML = `<div class="empty">No transactions yet. Import your Capital IQ transaction export first (it can be several files).<br><br>
      <button class="btn primary" data-vx="gocomps">Go to Comps & valuation</button></div>`;
    return;
  }
  const t = proj.target || {};
  if (!t.revenue && !t.ebitda) {
    el.innerHTML = `<div class="empty">Add revenue and/or EBITDA (and keywords) to the deal profile to value this company.<br><br><button class="btn primary" data-x="editProfile">Edit deal profile</button></div>`;
    return;
  }
  const v = proj.valuation || {}, inp = v.inputs || {};
  const r = valuate(proj);
  const regions = ['', 'Europe', 'DACH', 'Benelux', 'UK & Ireland', 'Nordics', 'France', 'Southern Europe', 'CEE', 'North America'];
  const input = (k, ph) => `<input class="vin" data-vin="${k}" value="${inp[k] ?? ''}" placeholder="${ph}">`;
  el.innerHTML = `<div class="val-grid">
    <div class="card val-result" style="order:1">
      <div class="toolbar" style="margin-bottom:4px"><h2 style="margin:0">Valuation range</h2><span class="spacer"></span><button class="btn sm" data-vx="report">Valuation report</button></div>
      ${r.blend ? `<div class="val-big"><div><span>Low</span><b>${eur(r.blend[0])}</b></div><div class="mid"><span>Mid</span><b>${eur(r.blend[1])}</b></div><div><span>High</span><b>${eur(r.blend[2])}</b></div></div>
        <div class="muted small">Enterprise value. Median of the ${r.comps.used.length} most comparable transactions (P25–P75), adjusted ${vpct(r.sc.adj)} by the scorecard.${r.netDebt ? ` Equity value after net debt: ${eur(r.equity[0])}–${eur(r.equity[2])}.` : ''}</div>`
        : '<div class="empty">Not enough comparable transactions with multiples (need at least 3). Widen the filters below.</div>'}
      <table class="compact" style="margin-top:10px"><thead><tr><th>Method</th><th class="num">Metric</th><th class="num">P25</th><th class="num">Median</th><th class="num">P75</th><th class="num">n</th><th class="num">Mid EV</th></tr></thead><tbody>
        ${r.methods.map(m => `<tr class="${m.weak ? 'muted' : ''}"><td>${m.k}${m.weak ? ' <span class="small">(low margin, not used)</span>' : ''}</td><td class="num">${eur(m.metric)}</td><td class="num">${mult(m.s.p25)}</td><td class="num"><b>${mult(m.s.median)}</b></td><td class="num">${mult(m.s.p75)}</td><td class="num">${m.s.n}</td><td class="num"><b>${eur(m.range[1])}</b></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No method available.</td></tr>'}
      </tbody></table>
      <div class="toolbar" style="margin-top:10px"><label class="row-label small">Net debt (EUR m) ${input('net_debt', '0')}</label></div>
    </div>

    <div class="card span2" style="order:3">
      <h2>Comparable transactions</h2>
      <div class="toolbar">
        <label class="row-label small">Last <input class="vin" data-vset="yearsBack" value="${v.yearsBack || 10}" style="width:46px"> years</label>
        <label class="row-label small">Region <select data-vset="region">${regions.map(x => `<option value="${x}" ${x === (v.region || '') ? 'selected' : ''}>${x || 'All'}</option>`).join('')}</select></label>
        <label class="row-label small">Use top <input class="vin" data-vset="nComps" value="${v.nComps || 50}" style="width:46px"></label>
      </div>
      <p class="muted small">${r.comps.pool.toLocaleString()} transactions with a multiple match the filters; the ${r.comps.used.length} most similar (by business description and keywords, industry, size, recency and geography) are used.</p>
      <table class="compact"><thead><tr><th>Date</th><th>Target</th><th>Buyer</th><th class="num">Revenue</th><th class="num">EV/Rev</th><th class="num">EV/EBITDA</th><th class="num">Fit</th></tr></thead><tbody>
        ${r.comps.closest.map(x => `<tr title="${esc(x.t.description || '')}"><td class="small">${esc(x.t.date || x.t.year || '')}</td><td><b>${esc(x.t.target)}</b><div class="muted small">${esc([x.t.country, x.t.industry].filter(Boolean).join(' · ').slice(0, 70))}</div><div class="small">${esc(x.why.join(' · '))}</div></td>
          <td class="small">${esc(x.t.buyer || '')}</td><td class="num">${x.t.revenue != null ? Engine.fmt(x.t.revenue) : '–'}</td><td class="num">${mult(x.t.ev_revenue)}</td><td class="num">${mult(x.t.ev_ebitda)}</td><td class="num"><span class="chip">${x.score}</span></td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">The 6 closest transactions; hover a row for the business description. Amounts in the transaction's currency (usually USD m).</p>
    </div>

    <div class="card span2" style="order:4">
      <div class="toolbar" style="margin-bottom:4px"><h2 style="margin:0">Scorecard: 10 value drivers</h2><span class="spacer"></span><span class="muted small">${r.sc.assessed} of 10 assessed · total adjustment <b class="${r.sc.adj >= 0 ? 'ok' : 'err'}">${vpct(r.sc.adj)}</b> on the median multiples</span></div>
      <table class="compact scorecard"><thead><tr><th>Factor</th><th>Input</th><th>Grade (click to set)</th><th class="num">Weight</th><th class="num">Effect</th><th>Why it matters</th></tr></thead><tbody>
        ${r.sc.rows.map(f => `<tr class="${f.assessed ? '' : 'muted'}"><td><b>${esc(f.label)}</b></td>
          <td>${f.qual ? '<span class="muted small">judgement</span>' : `${input(f.k, f.k === 'margin' && f.value != null ? Math.round(f.value) : f.k === 'scale' && f.value != null ? f.value : '')} <span class="muted small">${esc(f.unit)}</span>`}</td>
          <td class="grades">${GRADES.map(g => `<button class="grade g${g} ${g === f.grade ? 'on' : ''}" data-grade="${f.k}" data-g="${g}">${g}</button>`).join('')}${proj.valuation?.grades?.[f.k] ? ` <button class="link small" data-grade-reset="${f.k}">auto</button>` : ''}</td>
          <td class="num">${f.w}%</td><td class="num ${f.premium > 0 ? 'ok' : f.premium < 0 ? 'err' : ''}">${vpct((f.w * f.premium) / 100)}</td><td class="small muted">${esc(f.why)}</td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">Grades: A +25%, B +12%, C neutral, D −12%, E −25% on that factor, weighted. Number fields are graded automatically (e.g. growth ≥30% = A); unassessed factors count as C.</p>
    </div>

    <div class="card" style="order:2">
      <h2>How to increase the valuation</h2>
      ${r.levers.length ? `<div class="levers">${r.levers.map(l => `<div class="lever"><div>${gradeChip(l.grade)} → ${gradeChip(GRADES[Math.max(0, GRADES.indexOf(l.grade) - 1)])} <b>${esc(l.label)}</b> <span class="ok small">${vpct(l.uplift)} on the multiple</span></div><div class="small">${esc(l.tip)}</div></div>`).join('')}</div>` : '<div class="empty">All factors are graded A.</div>'}
    </div>
  </div>`;
}

// ---------- Rendering: Comps page ----------
const cf = { q: '', country: '', from: '', withMult: true, limit: 300 };
function filteredTx() {
  const q = cf.q.toLowerCase();
  return state.transactions.filter(t => (!cf.withMult || t.ev_revenue || t.ev_ebitda) && (!cf.country || String(t.country || '').includes(cf.country)) && (!cf.from || (t.year || 0) >= +cf.from) &&
    (!q || [t.target, t.buyer, t.seller, t.industry, t.description].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
function renderComps() {
  if (!$('#compsView')) return;
  const all = state.transactions, list = filteredTx();
  const s1 = stat(list.map(t => t.ev_revenue).filter(x => x != null)), s2 = stat(list.map(t => t.ev_ebitda).filter(x => x != null));
  const countries = [...new Set(all.map(t => t.country).filter(Boolean).map(c => c.split(/[;,(]/)[0].trim()))].sort().slice(0, 200);
  $('#compsView').innerHTML = `<div class="page-head"><div><h1>Comps & valuation</h1><div class="muted">${all.length.toLocaleString()} transactions · ${all.filter(t => t.ev_revenue).length.toLocaleString()} with EV/Revenue · ${all.filter(t => t.ev_ebitda).length.toLocaleString()} with EV/EBITDA</div></div>
      <div class="actions">${all.length ? '<button class="btn danger" data-vx="cleartx">Delete all transactions</button>' : ''}
        <label class="btn primary">Import Capital IQ transactions<input type="file" id="txUpload" accept=".xlsx,.xls,.csv" multiple hidden></label></div></div>
    ${all.length ? `<div class="kpis">
        <div class="kpi"><div class="k">Filtered deals</div><div class="v">${list.length.toLocaleString()}</div></div>
        <div class="kpi"><div class="k">Median EV/Revenue</div><div class="v">${mult(s1.median)}</div><div class="muted small">P25–P75 ${mult(s1.p25)}–${mult(s1.p75)} · n=${s1.n}</div></div>
        <div class="kpi"><div class="k">Median EV/EBITDA</div><div class="v">${mult(s2.median)}</div><div class="muted small">P25–P75 ${mult(s2.p25)}–${mult(s2.p75)} · n=${s2.n}</div></div>
      </div>
      <div class="filters">
        <input type="search" id="cfQ" placeholder="Search target, buyer, industry, description… (e.g. document management)" value="${esc(cf.q)}">
        <select id="cfCountry"><option value="">All countries</option>${countries.map(c => `<option ${c === cf.country ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label class="row-label">From year <input id="cfFrom" value="${esc(cf.from)}" placeholder="2015" style="width:70px"></label>
        <label class="check"><input type="checkbox" id="cfMult" ${cf.withMult ? 'checked' : ''}> Only with multiples</label>
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Target</th><th>Buyer</th><th>Seller</th><th>Country</th><th class="num">EV</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">EV/Rev</th><th class="num">EV/EBITDA</th></tr></thead><tbody>
        ${list.slice(0, cf.limit).map(t => `<tr title="${esc(t.description || '')}"><td class="small">${esc(t.date || t.year || '')}</td><td><b>${esc(t.target)}</b><div class="co-sub">${esc(t.industry || '')}</div></td><td class="small">${esc(t.buyer || '')}</td><td class="small">${esc(t.seller || '')}</td><td class="small">${esc(t.country || '')}</td>
          <td class="num">${t.ev != null ? Engine.fmt(t.ev) : ''}</td><td class="num">${t.revenue != null ? Engine.fmt(t.revenue) : ''}</td><td class="num">${t.ebitda != null ? Engine.fmt(t.ebitda) : ''}</td><td class="num">${mult(t.ev_revenue)}</td><td class="num">${mult(t.ev_ebitda)}</td></tr>`).join('')}
      </tbody></table>${list.length > cf.limit ? `<div id="moreTx" style="padding:10px;text-align:center"><button class="btn" data-vx="moretx">Show more (${(list.length - cf.limit).toLocaleString()} left)</button></div>` : ''}</div>`
    : `<div class="card narrow"><h2>Import your Capital IQ transactions</h2>
        <ol class="small"><li>In Capital IQ: <b>Screening → Transactions</b>. Criteria: M&A, status Closed, target industry Software, Europe + North America, announced 2015–today, percent sought ≥ 50%.</li>
        <li>Columns: Target/Issuer, Announced date, Closed date, Buyers/Investors, Sellers, Total Transaction Value, Implied Enterprise Value, Implied EV/Revenue, Implied EV/EBITDA, Target LTM revenue and EBITDA, Target employees, Target country/geography, Primary industry, Business description, Percent sought, Transaction ID.</li>
        <li>Export to Excel (split by period if there are too many rows) and import here. Columns are recognised automatically; re-importing updates instead of duplicating.</li></ol></div>`}`;
}

// ---------- Report ----------
function openValuationReport(proj) {
  const r = valuate(proj), t = proj.target || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(proj.name)} – valuation ${today()}</title>
  <style>body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#14181f;max-width:880px;margin:32px auto;padding:0 24px;font-size:13px;line-height:1.5}h1{font-size:22px;margin:0}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#475467;border-bottom:1px solid #e6e8ec;padding-bottom:4px;margin-top:26px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eef0f3;vertical-align:top}
  th{font-size:11px;color:#667085;text-transform:uppercase}.num{text-align:right}.big{display:flex;gap:12px;margin:14px 0}.big div{flex:1;border:1px solid #e6e8ec;border-radius:8px;padding:12px;text-align:center}.big b{display:block;font-size:22px}
  .g{display:inline-block;width:22px;text-align:center;border-radius:4px;font-weight:700;color:#fff}.gA{background:#067647}.gB{background:#4ca30d}.gC{background:#98a2b3}.gD{background:#dc6803}.gE{background:#b42318}.muted{color:#667085}@media print{.noprint{display:none}}</style></head><body>
  <div class="noprint"><button onclick="print()">Print / save as PDF</button></div>
  <div class="muted">33 Equity · Indicative valuation · ${today()}</div>
  <h1>${esc(t.codename || proj.name)}</h1><div class="muted">${esc([t.sector, t.country].filter(Boolean).join(' · '))}${t.revenue ? ` · revenue ${eur(t.revenue)}` : ''}${t.ebitda != null ? ` · EBITDA ${eur(t.ebitda)}` : ''}</div>
  ${r.blend ? `<div class="big"><div>Low<b>${eur(r.blend[0])}</b></div><div>Mid<b>${eur(r.blend[1])}</b></div><div>High<b>${eur(r.blend[2])}</b></div></div>
  <p>Indicative enterprise value based on the ${r.comps.used.length} most comparable transactions out of ${r.comps.pool.toLocaleString()} relevant deals, adjusted by ${vpct(r.sc.adj)} for the company's value drivers below.</p>` : '<p>Not enough comparable transactions to calculate a range.</p>'}
  <h2>Market multiples of comparable transactions</h2><table><tr><th>Method</th><th class="num">P25</th><th class="num">Median</th><th class="num">P75</th><th class="num">Deals</th><th class="num">Implied EV (mid)</th></tr>
  ${r.methods.map(m => `<tr><td>${m.k}</td><td class="num">${mult(m.s.p25)}</td><td class="num"><b>${mult(m.s.median)}</b></td><td class="num">${mult(m.s.p75)}</td><td class="num">${m.s.n}</td><td class="num">${eur(m.range[1])}</td></tr>`).join('')}</table>
  <h2>Value drivers (10 factors)</h2><table><tr><th>Factor</th><th>Grade</th><th class="num">Weight</th><th class="num">Effect</th><th>Assessment</th></tr>
  ${r.sc.rows.map(f => `<tr><td><b>${esc(f.label)}</b>${f.value != null && !f.qual ? `<div class="muted">${Math.round(f.value * 10) / 10} ${esc(f.unit || '')}</div>` : ''}</td><td><span class="g g${f.grade}">${f.grade}</span></td><td class="num">${f.w}%</td><td class="num">${vpct((f.w * f.premium) / 100)}</td><td class="muted">${esc(f.why)}</td></tr>`).join('')}</table>
  <h2>Six most comparable transactions</h2><table><tr><th>Date</th><th>Target</th><th>Buyer</th><th class="num">Revenue</th><th class="num">EV</th><th class="num">EV/Rev</th><th class="num">EV/EBITDA</th></tr>
  ${r.comps.closest.map(x => `<tr><td>${esc(x.t.date || x.t.year || '')}</td><td><b>${esc(x.t.target)}</b><div class="muted">${esc((x.t.description || x.t.industry || '').slice(0, 160))}</div></td><td>${esc(x.t.buyer || '')}</td><td class="num">${x.t.revenue != null ? Engine.fmt(x.t.revenue) : '–'}</td><td class="num">${x.t.ev != null ? Engine.fmt(x.t.ev) : '–'}</td><td class="num">${mult(x.t.ev_revenue)}</td><td class="num">${mult(x.t.ev_ebitda)}</td></tr>`).join('')}</table>
  <h2>How to increase the valuation</h2><ul>${r.levers.map(l => `<li><b>${esc(l.label)}</b> (${l.grade} → ${GRADES[Math.max(0, GRADES.indexOf(l.grade) - 1)]}, ${vpct(l.uplift)} on the multiple): ${esc(l.tip)}</li>`).join('')}</ul>
  <p class="muted" style="margin-top:24px">Indicative only, based on public transaction data and the information provided; not a fairness opinion. Transaction amounts are in the reported currency (usually USD m).</p></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to open the report.');
  w.document.write(html);
  w.document.close();
}

// ---------- Events ----------
function setVal(proj, fn) { proj.valuation ??= {}; fn(proj.valuation); saveProjects(); renderProjects(); }
document.addEventListener('click', e => {
  const x = e.target.closest('[data-vx]')?.dataset.vx;
  const proj = state.projects.find(p => p.name === state.projectView);
  if (x === 'gocomps') return showTab('comps');
  if (x === 'report' && proj) return openValuationReport(proj);
  if (x === 'moretx') { cf.limit += 300; return renderComps(); }
  if (x === 'cleartx' && confirm(`Delete all ${state.transactions.length} transactions?`)) { state.transactions = []; saveTransactions().then(renderComps); return; }
  const g = e.target.closest('[data-grade]');
  if (g && proj) return setVal(proj, v => { v.grades ??= {}; v.grades[g.dataset.grade] = g.dataset.g; });
  const gr = e.target.closest('[data-grade-reset]');
  if (gr && proj) return setVal(proj, v => { delete v.grades?.[gr.dataset.gradeReset]; });
});
document.addEventListener('change', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  const t = e.target;
  if (t.id === 'txUpload') { const files = [...t.files]; t.value = ''; if (files.length) importTransactionFiles(files); return; }
  if (t.dataset.vin && proj) return setVal(proj, v => { v.inputs ??= {}; const n = Engine.parseNumber(t.value); if (n == null) delete v.inputs[t.dataset.vin]; else v.inputs[t.dataset.vin] = n; });
  if (t.dataset.vset && proj) return setVal(proj, v => { v[t.dataset.vset] = t.value; });
  if (t.id === 'cfCountry') { cf.country = t.value; renderComps(); }
  if (t.id === 'cfMult') { cf.withMult = t.checked; renderComps(); }
  if (t.id === 'cfFrom') { cf.from = t.value.trim(); renderComps(); }
});
let cfTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'cfQ') return;
  cf.q = e.target.value;
  clearTimeout(cfTimer);
  cfTimer = setTimeout(() => { renderComps(); const s = $('#cfQ'); s.focus(); s.setSelectionRange(cf.q.length, cf.q.length); }, 250);
});
