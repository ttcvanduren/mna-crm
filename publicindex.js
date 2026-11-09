/* global state, Engine, Taxonomy, toast, $ */
// Public website: builds the slim, anonymous "market index" that the public site's server uses to answer visitors.
// It contains NO company names, people, emails or deal rows: only per-niche statistics (counts, multiple percentiles,
// buyer mix) and anonymous buyer profiles (kind, region, niches and years of past deals). Statistics based on fewer than
// PI_MIN deals are left out, so no single deal can be worked out. The file must stay private (server-side storage only).

const PI_MIN = 8; // minimum number of deals behind any published multiple
const PI_CONS = /constellation software|volaris|harris (computer|operating)|jonas (software|computer)|vela software|perseus (group|operating)|total specific|topicus|lumine group|modaxo|valsoft|aspire software|banyan software|hawk infinity|snowball software|software circle|vitec software|addnode|enghouse|bending spoons|chapters group|everfield|asseco/i;
const PI_FIN = /capital|partners|equity|private|fund|ventures|investment|investors|beteiligung|\bllp\b|holdings? (llc|lp)/i;
const PI_REGIONS = [
  ['DACH', ['Germany', 'Austria', 'Switzerland', 'Liechtenstein']],
  ['Benelux', ['Netherlands', 'Belgium', 'Luxembourg']],
  ['Nordics', ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland']],
  ['UK & Ireland', ['United Kingdom', 'UK', 'Ireland']],
  ['France', ['France', 'Monaco']],
  ['Southern Europe', ['Spain', 'Italy', 'Portugal', 'Greece', 'Malta', 'Cyprus']],
  ['CEE', ['Poland', 'Czechia', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Slovenia', 'Serbia', 'Estonia', 'Latvia', 'Lithuania', 'Ukraine']],
  ['North America', ['United States', 'USA', 'United States of America', 'Canada']],
];
const piRegion = country => (PI_REGIONS.find(([, cs]) => cs.includes(String(country || '').trim())) || ['Other'])[0];
const piYear = x => +String(x || '').slice(0, 4) || 0;
const piPct = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * q, lo = Math.floor(i); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo); };
const piR1 = x => (x == null ? null : Math.round(x * 10) / 10);

function buildPublicIndex({ includeTransactions = true } = {}) {
  const names = Taxonomy.NICHES.map(n => n.niche), id = new Map(names.map((n, i) => [n, i]));
  const now = new Date().getFullYear();
  const blank = () => ({ years: {}, rev: [], ebitda: [], mix: { S: 0, P: 0, C: 0 } });
  const byNiche = new Map(), byInd = new Map(), all = blank();
  const add = (niche, fn) => { if (!niche) return; const ind = Taxonomy.industryOf(niche); for (const [m, k] of [[byNiche, niche], [byInd, ind]]) { if (!k) continue; if (!m.has(k)) m.set(k, blank()); fn(m.get(k)); } fn(all); };

  // Market statistics from the transaction database (check your S&P / Mergermarket licence before publishing these).
  if (includeTransactions) {
    for (const t of state.transactions || []) {
      if (/minority|funding/i.test(t.type || '')) continue;
      const tags = Array.isArray(t.tags) ? t.tags.join(' ; ') : t.tags || '';
      const v = Taxonomy.score([[[t.industry, tags].join(' ; '), 2], [[String(t.description || '').slice(0, 400), String(t.summary || '').slice(0, 300)].join(' '), 1]]).find(x => x.score >= 2);
      if (!v) continue;
      const y = t.year || piYear(t.date);
      const kind = PI_CONS.test(t.buyer || '') ? 'C' : PI_FIN.test(t.buyer || '') ? 'P' : 'S';
      add(v.niche, s => {
        if (y) s.years[y] = (s.years[y] || 0) + 1;
        if (y >= now - 2) s.mix[kind]++;
        if (y >= now - 6 && t.ev_revenue > 0.1 && t.ev_revenue < 40) s.rev.push(t.ev_revenue);
        if (y >= now - 6 && t.ev_ebitda > 1 && t.ev_ebitda < 80) s.ebitda.push(t.ev_ebitda);
      });
    }
  }
  const stat = s => {
    const yr = k => s.years[now - k] || 0;
    const q = a => (a.length >= PI_MIN ? [piR1(piPct(a, 0.25)), piR1(piPct(a, 0.5)), piR1(piPct(a, 0.75)), a.length] : null);
    return { y: Object.fromEntries(Object.entries(s.years).filter(([y]) => +y >= now - 5)), n3: yr(0) + yr(1) + yr(2), rev: q(s.rev), ebitda: q(s.ebitda), mix: s.mix };
  };

  // Anonymous buyer profiles: kind, region and the niches/years of their deals. Never names.
  const buyers = [];
  for (const c of state.companies) {
    if (c.role === 'Target') continue;
    const deals = (c.acquisitions || []).map(a => [Taxonomy.ofDeal(a)?.niche, piYear(a.date || a.year)]).filter(([n]) => n && id.has(n));
    const own = Engine.nichesOf(c).map(n => id.get(n.niche)).filter(x => x != null).slice(0, 3);
    if (!deals.length && !own.length) continue;
    if (!deals.length && !(c.role === 'Buyer' || c.role === 'Investor')) continue;
    const kind = PI_CONS.test([c.name, ...(c.aliases || [])].join(' ')) ? 'C' : c.role === 'Investor' ? 'P' : Engine.ownershipType(c.ownership) === 'PE-backed' ? 'B' : 'S';
    const emp = c.linkedin_employees ?? c.employees;
    buyers.push({
      k: kind, r: piRegion(c.country), n: own,
      d: deals.slice(0, 40).map(([n, y]) => [id.get(n), y]),
      a: (c.acquisitions || []).length, a3: (c.acquisitions || []).filter(a => piYear(a.date || a.year) >= now - 3).length,
      e: emp == null ? null : emp < 50 ? 0 : emp < 250 ? 1 : emp < 1000 ? 2 : emp < 5000 ? 3 : 4,
    });
  }
  const index = {
    type: 'mna-crm-public-index', version: 1, built: new Date().toISOString(), year: now, minDeals: PI_MIN,
    sources: includeTransactions ? 'CRM research + transaction database' : 'CRM research only',
    niches: names, industries: Object.fromEntries(names.map(n => [n, Taxonomy.industryOf(n)])),
    adjacent: names.map(a => names.map((b, j) => (Taxonomy.adjacent(a, b) ? j : -1)).filter(j => j >= 0)),
    market: { niche: Object.fromEntries([...byNiche].map(([k, s]) => [k, stat(s)])), industry: Object.fromEntries([...byInd].map(([k, s]) => [k, stat(s)])), all: stat(all) },
    buyers,
  };
  return index;
}

$('#publishIndex')?.addEventListener('click', () => {
  const inc = $('#piIncludeTx').checked;
  const t0 = performance.now();
  const idx = buildPublicIndex({ includeTransactions: inc });
  const json = JSON.stringify(idx);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'public-index.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const withMult = Object.values(idx.market.niche).filter(s => s.rev || s.ebitda).length;
  $('#piInfo').textContent = `${idx.buyers.length.toLocaleString()} anonymous buyer profiles · ${Object.keys(idx.market.niche).length} niches with market data (${withMult} with multiples) · ${(json.length / 1048576).toFixed(1)} MB · ${Math.round(performance.now() - t0)} ms`;
  toast('Market index downloaded. Upload it to the private storage of the website server (never to GitHub).', 7000);
});
