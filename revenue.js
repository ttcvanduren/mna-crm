/* global Engine, Taxonomy, state */
// Revenue estimation: several independent methods, shown side by side, combined into one estimate with a range.
//
//   1. Stated / filed revenue       what the company (or a register, a press release) says: beats every estimate
//   2. Inside: deals per niche      headcount × revenue per employee from our transactions, niche › sub-sector › sector › industry
//   3. Inside: deals per size band  the same, but across the industry for companies of this size (size effect)
//   4. Inside: CRM companies        revenue per employee of companies in the database with both figures
//   5. External benchmark           public revenue-per-employee benchmarks per industry and size (Eurostat SBS, SaaS surveys)
//   6. Signal-adjusted              the benchmark corrected for what we can observe: business model, age, owner, country, growth
//   7. ARR / customers              researched ARR, customers × contract value
//   8. Web reach                    web traffic / followers × revenue per visit (only when researched)
//
// Every method returns { key, label, mid, low, high, n, weight, basis } in EUR m. The combination is a weighted
// geometric mean (revenue per employee is log-normal); the range is a P25–P75 and an 80 % interval from the pooled
// log-variance. Headcount is the anchor for everything, so companies without a headcount get no estimate.
// The valuation part turns the estimate into an EV range with three routes: EV/Revenue multiples of comparable
// deals, EV per employee of comparable deals, and an EBITDA route (estimated margin × EV/EBITDA).
const RevEst = (() => {
  const USD_EUR = 1 / 1.1; // the transaction database is in USD m; estimates are in EUR m
  const BANDS = [[1, 9, '1–9'], [10, 24, '10–24'], [25, 49, '25–49'], [50, 99, '50–99'], [100, 249, '100–249'], [250, 999, '250–999'], [1000, Infinity, '1,000+']];
  const bandOf = n => BANDS.find(([lo, hi]) => n >= lo && n <= hi) || BANDS[0];
  const ln = Math.log, exp = Math.exp;
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  // Log-space statistics of a list of ratios: median, quartiles and the spread (sd of ln x). Winsorised at the
  // 5th / 95th percentile so one odd deal (a 2-person holding with €40m revenue) doesn't move everything.
  function lstat(list) {
    const xs = list.filter(x => x > 0);
    if (!xs.length) return null;
    const lo = pct(xs, 0.05), hi = pct(xs, 0.95), w = xs.map(x => Math.min(hi, Math.max(lo, x))).map(ln);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = w.length > 1 ? Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1)) : 0.6;
    return { n: xs.length, median: exp(pct(w, 0.5)), p25: exp(pct(w, 0.25)), p75: exp(pct(w, 0.75)), mean, sd: Math.max(0.25, sd) };
  }

  // ---------- External benchmarks: revenue per employee in EUR k (median, P25, P75) for the 10–99 employee range ----------
  // Sources (approximate, 2023–2025): Eurostat SBS turnover per person employed (NACE J58–J63, M, N, C, F, G, H, I, K),
  // SaaS Capital / Benchmarkit / KeyBanc SaaS surveys (ARR per FTE by size), ChartMogul, Damodaran industry data.
  // They are priors, not facts: a company's own numbers and our own deal data always weigh more.
  const PRIOR = {
    // Technology › sub-sectors (software is listed per sub-sector; the default covers the rest)
    'Technology': [115, 80, 165],
    'Horizontal software': [120, 80, 175], 'Infrastructure & security software': [135, 90, 200], 'Vertical software': [110, 75, 160],
    'Software groups': [150, 110, 220], 'IT services': [120, 90, 155], 'Internet & digital platforms': [160, 90, 280], 'Hardware & semiconductors': [230, 160, 330],
    'IT consulting & integration': [120, 90, 155], 'BPO & outsourcing': [55, 40, 75], 'IT distribution & resale': [420, 260, 700],
    'Cloud & hosting': [150, 105, 230], 'Marketplaces & online platforms': [170, 90, 300], 'Semiconductors': [260, 170, 380], 'Devices, electronics & IoT': [220, 150, 320], 'Communications equipment': [230, 160, 340],
    'Serial acquirers & software holdings': [150, 110, 220], 'Large platforms & hyperscalers': [350, 220, 600],
    // Other industries › sectors
    'Financial Services': [380, 220, 650], 'Banks & specialty finance': [420, 250, 700], 'Insurance & brokers': [450, 250, 800], 'Asset & wealth management': [550, 300, 1000], 'Private equity & venture capital': [700, 350, 1400], 'Exchanges & financial data': [450, 280, 750], 'Diversified holdings': [400, 200, 800],
    'Business Services': [110, 75, 160], 'Professional services': [120, 85, 170], 'Marketing & communications': [115, 80, 165], 'Staffing & HR services': [90, 60, 130], 'Information & records management': [130, 90, 190], 'Support & facility services': [55, 40, 80],
    'Healthcare & Life Sciences': [120, 70, 250], 'Care providers': [70, 50, 100], 'Pharma & biotech': [320, 180, 600], 'Medtech & life science tools': [240, 150, 380],
    'Industrials & Manufacturing': [230, 150, 350], 'Machinery & automation': [220, 150, 320], 'Electrical & electronic equipment': [230, 150, 340], 'Aerospace & defence': [250, 170, 380], 'Automotive': [300, 190, 450], 'Chemicals & materials': [380, 230, 600], 'Distribution & trading': [600, 350, 1100], 'Industrial conglomerates': [300, 190, 480],
    'Construction & Real Estate': [230, 150, 360], 'Construction & engineering': [220, 150, 330], 'Building products': [290, 190, 430], 'Real estate': [350, 170, 700],
    'Energy & Utilities': [650, 350, 1200], 'Utilities': [650, 380, 1100], 'Oil, gas & renewables': [900, 450, 1800],
    'Transport & Logistics': [180, 110, 300], 'Logistics & freight': [190, 120, 320], 'Passenger transport': [100, 70, 150],
    'Consumer & Retail': [220, 120, 400], 'Retail': [240, 140, 420], 'Hospitality & leisure': [70, 50, 100], 'Consumer goods & food': [330, 200, 550],
    'Media & Telecom': [200, 120, 330], 'Telecom operators': [300, 190, 480], 'Media & entertainment': [170, 110, 270], 'Gaming': [200, 110, 360],
    'Public Sector & Education': [80, 55, 110], 'Government': [85, 60, 120], 'Education': [70, 50, 100],
  };
  // Revenue per employee changes with size: small software companies run below the benchmark (founders, pre-scale),
  // large ones above; services are flat; capital-heavy industries scale with size too.
  const SIZE_FACTOR = {
    software: { '1–9': 0.8, '10–24': 0.9, '25–49': 1, '50–99': 1.08, '100–249': 1.18, '250–999': 1.3, '1,000+': 1.45 },
    services: { '1–9': 0.9, '10–24': 0.97, '25–49': 1, '50–99': 1.02, '100–249': 1.05, '250–999': 1.08, '1,000+': 1.12 },
    other: { '1–9': 0.85, '10–24': 0.93, '25–49': 1, '50–99': 1.05, '100–249': 1.12, '250–999': 1.2, '1,000+': 1.3 },
  };
  const familyOf = p => !p ? 'other' : /IT services|BPO|Business Services|Professional|Marketing|Staffing|Care providers|Hospitality|Public Sector/.test([p.industry, p.sector, p.subsector].join(' ')) ? 'services' : p.industry === 'Technology' ? 'software' : 'other';
  // Country labour-cost / price level relative to the Netherlands (Eurostat labour cost index, rounded).
  const COUNTRY = { Switzerland: 1.2, Norway: 1.15, Denmark: 1.1, Luxembourg: 1.1, 'United States': 1.15, Ireland: 1.05, Sweden: 1.02, Germany: 1.02, Austria: 1, Belgium: 1, Netherlands: 1, Finland: 0.98, France: 0.97, 'United Kingdom': 0.95, Canada: 0.95, Australia: 0.95, Italy: 0.8, Spain: 0.72, Portugal: 0.6, Poland: 0.55, 'Czech Republic': 0.6, Czechia: 0.6, Hungary: 0.5, Romania: 0.45, Bulgaria: 0.4, Lithuania: 0.55, Latvia: 0.5, Estonia: 0.6, Slovakia: 0.55, Slovenia: 0.65, Croatia: 0.5, Greece: 0.55, Turkey: 0.35, India: 0.15, Ukraine: 0.25, Serbia: 0.35 };
  const countryFactor = c => COUNTRY[c] || (Engine.regionOf({ country: c }) === 'CEE' ? 0.55 : Engine.regionOf({ country: c }) === 'Southern Europe' ? 0.75 : 1);

  // ---------- Inside benchmarks from the transaction database (built once per transaction set) ----------
  // Most exports carry no headcount column, but the deal summaries say "… has 120 employees": read it from there.
  const EMP_RE = /(\d{1,3}(?:[,.]\d{3})*|\d+)\s*(?:\+|plus)?\s*(?:full[- ]time\s+)?(employees|staff|ftes?|people|headcount|personnel|workforce|team members)\b/i;
  function dealEmployees(t) {
    if (t.employees > 0) return +t.employees;
    if (t._emp !== undefined) return t._emp;
    const m = String(t.summary || '').match(EMP_RE);
    const n = m ? +m[1].replace(/[,.]/g, '') : 0;
    t._emp = n >= 2 && n <= 500000 && !/customers?|clients?|users?/.test(String(t.summary || '').slice(Math.max(0, (m?.index || 0) - 40), m?.index || 0)) ? n : null;
    return t._emp;
  }
  let cache = null;
  function benchmarks() {
    const tx = state.transactions || [], companies = state.companies || [];
    const sig = tx.length + ':' + companies.length + ':' + (state.txVersion || 0);
    if (cache && cache.sig === sig) return cache;
    const groups = new Map(), add = (k, v) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); };
    let pairs = 0;
    for (const t of tx) {
      if (!(t.revenue > 0) || /terminat|withdrawn|cancel|lapsed/i.test(t.status || '')) continue;
      const emp = dealEmployees(t);
      if (!emp) continue;
      const rpe = (t.revenue * 1000 * USD_EUR) / emp; // EUR k per employee
      if (rpe < 5 || rpe > 5000) continue;
      pairs++;
      const p = Taxonomy.pathOfDeal(t) || {}, band = bandOf(emp)[2], eu = /^(Benelux|DACH|UK & Ireland|Nordics|France|Southern Europe|CEE|Europe)$/.test(txRegion(t));
      const keys = ['all', 'band:' + band];
      if (p.industry) { keys.push('I:' + p.industry, `I:${p.industry}|${band}`); if (eu) keys.push('I:' + p.industry + '|eu'); }
      if (p.sector) keys.push('S:' + p.sector, `S:${p.sector}|${band}`);
      if (p.subsector) keys.push('U:' + p.subsector, `U:${p.subsector}|${band}`);
      if (t.niche) keys.push('n:' + t.niche, `n:${t.niche}|${band}`);
      keys.forEach(k => add(k, rpe));
    }
    // EV per employee and EV/Revenue of the same deals (valuation routes).
    const ev = new Map(), addEv = (k, v) => { if (!ev.has(k)) ev.set(k, []); ev.get(k).push(v); };
    const mult = new Map(), addM = (k, v) => { if (!mult.has(k)) mult.set(k, []); mult.get(k).push(v); };
    for (const t of tx) {
      if (/terminat|withdrawn|cancel|lapsed/i.test(t.status || '') || /minority/i.test(t.type || '')) continue;
      const p = Taxonomy.pathOfDeal(t) || {}, keys = ['all'];
      if (p.industry) keys.push('I:' + p.industry); if (p.sector) keys.push('S:' + p.sector); if (p.subsector) keys.push('U:' + p.subsector); if (t.niche) keys.push('n:' + t.niche);
      const evv = t.ev > 0 ? t.ev : t.deal_value > 0 ? t.deal_value : null, emp = evv ? dealEmployees(t) : null;
      if (evv && emp) { const x = (evv * 1000 * USD_EUR) / emp; if (x > 10 && x < 20000) keys.forEach(k => addEv(k, x)); }
      if (t.ev_revenue > 0 && t.ev_revenue < 60 && (!t.year || t.year >= new Date().getFullYear() - 6)) keys.forEach(k => addM(k, t.ev_revenue));
    }
    // CRM companies with stated revenue and headcount, by sub-sector / sector / industry.
    const co = new Map(), addCo = (k, v) => { if (!co.has(k)) co.set(k, []); co.get(k).push(v); };
    for (const c of companies) {
      const emp = c.linkedin_employees ?? c.employees;
      if (!(c.revenue > 0 && emp > 0)) continue;
      const fx = c.currency === 'USD' ? USD_EUR : c.currency === 'GBP' ? 1.17 : c.currency === 'CHF' ? 1.05 : 1;
      const rpe = (c.revenue * fx * 1000) / emp;
      if (rpe < 5 || rpe > 5000) continue;
      const p = Taxonomy.pathOfCompany(c) || {};
      ['all', p.industry && 'I:' + p.industry, p.sector && 'S:' + p.sector, p.subsector && 'U:' + p.subsector, c.niche && 'n:' + c.niche].filter(Boolean).forEach(k => addCo(k, rpe));
    }
    const fin = m => { const out = new Map(); for (const [k, v] of m) out.set(k, lstat(v)); return out; };
    cache = { sig, pairs, rpe: fin(groups), ev: fin(ev), mult: fin(mult), co: fin(co) };
    return cache;
  }
  const txRegion = t => (typeof REGION_OF === 'function' ? REGION_OF(t.country) : Engine.regionOf({ country: t.country })) || t.region || '';

  // Picks the most specific level with enough deals, shrinking towards the broader ones: a niche with 4 deals is
  // blended with its sub-sector, which is blended with its sector, and so on (k = 6 deals is "half trust").
  function shrink(table, keys, k = 6) {
    let est = null, cred = 0, parts = [];
    for (const [key, label] of keys) {
      const s = table.get(key);
      if (!s) continue;
      parts.push({ label, n: s.n, median: s.median });
      if (est == null) { est = { ...s }; cred = s.n; }
      else {
        const a = cred / (cred + k);
        est = { median: exp(a * ln(est.median) + (1 - a) * ln(s.median)), p25: exp(a * ln(est.p25) + (1 - a) * ln(s.p25)), p75: exp(a * ln(est.p75) + (1 - a) * ln(s.p75)), sd: a * est.sd + (1 - a) * s.sd };
        cred += s.n;
      }
      if (cred >= 25) break; // specific enough
    }
    // The levels nest (a niche's deals are also in its sub-sector), so the deals behind the blend are the broadest level's.
    return est ? { ...est, n: Math.max(...parts.map(x => x.n)), parts } : null;
  }
  // "median of 19 deals: IT services & consulting, 10–24 staff, blended with 149 IT services & consulting" — or, when the
  // most specific level is too thin to name, the blend as a whole.
  function describe(est) {
    const [own, ...rest] = est.parts;
    if (own.n >= 5) return `median of ${own.n} deals: ${own.label}${rest.length ? `, blended with ${rest.slice(0, 2).map(x => `${x.n} ${x.label}`).join(', ')}` : ''}`;
    return `${est.n} deals, blended from ${est.parts.slice(0, 3).map(x => `${x.n} ${x.label}`).join(' › ')}`;
  }

  // ---------- Signals we can observe (from lists, research, the website) ----------
  const text = c => [c.short_description, c.summary, c.description, c.keywords, (c.tags || []).join(' '), c.business_model, c.rev_signals?.business_model].filter(Boolean).join(' ').toLowerCase();
  function signals(c) {
    const t = text(c), out = [], f = (label, factor, why) => out.push({ label, factor, why });
    const s = c.rev_signals || {};
    const model = String(s.business_model || '').toLowerCase();
    if (/\b(saas|subscription|recurring|arr\b|per month|per user)/.test(model) || (/\b(saas|subscription-based|subscription based|recurring revenue)\b/.test(t) && !/consult|agency|integrator/.test(t))) f('SaaS / subscription', 0.95, 'recurring software: revenue per head slightly below services at this size, higher quality');
    else if (/\b(reseller|resale|distributor|distribution|hardware|wholesale|hosting|data cent)/.test(model + ' ' + t)) f('Resale / hosting / hardware', 1.5, 'pass-through revenue: far more revenue per head');
    else if (/\b(marketplace|platform fee|transaction fee|payments?)\b/.test(model + ' ' + t)) f('Marketplace / payments', 1.2, 'gross-revenue model');
    else if (/\b(consult|agency|bureau|integrator|implementation|development services|web development|managed services|outsourc)/.test(model + ' ' + t)) f('Services / consulting', 1, 'billable-hours model: revenue follows headcount');
    const yr = +String(c.founded || '').slice(0, 4), age = yr > 1800 ? new Date().getFullYear() - yr : null;
    if (age != null && age < 4) f('Founded < 4 years ago', 0.7, 'young companies hire ahead of revenue');
    else if (age != null && age < 8) f('Founded 4–8 years ago', 0.88, 'still scaling');
    else if (age != null && age > 20) f('Founded 20+ years ago', 1.05, 'mature customer base');
    const own = Engine.ownershipType(c.ownership);
    if (own === 'VC-backed' || /venture|seed|series [a-c]|accelerator|rockstart|techstars/i.test([c.ownership, c.sponsor_name, c.investors].join(' ')) || c.investor_type === 'vc') f('VC-backed', 0.75, 'growth-stage: revenue lags headcount');
    else if (own === 'PE-backed' || c.sponsor_name) f('PE-backed', 1.1, 'buyouts are profitable, mature businesses');
    else if (own === 'Listed') f('Listed', 1.1, 'listed companies are larger and mature');
    else if (own === 'Subsidiary') f('Subsidiary', 1.05, 'part of a larger group');
    const cf = countryFactor(c.country);
    if (cf !== 1 && c.country) f(`Country: ${c.country}`, cf, 'labour-cost and price level vs the Netherlands');
    if (s.job_openings > 0 && c.employees > 0) { const r = s.job_openings / c.employees; if (r > 0.15) f('Hiring fast', 0.9, `${s.job_openings} open roles on ${c.employees} staff: headcount running ahead of revenue`); }
    if (s.linkedin_growth_pct != null) { const g = +s.linkedin_growth_pct; if (g > 30) f(`Headcount +${g}% / yr`, 0.88, 'fast hiring dilutes revenue per head'); else if (g < -10) f(`Headcount ${g}% / yr`, 1.1, 'shrinking team, revenue lags'); }
    if (s.offices > 2) f(`${s.offices} offices`, 1.05, 'multi-site, more mature');
    if (/\b(freelance|zzp|one-man|eenmanszaak)\b/.test(t)) f('Freelance / micro', 0.8, 'micro business');
    return out;
  }

  const headcountOf = c => { const n = c.linkedin_employees ?? c.employees; return n > 0 ? +n : null; };
  const mEur = (rpeK, emp) => (rpeK * emp) / 1000; // EUR k per head × heads → EUR m
  const label = p => p ? [p.subsector || p.sector || p.industry].filter(Boolean)[0] : '';

  // ---------- The methods ----------
  function methods(c, opts = {}) {
    const B = benchmarks(), emp = headcountOf(c), p = Taxonomy.pathOfCompany(c), s = c.rev_signals || {}, out = [];
    const niche = c.niche, year = new Date().getFullYear();
    const yr = (v, k) => (v ? ` (${v})` : k ? '' : '');
    // 1. Stated or filed revenue.
    if (c.revenue > 0) {
      const fx = c.currency === 'USD' ? USD_EUR : c.currency === 'GBP' ? 1.17 : c.currency === 'CHF' ? 1.05 : 1, v = c.revenue * fx;
      const age = c.financials_year ? year - +String(c.financials_year).slice(0, 4) : 2, spread = age <= 1 ? 0.08 : age <= 3 ? 0.18 : 0.3;
      out.push({ key: 'stated', label: 'Stated revenue', mid: v, low: v * (1 - spread), high: v * (1 + spread), n: 1, sd: spread, weight: age <= 3 ? 6 : 3, basis: `From your data / research${c.financials_year ? ` (FY ${c.financials_year})` : ''}${c.currency && c.currency !== 'EUR' ? `, converted from ${c.currency}` : ''}` });
    }
    if (s.revenue_stated > 0) {
      const v = +s.revenue_stated, age = s.revenue_year ? year - +String(s.revenue_year).slice(0, 4) : 2, spread = age <= 1 ? 0.08 : age <= 3 ? 0.18 : 0.3;
      out.push({ key: 'filed', label: 'Published / filed revenue', mid: v, low: v * (1 - spread), high: v * (1 + spread), n: 1, sd: spread, weight: age <= 3 ? 6 : 3, basis: `${s.revenue_source || 'researched'}${s.revenue_year ? `, FY ${s.revenue_year}` : ''}` });
    }
    if (!emp) return out;
    const band = bandOf(emp)[2], fam = familyOf(p), sizeF = (SIZE_FACTOR[fam] || SIZE_FACTOR.other)[band] || 1;
    // 2. Inside: deals in the same niche › sub-sector › sector › industry (size-band variant first when it exists).
    const keys = [];
    if (niche) keys.push([`n:${niche}|${band}`, `${niche}, ${band} staff`], [`n:${niche}`, niche]);
    if (p?.subsector) keys.push([`U:${p.subsector}|${band}`, `${p.subsector}, ${band} staff`], [`U:${p.subsector}`, p.subsector]);
    if (p?.sector) keys.push([`S:${p.sector}|${band}`, `${p.sector}, ${band} staff`], [`S:${p.sector}`, p.sector]);
    if (p?.industry) keys.push([`I:${p.industry}|${band}`, `${p.industry}, ${band} staff`], [`I:${p.industry}`, p.industry]);
    keys.push(['all', 'all deals']);
    const inside = shrink(B.rpe, keys);
    if (inside && inside.n >= 3) {
      out.push({ key: 'deals', label: 'Deals in the same market', rpe: inside.median, mid: mEur(inside.median, emp), low: mEur(inside.p25, emp), high: mEur(inside.p75, emp), n: inside.n, sd: inside.sd, weight: Math.min(4, 1 + inside.n / 10),
        basis: `${emp} staff × €${Math.round(inside.median)}k per head (${describe(inside)})`, parts: inside.parts });
    }
    // 3. Inside: companies of this size across the industry.
    const sz = shrink(B.rpe, [[`I:${p?.industry || 'Technology'}|${band}`, `${p?.industry || 'Technology'}, ${band} staff`], [`band:${band}`, `${band} staff, all industries`]], 10);
    if (sz && sz.n >= 3) out.push({ key: 'size', label: 'Deals of the same size', rpe: sz.median, mid: mEur(sz.median, emp), low: mEur(sz.p25, emp), high: mEur(sz.p75, emp), n: sz.n, sd: sz.sd, weight: Math.min(2, 0.5 + sz.n / 40), basis: `${emp} staff × €${Math.round(sz.median)}k per head (${describe(sz)})` });
    // 4. CRM companies with stated revenue.
    const coKeys = [niche && [`n:${niche}`, niche], p?.subsector && [`U:${p.subsector}`, p.subsector], p?.sector && [`S:${p.sector}`, p.sector], p?.industry && [`I:${p.industry}`, p.industry]].filter(Boolean);
    const co = coKeys.length ? shrink(B.co, coKeys, 4) : null;
    if (co && co.n >= 3) out.push({ key: 'crm', label: 'Companies in the database', rpe: co.median, mid: mEur(co.median, emp), low: mEur(co.p25, emp), high: mEur(co.p75, emp), n: co.n, sd: co.sd, weight: Math.min(3, 0.5 + co.n / 10), basis: `${emp} staff × €${Math.round(co.median)}k per head (${describe(co).replace(/deals/g, 'companies with known revenue')})` });
    // 5. External benchmark.
    const pk = [niche && Taxonomy.subsectorOf(niche), p?.subsector, p?.sector, p?.industry].find(k => k && PRIOR[k]);
    const pr = PRIOR[pk] || PRIOR.Technology;
    const ext = { median: pr[0] * sizeF, p25: pr[1] * sizeF, p75: pr[2] * sizeF, sd: Math.max(0.3, (ln(pr[2]) - ln(pr[1])) / 1.35) };
    out.push({ key: 'bench', label: 'External benchmark', rpe: ext.median, mid: mEur(ext.median, emp), low: mEur(ext.p25, emp), high: mEur(ext.p75, emp), n: null, sd: ext.sd, weight: 1.5, basis: `${emp} staff × €${Math.round(ext.median)}k per head (${pk || 'Technology'} benchmark €${pr[0]}k${sizeF !== 1 ? ` × ${sizeF} for ${band} staff` : ''}; Eurostat SBS / SaaS surveys)` });
    // 6. Signal-adjusted: the best headcount baseline × observed factors.
    const base = inside && inside.n >= 8 ? { v: inside.median, src: 'deal median' } : { v: exp((ln(ext.median) * 1.5 + (inside ? ln(inside.median) * Math.min(1.5, inside.n / 6) : 0)) / (1.5 + (inside ? Math.min(1.5, inside.n / 6) : 0))), src: 'benchmark' };
    const sig = signals(c), factor = sig.reduce((a, x) => a * x.factor, 1);
    if (sig.length) {
      const v = base.v * factor;
      out.push({ key: 'signals', label: 'Signal-adjusted', rpe: v, mid: mEur(v, emp), low: mEur(v * 0.72, emp), high: mEur(v * 1.38, emp), n: sig.length, sd: 0.35, weight: 2 + Math.min(2, sig.length * 0.5), basis: `${base.src} €${Math.round(base.v)}k × ${factor.toFixed(2)} (${sig.map(x => `${x.label} ×${x.factor}`).join(', ')})`, signals: sig });
    }
    // 7. Researched ARR / customers.
    if (s.arr > 0) out.push({ key: 'arr', label: 'ARR', mid: +s.arr * 1.1, low: +s.arr, high: +s.arr * 1.3, n: 1, sd: 0.12, weight: 5, basis: `ARR €${s.arr}m${s.arr_source ? ` (${s.arr_source})` : ''} + ~10 % services` });
    if (s.customers > 0 && s.acv > 0) { const v = (s.customers * s.acv) / 1000; out.push({ key: 'customers', label: 'Customers × contract value', mid: v, low: v * 0.7, high: v * 1.3, n: 1, sd: 0.3, weight: 2.5, basis: `${s.customers} customers × €${s.acv}k per year` }); }
    else if (s.customers > 0 && inside) { const acv = Math.max(2, Math.min(150, (inside.median * emp) / s.customers)); out.push({ key: 'customers', label: 'Customers', mid: (s.customers * acv) / 1000, low: (s.customers * acv * 0.5) / 1000, high: (s.customers * acv * 1.6) / 1000, n: 1, sd: 0.5, weight: 0.8, basis: `${s.customers} customers; implied €${Math.round(acv)}k per customer (no contract value known)` }); }
    // 8. Web reach (only with researched traffic).
    if (s.web_visits_month > 0) { const perVisit = fam === 'software' ? 0.9 : 0.4, v = (s.web_visits_month * 12 * perVisit) / 1e6; if (v > 0.05) out.push({ key: 'web', label: 'Web reach', mid: v, low: v * 0.4, high: v * 2.5, n: 1, sd: 0.8, weight: 0.5, basis: `${Engine.fmt(s.web_visits_month)} visits / month × €${perVisit} per visit (very rough)` }); }
    return out;
  }

  // ---------- Combination: weighted geometric mean, pooled spread, quality grade ----------
  function combine(ms, excluded = []) {
    const use = ms.filter(m => m.mid > 0 && !excluded.includes(m.key));
    if (!use.length) return null;
    // Stated figures dominate: when a stated / filed / ARR figure exists, headcount methods only nudge it.
    const hard = use.filter(m => ['stated', 'filed', 'arr'].includes(m.key));
    const list = hard.length ? use.map(m => ({ ...m, weight: hard.includes(m) ? m.weight : m.weight * 0.15 })) : use;
    const W = list.reduce((a, m) => a + m.weight, 0);
    const mu = list.reduce((a, m) => a + m.weight * ln(m.mid), 0) / W;
    // Spread: within-method spread plus disagreement between the methods.
    const within = list.reduce((a, m) => a + m.weight * (m.sd || 0.4) ** 2, 0) / W;
    const between = list.reduce((a, m) => a + m.weight * (ln(m.mid) - mu) ** 2, 0) / W;
    const sd = Math.sqrt(within / Math.min(list.length, 3) + between);
    const mid = exp(mu);
    const grade = hard.length && sd < 0.25 ? 'A' : sd < 0.35 ? 'B' : sd < 0.5 ? 'C' : sd < 0.7 ? 'D' : 'E';
    return { mid, p25: exp(mu - 0.674 * sd), p75: exp(mu + 0.674 * sd), low80: exp(mu - 1.28 * sd), high80: exp(mu + 1.28 * sd), sd, grade, methods: list.length, weights: Object.fromEntries(list.map(m => [m.key, Math.round((m.weight / W) * 100)])) };
  }

  // ---------- Valuation from the estimate: EV/Revenue of comparable deals, EV per employee, EBITDA route ----------
  const MARGIN = { software: [0.15, 0.05, 0.28], services: [0.1, 0.04, 0.16], other: [0.1, 0.04, 0.18] };
  function valuation(c, est) {
    if (!est) return null;
    const B = benchmarks(), p = Taxonomy.pathOfCompany(c), emp = headcountOf(c), fam = familyOf(p), out = [];
    const keys = [c.niche && [`n:${c.niche}`, c.niche], p?.subsector && [`U:${p.subsector}`, p.subsector], p?.sector && [`S:${p.sector}`, p.sector], p?.industry && [`I:${p.industry}`, p.industry], ['all', 'all deals']].filter(Boolean);
    const m = shrink(B.mult, keys, 8);
    // Small companies trade below the (mostly larger) deals in the database: a size discount on the multiple.
    const disc = est.mid < 2 ? 0.55 : est.mid < 5 ? 0.65 : est.mid < 10 ? 0.75 : est.mid < 25 ? 0.85 : 1;
    if (m && m.n >= 3) out.push({ key: 'evrev', label: 'EV / Revenue of comparable deals', mid: est.mid * m.median * disc, low: est.p25 * m.p25 * disc, high: est.p75 * m.p75 * disc, basis: `€${est.mid.toFixed(1)}m × ${m.median.toFixed(1)}× (${describe(m)}; P25–P75 ${m.p25.toFixed(1)}–${m.p75.toFixed(1)}×)${disc < 1 ? ` × ${disc} size discount` : ''}` });
    const e = emp ? shrink(B.ev, keys, 8) : null;
    if (e && e.n >= 3) out.push({ key: 'evemp', label: 'EV per employee of comparable deals', mid: (e.median * emp * disc) / 1000, low: (e.p25 * emp * disc) / 1000, high: (e.p75 * emp * disc) / 1000, basis: `${emp} staff × €${Math.round(e.median)}k EV per head (${describe(e)})${disc < 1 ? ` × ${disc}` : ''}` });
    const mg = MARGIN[fam] || MARGIN.other, ebitda = c.ebitda > 0 ? c.ebitda : est.mid * mg[0];
    const eve = { median: fam === 'software' ? 11 : 7.5, p25: fam === 'software' ? 8 : 5.5, p75: fam === 'software' ? 15 : 10 };
    out.push({ key: 'ebitda', label: c.ebitda > 0 ? 'EV / EBITDA (stated EBITDA)' : 'EV / EBITDA (estimated margin)', mid: ebitda * eve.median * disc, low: (c.ebitda > 0 ? c.ebitda : est.p25 * mg[1]) * eve.p25 * disc, high: (c.ebitda > 0 ? c.ebitda : est.p75 * mg[2]) * eve.p75 * disc, basis: `${c.ebitda > 0 ? `EBITDA €${c.ebitda}m` : `${Math.round(mg[0] * 100)} % margin → EBITDA €${ebitda.toFixed(2)}m`} × ${eve.median}× (small-cap ${fam} range ${eve.p25}–${eve.p75}×)${disc < 1 ? ` × ${disc}` : ''}` });
    const W = out.length, mu = out.reduce((a, x) => a + ln(Math.max(0.01, x.mid)), 0) / W;
    const sd = Math.sqrt(out.reduce((a, x) => a + (ln(Math.max(0.01, x.mid)) - mu) ** 2, 0) / W + 0.12);
    return { methods: out, mid: exp(mu), low: exp(mu - 0.674 * sd), high: exp(mu + 0.674 * sd), evEmp: e, mult: m };
  }

  // Full estimate for one company (methods, combination, valuation). `excluded` lists method keys switched off.
  function estimate(c, excluded = c.rev_est?.excluded || []) {
    const ms = methods(c), est = combine(ms, excluded);
    return { methods: ms, est, excluded, val: est ? valuation(c, est) : null, headcount: headcountOf(c) };
  }
  // Short form stored on the company so lists, exports and the match engine can use it without recomputing.
  // Investors and funds have no "revenue" in this sense.
  const skip = c => typeof Enricher !== 'undefined' && Enricher.isFinancial(c);
  function snapshot(c) {
    if (skip(c)) return null;
    const r = estimate(c);
    if (!r.est) return null;
    return { mid: +r.est.mid.toFixed(2), p25: +r.est.p25.toFixed(2), p75: +r.est.p75.toFixed(2), grade: r.est.grade, ev: r.val ? +r.val.mid.toFixed(2) : null, ev_low: r.val ? +r.val.low.toFixed(2) : null, ev_high: r.val ? +r.val.high.toFixed(2) : null, at: new Date().toISOString().slice(0, 10), excluded: r.excluded.length ? r.excluded : undefined, methods: r.methods.length };
  }
  // A live snapshot for companies without a saved one, memoised per company until the deals or its facts change.
  // Used by lists and the match engine (size fit, buyer / target likelihood).
  const memo = new WeakMap();
  function cached(c) {
    if (!c || c.revenue > 0 || skip(c) || !headcountOf(c)) return null;
    if (c.rev_est?.mid) return c.rev_est;
    const sig = benchmarks().sig + '|' + headcountOf(c) + '|' + (c.niche || '') + '|' + (c.ownership || '') + '|' + (c.founded || '') + '|' + (c.rev_signals?.at || '');
    const hit = memo.get(c);
    if (hit && hit.sig === sig) return hit.v;
    const v = snapshot(c);
    memo.set(c, { sig, v });
    return v;
  }
  const fmtM = v => v == null ? '' : v >= 100 ? `€${Math.round(v)}m` : v >= 10 ? `€${v.toFixed(0)}m` : v >= 1 ? `€${v.toFixed(1)}m` : `€${Math.round(v * 1000)}k`;

  return { estimate, methods, combine, valuation, snapshot, cached, benchmarks, signals, fmtM, bandOf, PRIOR, SIZE_FACTOR, COUNTRY, headcountOf, dealEmployees, skip };
})();
