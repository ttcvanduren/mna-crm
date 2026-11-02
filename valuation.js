/* global Engine, Store, XLSX, state, esc, norm, toast, showTab, saveProjects, dealOf, eur, members, renderProjects, today, newCompany, touch, flush, renderCompanies, mergeAcquisitions */
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
  ['summary', /dealsummary|synopsis|transactioncomments|dealcomments/],
  ['tags', /topictag|^tags|keywords/],
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
const TX_LABELS = { id: 'Transaction ID', date: 'Announced', closed: 'Closed', target: 'Target', buyer: 'Buyer', seller: 'Seller', ev: 'EV (m)', deal_value: 'Deal value (m)', revenue: 'Target revenue (m)', ebitda: 'Target EBITDA (m)', employees: 'Employees', ev_revenue: 'EV/Revenue', ev_ebitda: 'EV/EBITDA', ev_ebit: 'EV/EBIT', description: 'Business description', industry: 'Industry', country: 'Country / location', stake: '% acquired', status: 'Status', type: 'Type', consideration: 'Consideration', website: 'Website', summary: 'Deal summary', tags: 'Topic tags', long_description: 'Long description', region: 'Region', buyer_country: 'Buyer country', buyer_industry: 'Buyer industry', buyer_description: 'Buyer description', tev: 'Target TEV (m)', currency: 'Currency', mined: 'Read from deal text', sources: 'Sources', mult_src: 'Multiple source' };
const hk = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// S&P Capital IQ Pro exports have a row of field codes (SPTR_…) with labels above it (only for text fields) and periods below.
const SPG_CODES = { SPTR_TARGET_NAME: 'target', SPTR_MI_TRANSACTION_ID: 'id', SPTR_ANN_DATE: 'date', SPTR_CLOSED_DATE: 'closed', SPTR_COMPLETION_DATE: 'closed', SPTR_TRANSACTION_TYPE: 'type', SPTR_STATUS: 'status', SPTR_TRANSACTION_VALUE: 'deal_value', 324281: 'buyer', 324283: 'seller', SPTR_MI_TARGET_PRIMARY_INDUSTRY: 'industry', 326140: 'region', SPTR_DEAL_SUMMARY: 'summary', SPTR_TARGET_COUNTRY: 'country', SPTR_ACQUIRER_COUNTRY: 'buyer_country', SPTR_TARGET_CIQ_TOTAL_REV: 'revenue', SPTR_TARGET_CIQ_EBITDA: 'ebitda', SPTR_SNL_TOTAL_REV: 'revenue', SPTR_SNL_EBITDA: 'ebitda', SPTR_TARGET_TEV: 'tev', SPTR_TV_TO_SALES: 'ev_revenue', SPTR_TV_TO_EBITDA: 'ev_ebitda' };
// Target financials come in USD thousands; transaction values and TEV in USD millions.
const SPG_SCALE = { SPTR_TARGET_CIQ_TOTAL_REV: 0.001, SPTR_TARGET_CIQ_EBITDA: 0.001 };
const SPG_LABELS = [['description', /^business description.*target/], ['long_description', /^long business description.*target/], ['tags', /topic tags.*target/], ['industry', /primary industry.*target/], ['buyer_industry', /primary industry.*buyer/], ['buyer_description', /^business description.*buyer/]];
function spgLayout(rows) {
  const ci = rows.slice(0, 15).findIndex(r => r.some(v => /^SPTR_/.test(String(v))));
  if (ci < 0) return null;
  const codes = rows[ci], labels = rows[ci - 1] || [], map = codes.map(() => null), taken = new Set();
  const headers = codes.map((c, i) => norm(labels[i]).replace(/\s+/g, ' ') || String(c));
  codes.forEach((c, i) => {
    const f = SPG_CODES[String(c).trim()] || SPG_LABELS.find(([, re]) => re.test(headers[i].toLowerCase()))?.[0];
    if (f && !taken.has(f)) { map[i] = f; taken.add(f); }
  });
  return { header: ci + 1, headers, map, scale: codes.map(c => SPG_SCALE[String(c).trim()] || 1) };
}

function mapTxHeaders(headers) {
  const out = headers.map(() => null), taken = new Set();
  // The CRM's own master file: headers are exactly our labels.
  const byLabel = new Map(Object.entries(TX_LABELS).map(([k, l]) => [hk(l), k]));
  headers.forEach((h, i) => { const f = byLabel.get(hk(h)); if (f && !taken.has(f)) { out[i] = f; taken.add(f); } });
  if (taken.size >= 8) return out;
  out.fill(null); taken.clear();
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
  if (/^\d{5}(\.\d+)?$/.test(String(v ?? '').trim())) return Engine.parseDate(Number(v)); // Excel serial date
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (!m) return Engine.parseDate(v);
  let [a, b] = [+m[1], +m[2]];
  if (a > 12) [a, b] = [b, a];
  return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}
// "Germany (Primary); Austria" -> "Germany"
const cleanCountry = s => String(s || '').split(/[;|]/)[0].replace(/\(.*?\)/g, '').trim();
// S&P wraps values as "Company (value)"; tags and buyer industries are "A (x); A (y)".
const unwrapOwn = (s, name) => (name && s.startsWith(name + ' (') && s.endsWith(')') ? s.slice(name.length + 2, -1) : s);
// "Name (Tag)" -> "Tag"; "Name (SaaS (x))" -> "SaaS (x)", also when S&P uses a slightly different company name.
const tagOf = p => (/\)\)\s*$/.test(p) ? p.match(/^[^()]+\((.+)\)\s*$/)?.[1] : p.match(/\(([^()]*)\)\s*$/)?.[1]) || p;
const lastParens = s => String(s).split(/;\s*/).map(tagOf).filter(Boolean);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);

