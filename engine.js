// Matching engine and data helpers. No DOM access here, so it can be tested on its own.
const Engine = (() => {
  // Canonical company fields. `aliases` are header names accepted on upload (lowercased, no punctuation).
  const FIELDS = [
    { key: 'name', label: 'Company name', aliases: ['company', 'companyname', 'name', 'bedrijf', 'bedrijfsnaam', 'organisation', 'organization', 'account'] },
    { key: 'role', label: 'Role (Target / Buyer / Investor)', aliases: ['role', 'type', 'category', 'rol', 'companytype'] },
    { key: 'sector', label: 'Sector', aliases: ['sector', 'industry', 'branche', 'vertical'] },
    { key: 'subsector', label: 'Sub-sector', aliases: ['subsector', 'subindustry', 'niche', 'segment'] },
    { key: 'country', label: 'Country', aliases: ['country', 'land', 'hq', 'hqcountry', 'headquarters'] },
    { key: 'region', label: 'Region', aliases: ['region', 'regio'] },
    { key: 'revenue', label: 'Revenue (m)', aliases: ['revenue', 'revenuem', 'sales', 'turnover', 'omzet', 'revenueeurm', 'revenuemeur'], num: true },
    { key: 'ebitda', label: 'EBITDA (m)', aliases: ['ebitda', 'ebitdam', 'ebitdaeurm'], num: true },
    { key: 'employees', label: 'Employees', aliases: ['employees', 'fte', 'headcount', 'medewerkers', 'staff'], num: true },
    { key: 'description', label: 'Description', aliases: ['description', 'about', 'omschrijving', 'businessdescription', 'profile'], full: true, long: true },
    { key: 'keywords', label: 'Keywords', aliases: ['keywords', 'tags', 'products', 'services'], full: true },
    { key: 'target_sectors', label: 'Looking for sectors (buyers)', aliases: ['targetsectors', 'interestsectors', 'acquisitionsectors', 'focussectors', 'focus'] },
    { key: 'target_countries', label: 'Looking for countries (buyers)', aliases: ['targetcountries', 'targetgeography', 'focuscountries', 'geographicfocus', 'focusgeography'] },
    { key: 'min_revenue', label: 'Min target revenue (m)', aliases: ['minrevenue', 'mintargetrevenue', 'minsize'], num: true },
    { key: 'max_revenue', label: 'Max target revenue (m)', aliases: ['maxrevenue', 'maxtargetrevenue', 'maxsize'], num: true },
    { key: 'contact_name', label: 'Contact name', aliases: ['contact', 'contactname', 'contactperson', 'fullname', 'naam', 'person'] },
    { key: 'contact_title', label: 'Contact title', aliases: ['title', 'jobtitle', 'function', 'functie', 'position', 'contacttitle'] },
    { key: 'email', label: 'Email', aliases: ['email', 'emailaddress', 'mail', 'contactemail', 'e-mail'] },
    { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone', 'tel', 'telefoon', 'mobile'] },
    { key: 'website', label: 'Website', aliases: ['website', 'url', 'web', 'domain'] },
    { key: 'status', label: 'Status', aliases: ['status', 'stage'] },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'notities', 'comments', 'remarks'], full: true, long: true },
  ];
  const NUM_FIELDS = new Set(FIELDS.filter(f => f.num).map(f => f.key));
  const STATUSES = ['New', 'Contacted', 'Interested', 'NDA', 'Declined', 'Closed'];

  const REGIONS = {
    Benelux: ['netherlands', 'nederland', 'the netherlands', 'nl', 'belgium', 'belgie', 'belgië', 'be', 'luxembourg', 'lu'],
    DACH: ['germany', 'duitsland', 'deutschland', 'de', 'austria', 'at', 'switzerland', 'ch'],
    'UK & Ireland': ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'gb', 'great britain', 'ireland', 'ie'],
    Nordics: ['sweden', 'se', 'norway', 'no', 'denmark', 'dk', 'finland', 'fi', 'iceland'],
    France: ['france', 'frankrijk', 'fr'],
    'Southern Europe': ['spain', 'es', 'italy', 'it', 'portugal', 'pt', 'greece', 'gr'],
    CEE: ['poland', 'pl', 'czech republic', 'czechia', 'cz', 'hungary', 'hu', 'romania', 'ro', 'slovakia', 'sk', 'bulgaria', 'croatia', 'slovenia', 'estonia', 'latvia', 'lithuania'],
    'North America': ['united states', 'usa', 'us', 'canada', 'ca'],
  };
  const COUNTRY_TO_REGION = {};
  for (const [region, list] of Object.entries(REGIONS)) list.forEach(c => (COUNTRY_TO_REGION[c] = region));
  const EUROPE = new Set(['Benelux', 'DACH', 'UK & Ireland', 'Nordics', 'France', 'Southern Europe', 'CEE']);

  const STOPWORDS = new Set('a an and or the of for in on to with by from at as is are be we our their its it this that b2b b2c company companies group holding bv nv ltd gmbh inc llc services solutions provider leading based international'.split(' '));

  const DEFAULT_WEIGHTS = { sector: 35, geography: 15, size: 20, keywords: 20, role: 10 };
  const WEIGHT_LABELS = { sector: 'Sector', geography: 'Geography', size: 'Size fit', keywords: 'Keywords', role: 'Buyer/target role' };

  const norm = s => String(s ?? '').trim();
  const lower = s => norm(s).toLowerCase();
  const headerKey = h => lower(h).replace(/[^a-z0-9-]/g, '').replace(/-/g, '');

  const aliasMap = {};
  FIELDS.forEach(f => [f.key.replace(/_/g, ''), ...f.aliases].forEach(a => (aliasMap[a.replace(/-/g, '')] = f.key)));

  // "€12,5m" -> 12.5, "1.2bn" -> 1200, "850k" -> 0.85 (all in millions)
  function parseNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = lower(v).replace(/[€$£\s]|eur|usd|gbp/g, '');
    let mult = 1;
    if (/(bn|b)$/.test(s)) { mult = 1000; s = s.replace(/(bn|b)$/, ''); }
    else if (/(mln|mio|mm|m)$/.test(s)) { s = s.replace(/(mln|mio|mm|m)$/, ''); }
    else if (/k$/.test(s)) { mult = 0.001; s = s.replace(/k$/, ''); }
    if (s.includes(',') && !s.includes('.')) s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n * mult;
  }

  const splitList = s => norm(s).split(/[;,|/]+/).map(lower).filter(Boolean);

  function normaliseRole(r) {
    const s = lower(r);
    if (!s) return '';
    if (/target|seller|sell|verkoop|for sale|mandate/.test(s)) return 'Target';
    if (/invest|private equity|pe\b|fund|family office|financial/.test(s)) return 'Investor';
    if (/buyer|strategic|acquir|koper/.test(s)) return 'Buyer';
    return norm(r);
  }

  function regionOf(c) {
    if (c.region) return norm(c.region);
    return COUNTRY_TO_REGION[lower(c.country)] || '';
  }

  // Turns a raw spreadsheet row into a company record.
  function rowToCompany(row) {
    const c = {};
    for (const [h, v] of Object.entries(row)) {
      const key = aliasMap[headerKey(h)];
      if (!key || c[key]) continue;
      c[key] = NUM_FIELDS.has(key) ? parseNumber(v) : norm(v);
    }
    // Spreadsheets with "First name" + "Last name" columns
    if (!c.contact_name) {
      const get = re => Object.entries(row).find(([h]) => re.test(headerKey(h)))?.[1];
      const full = [get(/^(firstname|voornaam)$/), get(/^(lastname|surname|achternaam)$/)].filter(Boolean).join(' ');
      if (full) c.contact_name = full;
    }
    c.role = normaliseRole(c.role);
    c.email = lower(c.email);
    c.status = c.status || 'New';
    return c;
  }

  function tokens(c) {
    const text = [c.description, c.keywords, c.subsector, c.sector].join(' ').toLowerCase();
    return new Set(text.split(/[^a-z0-9à-ÿ]+/).filter(t => t.length > 2 && !STOPWORDS.has(t)));
  }

  const sameish = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));

  function sectorScore(deal, cand) {
    const ds = lower(deal.sector), cs = lower(cand.sector);
    const dSub = lower(deal.subsector), cSub = lower(cand.subsector);
    const candWants = splitList(cand.target_sectors), dealWants = splitList(deal.target_sectors);
    if (ds && candWants.some(w => sameish(w, ds) || sameish(w, dSub))) return [1, `Wants ${deal.sector}`];
    if (cs && dealWants.some(w => sameish(w, cs) || sameish(w, cSub))) return [1, `${cand.sector} is in deal focus`];
    if (ds && cs && ds === cs) return dSub && cSub && dSub === cSub ? [1, `Same sub-sector: ${cand.subsector}`] : [0.85, `Same sector: ${cand.sector}`];
    if (sameish(ds, cs) || (dSub && sameish(dSub, cSub))) return [0.6, `Related sector: ${cand.sector}`];
    const dt = new Set(ds.split(/\W+/).filter(t => t.length > 3)), overlap = cs.split(/\W+/).filter(t => dt.has(t));
    if (overlap.length) return [0.4, `Sector overlap: ${overlap[0]}`];
    return [0, null];
  }

  function geographyScore(deal, cand) {
    const dc = lower(deal.country), cc = lower(cand.country);
    const dr = regionOf(deal), cr = regionOf(cand);
    const candWants = splitList(cand.target_countries);
    if (dc && candWants.some(w => w === dc || lower(w) === lower(dr) || (w === 'europe' && EUROPE.has(dr)) || w === 'global')) return [1, `Targets ${deal.country}`];
    if (dc && dc === cc) return [1, `Same country: ${cand.country}`];
    if (dr && dr === cr) return [0.7, `Same region: ${cr}`];
    if (EUROPE.has(dr) && EUROPE.has(cr)) return [0.4, 'Both in Europe'];
    return [0, null];
  }

  // Buyer-side candidate should be able to afford the deal; target-side candidate should fit the deal's size criteria.
  function sizeScore(deal, cand, candIsBuyerSide) {
    const buyer = candIsBuyerSide ? cand : deal, target = candIsBuyerSide ? deal : cand;
    const tRev = target.revenue;
    if (tRev == null) return [0.3, null];
    const min = buyer.min_revenue, max = buyer.max_revenue;
    if (min != null || max != null) {
      const ok = (min == null || tRev >= min) && (max == null || tRev <= max);
      if (ok) return [1, `Revenue €${fmt(tRev)}m within ${min ?? 0}–${max ?? '∞'}m criteria`];
      const edge = min != null && tRev < min ? tRev / min : max / tRev;
      return [Math.max(0, edge - 0.5), null];
    }
    const bRev = buyer.revenue;
    if (bRev == null) return [0.3, null];
    if (candIsBuyerSide && cand.role === 'Investor') return [0.6, null];
    const ratio = bRev / tRev;
    if (ratio >= 3) return [1, `Buyer ${fmt(ratio)}× target size`];
    if (ratio >= 1) return [0.6 + 0.2 * (ratio - 1), `Buyer ${fmt(ratio)}× target size`];
    return [Math.max(0, ratio - 0.3), null];
  }

  function keywordScore(dealTokens, cand) {
    const ct = tokens(cand);
    if (!dealTokens.size || !ct.size) return [0, null];
    const shared = [...dealTokens].filter(t => ct.has(t));
    if (!shared.length) return [0, null];
    const sim = shared.length / Math.sqrt(dealTokens.size * ct.size);
    return [Math.min(1, sim * 2.5), `Keywords: ${shared.slice(0, 4).join(', ')}`];
  }

  const BUY_SIDE = new Set(['Buyer', 'Investor']);
  function roleScore(deal, cand) {
    if (!deal.role || !cand.role) return [0.5, null];
    if (deal.role === 'Target' && BUY_SIDE.has(cand.role)) return [1, `${cand.role} for a target`];
    if (BUY_SIDE.has(deal.role) && cand.role === 'Target') return [1, 'Potential target'];
    return [0, null];
  }

  function match(deal, companies, weights = DEFAULT_WEIGHTS) {
    const dealTokens = tokens(deal);
    const totalW = Object.values(weights).reduce((a, b) => a + Number(b), 0) || 1;
    const candIsBuyerSideDefault = !BUY_SIDE.has(deal.role);
    return companies
      .filter(c => c.id !== deal.id)
      .map(c => {
        const candIsBuyerSide = BUY_SIDE.has(c.role) || (!c.role && candIsBuyerSideDefault);
        const parts = {
          sector: sectorScore(deal, c),
          geography: geographyScore(deal, c),
          size: sizeScore(deal, c, candIsBuyerSide),
          keywords: keywordScore(dealTokens, c),
          role: roleScore(deal, c),
        };
        let sum = 0;
        for (const [k, [v]] of Object.entries(parts)) sum += v * Number(weights[k] || 0);
        return {
          company: c,
          score: Math.round((sum / totalW) * 100),
          reasons: Object.values(parts).map(p => p[1]).filter(Boolean),
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  function fmt(n) {
    if (n == null || n === '') return '';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 1 : 0 });
  }

  // Fills {{placeholders}} in a template.
  function render(tpl, deal, cand, extra = {}) {
    const first = norm(cand.contact_name).split(/\s+/)[0] || '';
    const vars = {
      first_name: first || 'Sir/Madam', contact_name: cand.contact_name || '', contact_title: cand.contact_title || '',
      company: cand.name || '', sector: cand.sector || '', country: cand.country || '',
      deal_name: deal.name || '', deal_sector: deal.sector || '', deal_subsector: deal.subsector || '', deal_country: deal.country || '',
      deal_revenue: deal.revenue != null ? `€${fmt(deal.revenue)}m` : '', deal_ebitda: deal.ebitda != null ? `€${fmt(deal.ebitda)}m` : '',
      deal_description: deal.description || '', ...extra,
    };
    return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  const fieldFor = h => aliasMap[headerKey(h)];

  return { FIELDS, STATUSES, fieldFor, DEFAULT_WEIGHTS, WEIGHT_LABELS, rowToCompany, parseNumber, match, render, fmt, regionOf, normaliseRole };
})();
if (typeof module !== 'undefined') module.exports = Engine;