// ---------- Financials from the deal summary (S&P/Capital IQ deal text) ----------
// Approximate USD rates; only used when the deal text and the USD transaction value are in different currencies.
const FX = { USD: 1, EUR: 1.1, GBP: 1.27, CAD: 0.74, AUD: 0.66, NZD: 0.6, SEK: 0.095, NOK: 0.093, DKK: 0.147, CHF: 1.1, JPY: 0.0075, INR: 0.012, KRW: 0.00078, SGD: 0.74, HKD: 0.128, CNY: 0.145, BRL: 0.2, ZAR: 0.057, PLN: 0.25, ILS: 0.28, MXN: 0.053, TWD: 0.032, MYR: 0.23, THB: 0.029, IDR: 0.000066, PHP: 0.018, TRY: 0.05, AED: 0.27, SAR: 0.27, CZK: 0.044, HUF: 0.0029, RON: 0.22 };
const CUR_RE = '(US\\$|C\\$|A\\$|NZ\\$|HK\\$|S\\$|R\\$|€|\\$|£|¥|₹|₩|EUR|USD|GBP|CAD|AUD|SEK|NOK|DKK|CHF|JPY|INR|KRW|SGD|HKD|CNY|RMB|BRL|ZAR|PLN|NZD|ILS|MXN|TWD|MYR|THB|IDR|PHP|TRY|AED|SAR|CZK|HUF|RON|Rs\\.?|NIS)';
const AMT_RE = CUR_RE + '\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(billion|million|thousand|crores?|lakhs?|mn|bn|m|b|k|cr)?\\b';
const SCALE = { billion: 1e3, bn: 1e3, b: 1e3, million: 1, mn: 1, m: 1, thousand: 1e-3, k: 1e-3, crore: 10, crores: 10, cr: 10, lakh: 0.1, lakhs: 0.1 };
const CUR_ALIAS = { 'us$': 'USD', $: 'USD', 'c$': 'CAD', 'a$': 'AUD', 'nz$': 'NZD', 'hk$': 'HKD', 's$': 'SGD', 'r$': 'BRL', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', rmb: 'CNY', rs: 'INR', 'rs.': 'INR', nis: 'ILS' };
const amount = (c, n, s) => ({ cur: CUR_ALIAS[c.toLowerCase()] || c.toUpperCase(), v: parseFloat(n.replace(/,/g, '')) * (s ? SCALE[s.toLowerCase()] : 1e-6) });
const sentencesOf = t => t.replace(/(\d)\.(\d)/g, '$1§$2').split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/§/g, '.'));
const firstWord = s => String(s || '').split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');

function mineSummary(t) {
  const text = String(t.summary || ''), ss = sentencesOf(text), out = {};
  const tgt = firstWord(t.target), buyer = firstWord(t.buyer);
  // 1. Multiples stated in the text ("7x EBITDA", "EV/FY25 adjusted EBITDA multiple of 6.5x", "3.5x the ARR").
  for (const s of ss) {
    if (/option|earn-?out|expected to grow|market (is|size)/i.test(s)) continue;
    let x, k, m = s.match(/(\d+(?:\.\d+)?)\s?(?:x|times)\s+(?:the\s+|its\s+|of\s+)?(?:[\w'’()-]+\s+){0,5}?(EBITDA|EBIT\b|ARR|recurring revenues?|revenues?|sales|turnover)/i);
    if (m) [x, k] = [+m[1], m[2]];
    else if ((m = s.match(/(?:EV|TEV|enterprise value)\s*\/\s*(?:[\w'’-]+\s+){0,4}?(EBITDA|EBIT\b|revenues?|sales)[^.]{0,40}?(\d+(?:\.\d+)?)\s?x/i))) [x, k] = [+m[2], m[1]];
    if (!m) continue;
    k = k.toLowerCase();
    if (k.startsWith('ebitda')) out.ev_ebitda ??= x;
    else if (k !== 'ebit' && out.ev_revenue == null) { out.ev_revenue = x; out.rev_kind = /arr|recurring/.test(k) ? 'ARR' : 'revenue'; }
  }
  // 2. Enterprise value, revenue and EBITDA amounts; skip sentences about the buyer.
  const evM = text.match(new RegExp('enterprise value (?:of |is |at |was )?(?:approximately |about |around )?' + AMT_RE, 'i'));
  const ev = evM && amount(evM[1], evM[2], evM[3]);
  let rev = null, ebitda = null;
  for (const s of ss) {
    const low = s.toLowerCase();
    if (buyer.length > 2 && low.includes(buyer) && !(tgt.length > 2 && low.includes(tgt))) continue;
    if (!rev) { const m = s.match(new RegExp('(?:revenues?|sales|turnover)\\s+(?:of|was|were|amounted to|totaled|totalled|reached|stood at|in excess of|exceeding)\\s+(?:approximately |about |around |over |more than )?' + AMT_RE, 'i')); if (m) rev = amount(m[1], m[2], m[3]); }
    if (!ebitda) { const m = s.match(new RegExp('EBITDA\\s+(?:of|was|were|amounted to|totaled|totalled|stood at)\\s+(?:approximately |about |around )?(-\\s?|negative )?' + AMT_RE, 'i')); if (m && !m[1]) ebitda = amount(m[2], m[3], m[4]); }
  }
  const usd = a => (a && FX[a.cur] ? a.v * FX[a.cur] : null);
  const evUsd = usd(ev) ?? t.deal_value;
  if (rev && usd(rev)) { out.revenue = usd(rev); out.ev_revenue ??= ev && ev.cur === rev.cur ? ev.v / rev.v : evUsd / out.revenue; }
  if (ebitda && usd(ebitda)) { out.ebitda = usd(ebitda); out.ev_ebitda ??= ev && ev.cur === ebitda.cur ? ev.v / ebitda.v : evUsd / out.ebitda; }
  if (ev && usd(ev)) out.ev = usd(ev);
  return out;
}

const NUM_FIELDS = new Set(['ev', 'tev', 'deal_value', 'revenue', 'ebitda', 'employees', 'ev_revenue', 'ev_ebitda', 'ev_ebit', 'stake']);
function rowToTx(row, map, file, currency, scale = [], master = false) {
  const t = { source: file, sources: [file], currency };
  map.forEach((f, i) => {
    if (!f) return;
    const v = row[i];
    if (v === '' || v == null || v === 'NA') return;
    if (NUM_FIELDS.has(f)) { const n = num(v); if (n != null) t[f] = n * (scale[i] || 1); }
    else if (f === 'date' || f === 'closed') t[f] = txDate(v);
    else if (f === 'country' || f === 'buyer_country') t[f] = cleanCountry(v);
    else if (f === 'mined' || f === 'sources') t[f] = String(v).split(/,\s*/).filter(Boolean);
    else t[f] = norm(v);
  });
  if (!t.target) return null;
  t.sources = [...new Set([file, ...(t.sources || [])])];
  if (!master) cleanTexts(t);
  return finishTx(t);
}
// The master file is already clean, so only fresh exports get their S&P text wrappers removed.
function cleanTexts(t) {
  // Compact the long S&P text fields so thousands of deals stay small.
  if (t.description) t.description = clip(unwrapOwn(t.description, t.target), 800);
  if (t.long_description) { if (!t.description) t.description = clip(unwrapOwn(t.long_description, t.target), 800); delete t.long_description; }
  // Only kept for single-buyer deals, where it unambiguously describes that buyer.
  if (t.buyer_description) { const b = splitBuyers(t.buyer); if (b.length === 1) t.buyer_description = clip(unwrapOwn(t.buyer_description, b[0]), 500); else delete t.buyer_description; }
  if (t.tags) t.tags = [...new Set(t.tags.split(/;\s*/).map(p => (p.startsWith(t.target + ' (') ? unwrapOwn(p, t.target) : tagOf(p))))].join(', ');
  if (t.buyer_industry) t.buyer_industry = [...new Set(lastParens(t.buyer_industry))].join(', ');
  if (/\(/.test(t.industry || '')) t.industry = lastParens(t.industry)[0];
}
function finishTx(t) {
  // Multiples from EV (or the deal value of a whole-company deal) and reported financials.
  const mined = new Set(t.mined || []);
  // Reported EV first, then the deal value of a whole-company deal, then EV read from text, then the target's TEV.
  const ev = (mined.has('ev') ? null : t.ev) ?? (t.deal_value != null && (t.stake == null || t.stake >= 95) ? t.deal_value : null) ?? t.ev ?? t.tev;
  // A multiple computed from a figure that was read from deal text counts as read from deal text too.
  const derive = (k, metric, evValue) => {
    if (t[k] != null || !evValue || !(t[metric] > 0)) return;
    t[k] = evValue / t[metric];
    if (mined.has(metric) || (evValue === t.ev && mined.has('ev'))) mined.add(k);
  };
  derive('ev_revenue', 'revenue', ev); derive('ev_ebitda', 'ebitda', ev);
  // Whatever is still missing is read from the deal summary and marked as such ("mined").
  if (t.summary && !t.mined && (t.ev_revenue == null || t.ev_ebitda == null)) {
    const m = mineSummary(t);
    for (const k of ['revenue', 'ebitda', 'ev']) if (t[k] == null && m[k] != null) { t[k] = Math.round(m[k] * 100) / 100; mined.add(k); }
    if (t.ev_revenue == null && m.ev_revenue != null) { t.ev_revenue = m.ev_revenue; mined.add('ev_revenue'); if (m.rev_kind === 'ARR') mined.add('arr'); }
    if (t.ev_ebitda == null && m.ev_ebitda != null) { t.ev_ebitda = m.ev_ebitda; mined.add('ev_ebitda'); }
    if (mined.has('ev')) { derive('ev_revenue', 'revenue', t.ev); derive('ev_ebitda', 'ebitda', t.ev); }
  }
  if (t.summary) t.summary = clip(t.summary, 1500);
  t.ev_revenue = validMult(t.ev_revenue, 0.15, 30);
  t.ev_ebitda = validMult(t.ev_ebitda, 2, 60);
  t.ev_ebit = validMult(t.ev_ebit, 1, 120);
  if (t.ev == null && ev != null) t.ev = ev;
  t.mined = [...mined].filter(k => k === 'arr' || t[k] != null);
  if (!t.mined.length) delete t.mined;
  multSrc(t);
  t.year = yearOf(t);
  t.key = t.id || `${Engine.normName(t.target)}|${t.year || ''}|${Engine.normName(t.buyer || '')}`;
  return t;
}
// Display label for multiples that came from the deal text rather than reported financials.
function multSrc(t) {
  const m = t.mined || [];
  if (m.includes('ev_revenue') || m.includes('ev_ebitda')) t.mult_src = m.includes('arr') ? 'ARR multiple from deal text' : 'from deal text';
  else delete t.mult_src;
}

// Merges one incoming deal into a known one. Reported figures beat figures read from deal text; otherwise only blanks are filled.
const MINEABLE = ['revenue', 'ebitda', 'ev', 'ev_revenue', 'ev_ebitda'];
function mergeTx(cur, t) {
  const curMined = new Set(cur.mined || []), newMined = new Set(t.mined || []);
  for (const [k, v] of Object.entries(t)) {
    if (v == null || v === '' || ['key', 'mined', 'sources', 'source', 'mult_src'].includes(k)) continue;
    const blank = cur[k] == null || cur[k] === '';
    const better = MINEABLE.includes(k) && curMined.has(k) && !newMined.has(k);
    if (blank || better) { cur[k] = v; if (newMined.has(k)) curMined.add(k); else curMined.delete(k); }
  }
  if (!['ev_revenue', 'ev_ebitda'].some(k => curMined.has(k))) curMined.delete('arr');
  cur.mined = [...curMined];
  if (!cur.mined.length) delete cur.mined;
  cur.sources = [...new Set([...(cur.sources || [cur.source].filter(Boolean)), ...(t.sources || [])])];
  multSrc(cur);
}
// Deals from sources without a shared transaction ID still match on target + year (when that's unambiguous).
const altKey = t => `${Engine.normName(t.target)}|${t.year || ''}`;

async function importTransactionFiles(files) {
  const incoming = [], report = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
        if (rows.length < 2) continue;
        const spg = spgLayout(rows);
        const h = spg ? spg.header : detectTxHeaderRow(rows);
        const headers = spg ? spg.headers : rows[h].map(v => norm(v));
        const map = spg ? spg.map : mapTxHeaders(headers);
        if (!map.includes('target')) continue;
        const title = rows.slice(0, h + 1).flat().join(' ');
        const currency = spg || /usd|\$/i.test(title) ? 'USD' : /gbp|£/i.test(title) ? 'GBP' : /eur|€/i.test(title) ? 'EUR' : 'USD';
        const master = map.includes('sources') || map.includes('mined');
        const txs = rows.slice(h + 1).map(r => rowToTx(r, map, f.name, currency, spg?.scale, master)).filter(Boolean);
        incoming.push(...txs);
        report.push({ file: f.name, sheet: name, rows: txs.length, rev: txs.filter(t => t.revenue != null && !t.mined?.includes('revenue')).length, mult: txs.filter(t => t.ev_revenue || t.ev_ebitda).length, mined: txs.filter(t => t.mult_src).length,
          map: headers.map((x, i) => map[i] ? `${x} → ${TX_LABELS[map[i]]}` : null).filter(Boolean), ignored: [...new Set(headers.filter((x, i) => x && !map[i]))] });
      }
    } catch (err) { toast(`Could not read ${f.name}: ${err.message}`, 7000); }
  }
  if (!incoming.length) return toast('No transactions found. The sheet needs at least a target/company column.', 7000);
  const preview = report.map(r => `${r.file} › ${r.sheet}: ${r.rows.toLocaleString()} deals · ${r.rev.toLocaleString()} with reported revenue · ${r.mult.toLocaleString()} with a multiple${r.mined ? ` (${r.mined.toLocaleString()} read from the deal summary)` : ''}\n   ${r.map.join('\n   ')}${r.ignored.length ? `\n   ignored: ${r.ignored.join(', ').replace(/\n/g, ' ')}` : ''}`).join('\n\n');
  if (!confirm(`Import ${incoming.length.toLocaleString()} transactions? Deals you already have are merged, not duplicated.\n\n${preview.slice(0, 2500)}`)) return;
  const byKey = new Map(state.transactions.map(t => [t.key, t]));
  const byAlt = new Map();
  for (const t of state.transactions) { const k = altKey(t); byAlt.set(k, byAlt.has(k) ? null : t); }
  let added = 0, updated = 0;
  for (const t of incoming) {
    let cur = byKey.get(t.key);
    if (!cur && !(t.id && byAlt.get(altKey(t))?.id)) cur = byAlt.get(altKey(t)) || null; // never merge two deals that both have their own ID
    if (cur) { mergeTx(cur, t); updated++; }
    else { byKey.set(t.key, t); const k = altKey(t); byAlt.set(k, byAlt.has(k) ? null : t); added++; }
  }
  state.transactions = [...new Set(byKey.values())];
  await saveTransactions();
  renderComps();
  toast(`Transactions: ${added.toLocaleString()} new, ${updated.toLocaleString()} merged into deals you already had.`, 8000);
  // Keep Companies in step with the transactions, so Find buyers sees every acquirer.
  await addBuyersToCompanies();
}

// ---------- Similarity ----------
const STOP = new Set('the and for with from that this its are was has have which their into over also other more based provider providers company companies group holding services service solutions solution software platform platforms products product offering offers provides developer develops leading global international inc ltd gmbh bv ag sa llc limited corp corporation business businesses customers clients market markets industry industries technology technologies digital data management systems system'.split(' '));
const words = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(w => w.length > 2 && !STOP.has(w)));
const phrasesOf = s => [...new Set(String(s || '').toLowerCase().split(/[;,|/]+/).map(x => x.trim()).filter(x => x.length > 2 && !STOP.has(x)))];
const REGION_OF = c => Engine.regionOf({ country: c }) || (/europe/i.test(c || '') ? 'Europe' : /america|united states|usa|canada/i.test(c || '') ? 'North America' : '');
const EUROPE = new Set(['Benelux', 'DACH', 'UK & Ireland', 'Nordics', 'France', 'Southern Europe', 'CEE', 'Europe']);
const txRegion = t => REGION_OF(t.country) || (/united states|canada/i.test(t.region || '') ? 'North America' : t.region || '');
const isDead = t => /terminat|withdrawn|cancel|lapsed/i.test(t.status || '');
// One region label per deal for filters and charts: Europe, North America, Asia-Pacific, …
const bigRegion = t => { const r = txRegion(t); return EUROPE.has(r) ? 'Europe' : r || 'Other'; };

function compareTx(profile, t, prep) {
  const text = ' ' + [t.description, t.tags, t.industry, t.target].join(' ').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ') + ' ';
  const hits = prep.phrases.filter(p => text.includes(' ' + p.replace(/[^a-z0-9à-ÿ]+/g, ' ').trim() + ' '));
  const tw = words(text);
  const shared = [...prep.words].filter(w => tw.has(w));
  const cos = prep.words.size && tw.size ? Math.min(1, (shared.length / Math.sqrt(prep.words.size * tw.size)) * 2.5) : 0;
  const textScore = Math.max(prep.phrases.length ? hits.length / Math.min(3, prep.phrases.length) : 0, cos);
  const ind = String(t.industry || '').toLowerCase();
  const indScore = prep.segments.some(s => ind.includes(s)) ? 1 : prep.segments.some(s => s.split(' ').some(w => w.length > 4 && ind.includes(w))) ? 0.5 : 0;
  let sizeScore = 0.4, sizeWhy = '';
  const toEur = x => (x * (FX[t.currency || 'USD'] || 1)) / FX.EUR;
  if (profile.revenue > 0 && t.revenue > 0) { const r = Math.abs(Math.log(profile.revenue / toEur(t.revenue))); sizeScore = Math.max(0, 1 - r / Math.log(10)); if (sizeScore > 0.6) sizeWhy = `similar size (${Engine.fmt(t.revenue)}m revenue)`; }
  else if (profile.employees > 0 && t.employees > 0) { const r = Math.abs(Math.log(profile.employees / t.employees)); sizeScore = Math.max(0, 1 - r / Math.log(10)); }
  // No target revenue: compare the deal value with a typical software EV (~2x revenue) for the profile.
  else if (profile.revenue > 0 && t.deal_value > 0) { const r = Math.abs(Math.log((profile.revenue * 2) / toEur(t.deal_value))); sizeScore = 0.85 * Math.max(0, 1 - r / Math.log(10)); if (sizeScore > 0.55) sizeWhy = `similar deal size (${Engine.fmt(t.deal_value)}m)`; }
  const age = t.year ? new Date().getFullYear() - t.year : null;
  const recency = age == null ? 0.4 : age <= 2 ? 1 : age <= 5 ? 0.8 : age <= 8 ? 0.55 : 0.3;
  const tc = String(t.country || '').toLowerCase(), pc = String(profile.country || '').toLowerCase();
  const tr = txRegion(t), pr = REGION_OF(profile.country);
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
  const pool = state.transactions.filter(t => (t.ev_revenue || t.ev_ebitda) && !isDead(t) && (!t.year || t.year >= minYear) && (!region || (region === 'Europe' ? EUROPE.has(txRegion(t)) : txRegion(t) === region)) && !/minority/i.test(t.type || ''));
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
      <table class="compact"><thead><tr><th>Date</th><th>Target</th><th>Buyer</th><th class="num">Deal value</th><th class="num">Revenue</th><th class="num">EV/Rev</th><th class="num">EV/EBITDA</th><th class="num">Fit</th></tr></thead><tbody>
        ${r.comps.closest.map(x => `<tr title="${esc(x.t.summary || x.t.description || '')}"><td class="small">${esc(x.t.date || x.t.year || '')}</td><td><b>${esc(x.t.target)}</b><div class="muted small">${esc([x.t.country, x.t.industry].filter(Boolean).join(' · ').slice(0, 70))}</div><div class="small">${esc(x.why.join(' · '))}</div></td>
          <td class="small">${esc(x.t.buyer || '')}</td><td class="num">${x.t.deal_value != null ? Engine.fmt(x.t.deal_value) : '–'}</td><td class="num">${x.t.revenue != null ? Engine.fmt(x.t.revenue) : '–'}</td><td class="num">${mult(x.t.ev_revenue)}</td><td class="num">${mult(x.t.ev_ebitda)}${x.t.mult_src ? `<div class="muted small" title="${esc(x.t.mult_src)}">text</div>` : ''}</td><td class="num"><span class="chip">${x.score}</span></td></tr>`).join('')}
      </tbody></table>
      <p class="muted small">The 6 closest transactions; hover a row for the deal summary. Amounts in USD m. "text" = multiple read from the deal summary (S&P doesn't report the financials for every deal).</p>
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
const cf = { q: '', industry: '', region: '', buyer: '', from: '', to: '', minSize: '', maxSize: '', status: 'live', withMult: false, sort: 'date', limit: 200, open: null };
const med = arr => percentile(arr, 0.5);
const splitBuyers = s => String(s || '').split(/;\s*/).map(b => b.replace(/\s*\([^()]*:[^()]*\)\s*$/, '').trim()).filter(Boolean);
const FIN_BUYER = /capital|partners|equity|private|fund|ventures|investment|investors|holdings? (llc|lp)|l\.?p\.?$|advisors|management (llc|lp)/i;
const usdm = x => (x == null ? '–' : x >= 1000 ? `${(x / 1000).toFixed(1)}bn` : `${Engine.fmt(x)}m`);

function filteredTx() {
  const q = cf.q.toLowerCase(), b = cf.buyer.toLowerCase();
  const list = state.transactions.filter(t => (!cf.withMult || t.ev_revenue || t.ev_ebitda) &&
    (cf.status === 'all' || (cf.status === 'live' ? !isDead(t) : /complet|closed|effective/i.test(t.status || ''))) &&
    (!cf.industry || t.industry === cf.industry) && (!cf.region || bigRegion(t) === cf.region) &&
    (!b || String(t.buyer || '').toLowerCase().includes(b)) &&
    (!cf.from || (t.year || 0) >= +cf.from) && (!cf.to || (t.year || 9999) <= +cf.to) &&
    (!cf.minSize || (t.deal_value ?? t.ev ?? -1) >= +cf.minSize) && (!cf.maxSize || (t.deal_value ?? t.ev ?? Infinity) <= +cf.maxSize) &&
    (!q || [t.target, t.buyer, t.seller, t.industry, t.tags, t.description, t.country].join(' ').toLowerCase().includes(q)));
  const by = { date: (a, z) => String(z.date || '').localeCompare(String(a.date || '')), size: (a, z) => (z.deal_value ?? z.ev ?? -1) - (a.deal_value ?? a.ev ?? -1),
    evr: (a, z) => (z.ev_revenue ?? -1) - (a.ev_revenue ?? -1), eve: (a, z) => (z.ev_ebitda ?? -1) - (a.ev_ebitda ?? -1) };
  return list.sort(by[cf.sort] || by.date);
}

function groupStats(list, keyFn) {
  const g = new Map();
  for (const t of list) for (const k of [].concat(keyFn(t))) { if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
  return [...g].map(([k, ts]) => ({ k, n: ts.length, evr: stat(ts.map(t => t.ev_revenue).filter(x => x != null)), eve: stat(ts.map(t => t.ev_ebitda).filter(x => x != null)), size: med(ts.map(t => t.deal_value).filter(x => x > 0)) }));
}

function yearChart(list) {
  const ys = groupStats(list, t => t.year).filter(y => y.k >= 2000).sort((a, b) => a.k - b.k);
  if (!ys.length) return '';
  const max = Math.max(...ys.map(y => y.n)), maxM = Math.max(...ys.map(y => y.evr.median || 0), 1);
  return `<div class="yr-chart">${ys.map(y => `<button class="yr ${String(cf.from) === String(y.k) && String(cf.to) === String(y.k) ? 'on' : ''}" data-cyear="${y.k}" title="${y.k}: ${y.n} deals · median EV/Revenue ${mult(y.evr.median)} (n=${y.evr.n}) · EV/EBITDA ${mult(y.eve.median)} (n=${y.eve.n})">
      <span class="yr-m">${y.evr.n >= 3 ? mult(y.evr.median) : ''}</span>
      <span class="yr-bars"><i class="yr-n" style="height:${Math.round((y.n / max) * 100)}%"></i><i class="yr-x" style="height:${y.evr.n >= 3 ? Math.round(((y.evr.median || 0) / maxM) * 100) : 0}%"></i></span>
      <span class="yr-l">${String(y.k).slice(2)}</span><span class="yr-c">${y.n}</span></button>`).join('')}</div>
    <div class="legend small muted"><i class="sw n"></i> deals <i class="sw x"></i> median EV/Revenue (shown when ≥3 deals have one) · click a year to filter</div>`;
}

function segTable(rows, attr, active, limit = 12) {
  const max = Math.max(...rows.map(r => r.n), 1);
  return `<table class="compact seg"><thead><tr><th></th><th class="num">Deals</th><th class="num">EV/Rev</th><th class="num">EV/EBITDA</th><th class="num">Median size</th></tr></thead><tbody>
    ${rows.slice(0, limit).map(r => `<tr class="${r.k === active ? 'on' : ''}" ${attr}="${esc(r.k)}"><td><div class="seg-l">${esc(r.k)}</div><div class="seg-bar"><i style="width:${Math.round((r.n / max) * 100)}%"></i></div></td>
      <td class="num">${r.n.toLocaleString()}</td><td class="num" title="n=${r.evr.n}">${r.evr.n >= 3 ? mult(r.evr.median) : '–'}</td><td class="num" title="n=${r.eve.n}">${r.eve.n >= 3 ? mult(r.eve.median) : '–'}</td><td class="num">${usdm(r.size)}</td></tr>`).join('')}
  </tbody></table>`;
}

function crmIndex() {
  const m = new Map();
  for (const c of state.companies || []) { const k = Engine.normName(c.name); if (k && !m.has(k)) m.set(k, c); }
  return m;
}

function txDetail(t) {
  return `<tr class="tx-detail"><td colspan="9"><div class="tx-d">
    <div>${t.summary ? `<p>${esc(t.summary)}</p>` : ''}${t.description ? `<p class="muted"><b>Target:</b> ${esc(t.description)}</p>` : ''}
      ${t.tags ? `<div>${t.tags.split(', ').slice(0, 12).map(x => `<button class="chip" data-ctag="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}</div>
    <dl class="tx-facts"><dt>Status</dt><dd>${esc(t.status || '–')}</dd><dt>Seller</dt><dd>${esc(t.seller || '–')}</dd><dt>Buyer</dt><dd>${esc([t.buyer, t.buyer_country].filter(Boolean).join(' · ') || '–')}</dd>
      ${t.buyer_industry ? `<dt>Buyer industry</dt><dd>${esc(t.buyer_industry)}</dd>` : ''}<dt>Deal value</dt><dd>${usdm(t.deal_value)} ${esc(t.currency || '')}</dd>
      ${t.ev != null ? `<dt>EV</dt><dd>${usdm(t.ev)}</dd>` : ''}${t.revenue != null ? `<dt>Revenue</dt><dd>${usdm(t.revenue)}</dd>` : ''}${t.ebitda != null ? `<dt>EBITDA</dt><dd>${usdm(t.ebitda)}</dd>` : ''}
      ${t.mult_src ? `<dt>Multiple</dt><dd>${esc(t.mult_src)} (approximate)</dd>` : ''}${t.id ? `<dt>ID</dt><dd>${esc(t.id)}</dd>` : ''}</dl></div></td></tr>`;
}

function renderComps() {
  if (!$('#compsView')) return;
  const all = state.transactions;
  if (!all.length) {
    $('#compsView').innerHTML = `<div class="page-head"><div><h1>Comps & valuation</h1><div class="muted">No transactions yet</div></div>
      <div class="actions"><label class="btn primary">Import Capital IQ transactions<input type="file" id="txUpload" accept=".xlsx,.xls,.csv" multiple hidden></label></div></div>
      <div class="card narrow"><h2>Import your Capital IQ transactions</h2>
        <ol class="small"><li>In Capital IQ (classic or Pro): <b>Screening → Transactions</b>. Criteria: M&A, target industry Software, announced 2015–today, acquisition of whole company / majority.</li>
        <li>Columns: Target, Transaction ID, Announced date, Status, Buyers, Sellers, Total Transaction Value, Implied EV, Implied EV/Revenue, Implied EV/EBITDA, Target LTM revenue and EBITDA, Target country, Primary industry, Business description, Topic tags, Deal summary.</li>
        <li>Export to Excel and import here (several files at once is fine). Columns are recognised automatically, S&P Capital IQ Pro field codes too; where the financials are missing, multiples are read from the deal summary. Re-importing updates instead of duplicating.</li></ol></div>`;
    return;
  }
  const list = filteredTx();
  const s1 = stat(list.map(t => t.ev_revenue).filter(x => x != null)), s2 = stat(list.map(t => t.ev_ebitda).filter(x => x != null));
  const sizes = list.map(t => t.deal_value).filter(x => x > 0);
  const buyers = list.flatMap(t => splitBuyers(t.buyer));
  const fin = list.filter(t => splitBuyers(t.buyer).some(b => FIN_BUYER.test(b))).length;
  const industries = groupStats(list, t => t.industry).sort((a, b) => b.n - a.n);
  const regions = groupStats(list, bigRegion).sort((a, b) => b.n - a.n);
  const crm = crmIndex();
  const topBuyers = [...buyers.reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const allInd = [...new Set(all.map(t => t.industry).filter(Boolean))].sort();
  const allReg = [...new Set(all.map(bigRegion))].sort();
  const active = [cf.q && `“${cf.q}”`, cf.industry, cf.region, cf.buyer && `buyer: ${cf.buyer}`, (cf.from || cf.to) && `${cf.from || '…'}–${cf.to || '…'}`, (cf.minSize || cf.maxSize) && `size ${cf.minSize || 0}–${cf.maxSize || '∞'}m`].filter(Boolean);
  const th = (k, label) => `<th class="num sortable ${cf.sort === k ? 'on' : ''}" data-csort="${k}">${label}${cf.sort === k ? ' ↓' : ''}</th>`;

  $('#compsView').innerHTML = `<div class="page-head"><div><h1>Comps & valuation</h1><div class="muted">${all.length.toLocaleString()} transactions · ${all.filter(t => t.ev_revenue).length.toLocaleString()} with EV/Revenue · ${all.filter(t => t.ev_ebitda).length.toLocaleString()} with EV/EBITDA · amounts in USD m</div></div>
      <div class="actions"><button class="btn" data-vx="buyers" title="Create a company for every acquirer, with its deal history">Add buyers to Companies</button><button class="btn" data-vx="exporttx">Export filtered (${list.length.toLocaleString()})</button><button class="btn danger" data-vx="cleartx">Delete all</button>
        <label class="btn primary">Import transactions<input type="file" id="txUpload" accept=".xlsx,.xls,.csv" multiple hidden></label></div></div>
    <div class="filters">
      <input type="search" id="cfQ" placeholder="Search target, buyer, tags, description… (e.g. document management, insurance, ERP)" value="${esc(cf.q)}">
      <select id="cfIndustry"><option value="">All industries</option>${allInd.map(c => `<option ${c === cf.industry ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="cfRegion"><option value="">All regions</option>${allReg.map(c => `<option ${c === cf.region ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="cfStatus"><option value="live" ${cf.status === 'live' ? 'selected' : ''}>Completed + pending</option><option value="done" ${cf.status === 'done' ? 'selected' : ''}>Completed only</option><option value="all" ${cf.status === 'all' ? 'selected' : ''}>Incl. terminated</option></select>
      <label class="row-label">Years <input id="cfFrom" value="${esc(cf.from)}" placeholder="2015" style="width:58px">–<input id="cfTo" value="${esc(cf.to)}" placeholder="2026" style="width:58px"></label>
      <label class="row-label">Deal size <input id="cfMin" value="${esc(cf.minSize)}" placeholder="min" style="width:54px">–<input id="cfMax" value="${esc(cf.maxSize)}" placeholder="max" style="width:54px"> m</label>
      <label class="check"><input type="checkbox" id="cfMult" ${cf.withMult ? 'checked' : ''}> Only with multiples</label>
      ${active.length ? `<button class="link small" data-vx="resetcf">Clear filters (${active.join(' · ')})</button>` : ''}
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k">Deals</div><div class="v">${list.length.toLocaleString()}</div><div class="muted small">${fin ? `${Math.round((fin / Math.max(1, list.length)) * 100)}% financial buyers (by name)` : ''}</div></div>
      <div class="kpi"><div class="k">Median deal size</div><div class="v">${usdm(med(sizes))}</div><div class="muted small">P25–P75 ${usdm(percentile(sizes, 0.25))}–${usdm(percentile(sizes, 0.75))}</div></div>
      <div class="kpi"><div class="k">Median EV/Revenue</div><div class="v">${mult(s1.median)}</div><div class="muted small">P25–P75 ${mult(s1.p25)}–${mult(s1.p75)} · n=${s1.n}</div></div>
      <div class="kpi"><div class="k">Median EV/EBITDA</div><div class="v">${mult(s2.median)}</div><div class="muted small">P25–P75 ${mult(s2.p25)}–${mult(s2.p75)} · n=${s2.n}</div></div>
    </div>
    <div class="comps-grid">
      <div class="card span2"><h2>Deal activity and multiples by year</h2>${yearChart(list)}</div>
      <div class="card"><h2>By industry</h2>${segTable(industries, 'data-cind', cf.industry)}</div>
      <div class="card"><h2>By region</h2>${segTable(regions, 'data-creg', cf.region)}
        <h2 style="margin-top:14px">Most active buyers</h2><div class="buyers">${topBuyers.map(([b, n]) => { const c = crm.get(Engine.normName(b)); return `<div class="buyer-row"><button class="link" data-cbuyer="${esc(b)}">${esc(b)}</button>${c ? ` <button class="chip blue" data-open="${c.id}" title="Open in CRM">in CRM</button>` : ''}<span class="muted small">${n}</span></div>`; }).join('')}</div></div>
      <div class="card span2"><div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">Sources</h2><span class="spacer"></span><button class="btn sm" data-vx="mastertx" title="All deals from all sources in one Excel file; it can be imported again later">Download master file</button></div>
        <div class="buyers">${sourceCounts().map(([s, n]) => `<div class="buyer-row"><span>${esc(s)}</span><span class="muted small">${n.toLocaleString()} deals</span><button class="link small" data-csrc-del="${esc(s)}">remove</button></div>`).join('')}</div>
        <p class="muted small">Import as many files as you like (S&P Capital IQ, classic Capital IQ, PitchBook, Mergermarket, your own Excel). Deals are matched on transaction ID, or on target + year, and merged; reported financials replace figures read from deal text.</p></div>
    </div>
    <div class="table-wrap"><table class="data tx-table"><thead><tr><th class="sortable ${cf.sort === 'date' ? 'on' : ''}" data-csort="date">Date${cf.sort === 'date' ? ' ↓' : ''}</th><th>Target</th><th>Buyer</th><th>Country</th>${th('size', 'Deal value')}<th class="num">Revenue</th><th class="num">EBITDA</th>${th('evr', 'EV/Rev')}${th('eve', 'EV/EBITDA')}</tr></thead><tbody>
      ${list.slice(0, cf.limit).map(t => { const b = splitBuyers(t.buyer), c = b.map(x => crm.get(Engine.normName(x))).find(Boolean);
        return `<tr class="tx-row ${cf.open === t.key ? 'open' : ''}" data-ctx="${esc(t.key)}"><td class="small">${esc(t.date || t.year || '')}${isDead(t) ? '<div class="chip red">terminated</div>' : /announced/i.test(t.status || '') ? '<div class="chip amber">pending</div>' : ''}</td>
        <td><b>${esc(t.target)}</b><div class="co-sub">${esc([t.industry, t.tags].filter(Boolean).join(' · ').slice(0, 90))}</div></td>
        <td class="small"><div class="tx-buyer">${esc(b.slice(0, 2).join('; '))}${b.length > 2 ? ` +${b.length - 2}` : ''}${c ? ` <button class="chip blue" data-open="${c.id}">in CRM</button>` : ''}</div></td><td class="small">${esc(t.country || '')}</td>
        <td class="num">${t.deal_value != null ? usdm(t.deal_value) : ''}</td><td class="num">${t.revenue != null ? usdm(t.revenue) : ''}</td><td class="num">${t.ebitda != null ? usdm(t.ebitda) : ''}</td>
        <td class="num">${mult(t.ev_revenue)}</td><td class="num">${mult(t.ev_ebitda)}${t.mult_src ? '<sup title="Read from the deal summary">*</sup>' : ''}</td></tr>${cf.open === t.key ? txDetail(t) : ''}`; }).join('')}
    </tbody></table>${list.length > cf.limit ? `<div style="padding:10px;text-align:center"><button class="btn" data-vx="moretx">Show more (${(list.length - cf.limit).toLocaleString()} left)</button></div>` : ''}</div>
    <p class="muted small">Click a row for the deal summary. * = multiple read from the deal summary text (approximate; currencies converted at average rates). Deal value is the total transaction value reported by S&P/Capital IQ.</p>`;
}

// Master file layout: one row per deal with every field, using our own labels so it imports back losslessly.
const MASTER_COLS = ['id', 'date', 'closed', 'target', 'buyer', 'seller', 'status', 'type', 'stake', 'country', 'region', 'industry', 'tags', 'currency', 'deal_value', 'ev', 'tev', 'revenue', 'ebitda', 'employees', 'ev_revenue', 'ev_ebitda', 'ev_ebit', 'mined', 'description', 'summary', 'buyer_country', 'buyer_industry', 'buyer_description', 'website', 'consideration', 'sources'];
function exportTx(list, name) {
  const rows = list.map(t => Object.fromEntries(MASTER_COLS.map(k => [TX_LABELS[k], Array.isArray(t[k]) ? t[k].join(', ') : t[k] ?? ''])));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: MASTER_COLS.map(k => TX_LABELS[k]) }), 'Transactions');
  XLSX.writeFile(wb, `${name}-${today()}.xlsx`, { compression: true });
}
const exportFilteredTx = () => exportTx(filteredTx(), 'comps');
const exportMasterTx = () => exportTx([...state.transactions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'transactions-master');
const sourceCounts = () => [...state.transactions.flatMap(t => t.sources || [t.source]).filter(Boolean).reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map())];
async function removeSource(src) {
  const n = state.transactions.filter(t => (t.sources || [t.source]).length === 1 && (t.sources || [t.source])[0] === src).length;
  if (!confirm(`Remove source "${src}"?\n\n${n.toLocaleString()} deals that only came from this file are deleted; deals also found in other files are kept.`)) return;
  state.transactions = state.transactions.filter(t => { const s = (t.sources || [t.source]).filter(x => x !== src); if (!s.length) return false; t.sources = s; t.source = s[0]; return true; });
  await saveTransactions();
  renderComps();
}

// ---------- Buyers → Companies: every acquirer becomes a company with its deal history ----------
const TX_SOURCE = 'S&P Capital IQ transactions';
// Abbreviations like "L.P." or "Inc." split sentences too early, so take sentences until there's a real one.
const firstSentences = s => { let out = ''; for (const x of sentencesOf(s)) { out += (out ? ' ' : '') + x; if (out.length >= 60) break; } return out; };
function buyerGroups() {
  const g = new Map();
  for (const t of state.transactions) {
    if (isDead(t)) continue;
    const parts = String(t.buyer || '').split(/;\s*/).filter(Boolean);
    for (const p of parts) {
      const ticker = p.match(/\(([^()]*\w:[^()]*)\)\s*$/)?.[1] || '';
      const name = p.replace(/\s*\([^()]*:[^()]*\)\s*$/, '').trim(), k = Engine.normName(name);
      if (!k) continue;
      if (!g.has(k)) g.set(k, { name, ticker, deals: [] });
      const b = g.get(k);
      b.deals.push(t);
      b.ticker ||= ticker;
      if (parts.length === 1) { b.country ||= t.buyer_country; b.industry ||= t.buyer_industry; b.description ||= t.buyer_description; }
    }
  }
  for (const b of g.values()) b.role = Engine.guessRole({ name: b.name, sector: b.industry, description: b.description });
  return [...g.values()].sort((a, b) => b.deals.length - a.deals.length);
}
const acqFromTx = t => ({
  target: t.target, date: t.date || '', year: t.year || '', industry: t.industry || '', country: t.country || '', seller: t.seller || '', status: t.status || '',
  deal_value: t.deal_value != null ? `$${Engine.fmt(t.deal_value)}m` : '', target_revenue: t.revenue != null ? `$${Engine.fmt(t.revenue)}m` : '',
  ev_revenue: t.ev_revenue ?? '', ev_ebitda: t.ev_ebitda ?? '', tags: t.tags || '', description: t.description || '', why: t.summary || '',
  type: 'Acquisition', source: 'S&P Capital IQ', tx_id: t.id || '',
});

async function addBuyersToCompanies() {
  const groups = buyerGroups();
  const counts = [1, 2, 3, 5, 10].map(n => `   ${n}+ deals: ${groups.filter(g => g.deals.length >= n).length.toLocaleString()} buyers`).join('\n');
  const ans = prompt(`Add the acquirers from your transactions to Companies, each with its full deal history (target, date, industry, size, multiples, topic tags and the deal summary). Existing companies with the same name get the deals added; nothing is overwritten. Each one is typed Strategic or Financial automatically.\n\n${counts}\n\nMinimum number of deals per buyer (Cancel = skip):`, '1');
  if (ans == null) return;
  const min = Math.max(1, parseInt(ans, 10) || 1), pick = groups.filter(g => g.deals.length >= min);
  toast(`Adding ${pick.length.toLocaleString()} buyers…`);
  const idx = Engine.buildIndex(state.companies);
  let created = 0, updated = 0, deals = 0;
  for (const g of pick) {
    let targets = Engine.findDuplicates({ name: g.name }, idx).exact;
    if (targets.length) updated++;
    else { const c = newCompany(g.name); state.companies.push(c); targets = [c]; created++; }
    for (const c of targets) {
      const fill = (k, v) => { if (v && !c[k]) c[k] = v; };
      fill('ticker', g.ticker); fill('country', g.country); fill('sector', g.industry); // the type (strategic / financial) is guessed by touch() once these fields are in
      fill('description', g.description); fill('short_description', g.description && clip(firstSentences(g.description), 240));
      if (g.ticker) fill('ownership', `Listed (${g.ticker})`);
      deals += mergeAcquisitions(c, g.deals.map(acqFromTx));
      if (c.acquisitions.length >= 3) c.acquisitive = 'yes'; else if (!c.acquisitive || c.acquisitive === 'unknown') c.acquisitive = 'some';
      if (!c.sources.includes(TX_SOURCE)) c.sources.push(TX_SOURCE);
      touch(c);
    }
  }
  await flush();
  renderCompanies();
  toast(`Buyers: ${created.toLocaleString()} new companies, ${updated.toLocaleString()} existing ones updated, ${deals.toLocaleString()} deals added.`, 8000);
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
  if (x === 'exporttx') return exportFilteredTx();
  if (x === 'mastertx') return exportMasterTx();
  const src = e.target.closest('[data-csrc-del]')?.dataset.csrcDel;
  if (src) return removeSource(src);
  if (x === 'buyers') return addBuyersToCompanies();
  if (x === 'resetcf') { Object.assign(cf, { q: '', industry: '', region: '', buyer: '', from: '', to: '', minSize: '', maxSize: '', limit: 200, open: null }); return renderComps(); }
  if (e.target.closest('#compsView')) {
    if (e.target.closest('[data-open]')) return;
    const el = s => e.target.closest(`[${s}]`)?.getAttribute(s);
    const toggle = (k, v) => { cf[k] = cf[k] === v ? '' : v; cf.limit = 200; renderComps(); };
    if (el('data-cyear')) { const y = el('data-cyear'); const on = cf.from === y && cf.to === y; cf.from = cf.to = on ? '' : y; return renderComps(); }
    if (el('data-cind') != null) return toggle('industry', el('data-cind'));
    if (el('data-creg') != null) return toggle('region', el('data-creg'));
    if (el('data-cbuyer')) return toggle('buyer', el('data-cbuyer'));
    if (el('data-ctag')) { cf.q = el('data-ctag'); return renderComps(); }
    if (el('data-csort')) { cf.sort = el('data-csort'); return renderComps(); }
    if (el('data-ctx') && !e.target.closest('.tx-detail')) { const k = el('data-ctx'); cf.open = cf.open === k ? null : k; return renderComps(); }
  }
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
  const cfInputs = { cfIndustry: 'industry', cfRegion: 'region', cfStatus: 'status', cfFrom: 'from', cfTo: 'to', cfMin: 'minSize', cfMax: 'maxSize' };
  if (cfInputs[t.id]) { cf[cfInputs[t.id]] = t.value.trim(); cf.limit = 200; renderComps(); }
  if (t.id === 'cfMult') { cf.withMult = t.checked; renderComps(); }
});
let cfTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'cfQ') return;
  cf.q = e.target.value;
  clearTimeout(cfTimer);
  cfTimer = setTimeout(() => { renderComps(); const s = $('#cfQ'); s.focus(); s.setSelectionRange(cf.q.length, cf.q.length); }, 250);
});
