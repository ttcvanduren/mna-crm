// Import parsing, duplicate detection and matching. No DOM access here, so it can be tested on its own.
const Engine = (() => {
  // ---------- Field definitions ----------
  // `aliases` are header names (lowercased, letters/digits only) recognised on upload.
  const COMPANY_FIELDS = [
    { key: 'name', label: 'Company name', aliases: ['company', 'companyname', 'name', 'bedrijf', 'bedrijfsnaam', 'organisation', 'organization', 'account', 'investor', 'buyer', 'target', 'fund'] },
    { key: 'website', label: 'Website', aliases: ['website', 'url', 'web', 'domain', 'site', 'companywebsite', 'webadres'] },
    { key: 'linkedin_url', label: 'LinkedIn page', aliases: ['companylinkedin', 'linkedinpage', 'linkedincompany', 'linkedincompanypage'] },
    { key: 'role', label: 'Role (Target / Buyer / Investor)', aliases: ['role', 'type', 'buyertype', 'rol'] },
    { key: 'sector', label: 'Sector', aliases: ['sector', 'industry', 'branche', 'vertical', 'category', 'primaryindustry', 'industrygroup'] },
    { key: 'subsector', label: 'Sub-sector', aliases: ['subsector', 'subindustry', 'niche', 'segment', 'subcategory', 'industryclassifications', 'primarysector'] },
    { key: 'country', label: 'Country', aliases: ['country', 'land', 'hq', 'headquarters', 'location', 'countryregion', 'countryofincorporation', 'countryregionofincorporation', 'hqcountry'] },
    { key: 'hq_city', label: 'HQ city', aliases: ['city', 'hqcity', 'plaats', 'stad'] },
    { key: 'region', label: 'Region', aliases: ['region', 'regio', 'geographiclocations', 'geography'] },
    { key: 'currency', label: 'Currency', aliases: ['currency', 'valuta', 'reportingcurrency'] },
    { key: 'revenue', label: 'Revenue (m)', aliases: ['revenue', 'sales', 'turnover', 'omzet'], num: true, money: true },
    { key: 'ebitda', label: 'EBITDA (m)', aliases: ['ebitda'], num: true, money: true },
    { key: 'employees', label: 'Employees', aliases: ['employees', 'fte', 'headcount', 'medewerkers', 'staff', 'noofemployees', 'totalemployees'], num: true },
    { key: 'linkedin_employees', label: 'Employees on LinkedIn', aliases: ['linkedinemployees', 'employeesonlinkedin'], num: true },
    { key: 'founded', label: 'Founded', aliases: ['founded', 'yearfounded', 'foundingyear', 'established', 'opgericht'] },
    { key: 'ownership', label: 'Ownership', aliases: ['ownership', 'owner', 'shareholder', 'shareholders', 'eigenaar', 'companytype', 'ownershiptype'] },
    { key: 'ticker', label: 'Ticker', aliases: ['ticker', 'exchangeticker', 'symbol'] },
    { key: 'capiq_id', label: 'Capital IQ ID', aliases: ['capitaliqid', 'ciqid', 'spcapitaliqid', 'capiqid', 'companyid', 'spcompanyid'] },
    { key: 'portfolio', label: 'Portfolio companies', aliases: ['portfolio', 'portfoliocompanies'] },
    { key: 'short_description', label: 'Short description', aliases: ['shortdescription', 'tagline', 'summary', 'oneliner'] },
    { key: 'description', label: 'Description', aliases: ['description', 'about', 'omschrijving', 'businessdescription', 'profile', 'generalcomment', 'longbusinessdescription'], long: true },
    { key: 'keywords', label: 'Keywords', aliases: ['keywords', 'tags', 'products', 'services'] },
    { key: 'target_sectors', label: 'Looking for sectors', aliases: ['targetsectors', 'interestsectors', 'acquisitionsectors', 'focussectors', 'focus', 'investmentfocus', 'lookingforsectors'] },
    { key: 'target_countries', label: 'Looking for countries', aliases: ['targetcountries', 'lookingforcountries', 'targetgeography', 'focuscountries', 'geographicfocus', 'focusgeography'] },
    { key: 'min_revenue', label: 'Min target revenue', aliases: ['minrevenue', 'mintargetrevenue', 'minsize'], num: true, money: true },
    { key: 'max_revenue', label: 'Max target revenue', aliases: ['maxrevenue', 'maxtargetrevenue', 'maxsize'], num: true, money: true },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'notities'], long: true },
  ];
  const CONTACT_FIELDS = [
    { key: 'name', label: 'name', aliases: ['contactname', 'contact', 'contactperson', 'fullname', 'person', 'naam', 'contactpersoon'] },
    { key: 'title', label: 'function', aliases: ['function', 'title', 'jobtitle', 'functie', 'position', 'contacttitle', 'contactfunction'] },
    { key: 'email', label: 'email', aliases: ['email', 'emailaddress', 'mail', 'contactemail', 'emailadres'] },
    { key: 'phone', label: 'phone', aliases: ['phone', 'telephone', 'tel', 'telefoon', 'mobile', 'phonenumber'] },
    { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin', 'linkedinurl', 'linkedinprofile', 'contactlinkedin'] },
  ];
  // Per-project information (a buyer can appear in many projects with a different status each time).
  const PROJECT_FIELDS = [
    { key: 'status', label: 'Status / current stage', aliases: ['currentstage', 'status', 'stage', 'processstatus'] },
    { key: 'furthest_stage', label: 'Furthest stage reached', aliases: ['furtheststagereached', 'furtheststage', 'higheststage'] },
    { key: 'last_contact', label: 'Date of last contact', aliases: ['dateoflastcontact', 'lastcontact', 'lastcontactdate', 'date'], date: true },
    { key: 'pass_reason', label: 'Pass reason', aliases: ['passreason', 'reason', 'reasonforpassing', 'declinereason', 'reasonpassed'] },
    { key: 'rationale', label: 'Acquisition rationale', aliases: ['acquisitionrationale', 'rationale', 'fitrationale', 'investmentrationale', 'strategicrationale', 'whyfit'] },
    { key: 'wave', label: 'Outreach wave', aliases: ['outreachwave', 'wave'] },
    { key: 'log', label: 'Log', aliases: ['log', 'history', 'activitylog'] },
    { key: 'responsible', label: 'Responsible', aliases: ['responsible', 'coverage', 'dealteam', 'accountowner'] },
    { key: 'tier', label: 'Tier / priority', aliases: ['tier', 'priority', 'prio'] },
    { key: 'remarks', label: 'Remarks', aliases: ['remarks', 'comment', 'comments', 'internalcomment', 'opmerkingen', 'internalnotes', 'detail'], multi: true },
  ];

  // Groups free-text pipeline statuses from different lists into one funnel.
  const STAGE_GROUPS = ['Not approached', 'Approached', 'Engaged', 'Passed', 'Other'];
  function stageGroup(s) {
    const t = lower(s);
    if (!t) return 'Not approached';
    if (/pass|declin|not interested|no interest|dropped|rejected|lost/.test(t)) return 'Passed';
    if (/not (yet )?approached|^1\.|to approach|^new$/.test(t)) return 'Not approached';
    if (/nda|\bim\b|info ?memo|meeting|session|positive|conversation|interested|review|loi|offer|due diligence|dd\b|^[5-9]\./.test(t)) return 'Engaged';
    if (/teaser|reminder|contact|awaiting|no response|approached|sent|group level|via group|^[2-4]\./.test(t)) return 'Approached';
    return 'Other';
  }

  // Simple ownership buckets for filtering.
  function ownershipType(s) {
    const t = lower(s);
    if (!t) return '';
    if (/listed|public|nasdaq|nyse|xetra|lse|euronext|ticker|\(.*:.*\)/.test(t)) return 'Listed';
    if (/private equity|pe[- ]backed|\bpe\b|buyout|taken private|sponsor/.test(t)) return 'PE-backed';
    if (/\bvc\b|venture/.test(t)) return 'VC-backed';
    if (/subsidiary|part of|owned by|division/.test(t)) return 'Subsidiary';
    if (/founder|family|private|employee|owner/.test(t)) return 'Private / founder';
    return 'Other';
  }
  const MAX_CONTACTS = 5;
  // Fuzzy "contains" matching for headers like "Status Lakeside" or "Date of last contact/note".
  // Capital IQ style headers ("Total Revenue [LTM] ($USDmm, Historical rate)") land here too.
  const CONTAINS = [['lastcontact', 'project.last_contact'], ['status', 'project.status'], ['comment', 'project.remarks'], ['remark', 'project.remarks'], ['email', 'contact1.email'],
    ['website', 'company.website'], ['revenue', 'company.revenue'], ['ebitda', 'company.ebitda'], ['employee', 'company.employees'], ['description', 'company.description'],
    ['industry', 'company.sector'], ['country', 'company.country'], ['founded', 'company.founded'], ['ticker', 'company.ticker'], ['linkedin', 'contact1.linkedin']];

  const TARGET_OPTIONS = [
    ...COMPANY_FIELDS.map(f => ({ value: 'company.' + f.key, label: f.label, group: 'Company' })),
    ...Array.from({ length: MAX_CONTACTS }, (_, i) => CONTACT_FIELDS.map(f => ({ value: `contact${i + 1}.${f.key}`, label: `Contact ${i + 1} ${f.label}`, group: 'Contacts' }))).flat(),
    ...PROJECT_FIELDS.map(f => ({ value: 'project.' + f.key, label: f.label, group: 'Project' })),
    { value: 'extra', label: 'Keep as extra info', group: 'Other' },
    { value: 'ignore', label: 'Ignore', group: 'Other' },
  ];
  const MULTI_TARGETS = new Set(['extra', 'ignore', 'project.remarks']);

  const STATUSES = ['New', 'Contacted', 'Interested', 'NDA', 'Declined', 'Closed'];

  const REGIONS = {
    Benelux: ['netherlands', 'nederland', 'the netherlands', 'nl', 'belgium', 'belgie', 'belgië', 'be', 'luxembourg', 'lu'],
    DACH: ['germany', 'duitsland', 'deutschland', 'de', 'austria', 'at', 'oostenrijk', 'switzerland', 'ch', 'zwitserland'],
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

  const STOPWORDS = new Set('a an and or the of for in on to with by from at as is are be we our their its it this that b2b b2c company companies group holding bv nv ltd gmbh inc llc services solutions provider leading based international also own e.g. etc'.split(' '));
  // Removed when comparing names for duplicates: "x-tention Unternehmensgruppe" = "X-Tention GmbH".
  const LEGAL_WORDS = new Set('bv b.v nv n.v gmbh ag sa sas sarl srl spa ltd limited plc inc incorporated llc lp llp co kg ohg se ab as oy aps bvba vof cv holding holdings group groep gruppe unternehmensgruppe the de and'.split(' '));

  const DEFAULT_WEIGHTS = { sector: 35, geography: 15, size: 20, keywords: 20, role: 10 };
  const WEIGHT_LABELS = { sector: 'Sector', geography: 'Geography', size: 'Size fit', keywords: 'Keywords', role: 'Buyer/target role' };

  const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const lower = s => norm(s).toLowerCase();
  const headerKey = h => lower(h).replace(/[^a-z0-9]/g, '');
  const EMPTYISH = /^(x|\.|-|–|—|n\/?a|na|tbd|\?|0)$/i;
  const clean = v => (v == null ? '' : EMPTYISH.test(norm(v)) ? '' : norm(v));
  const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  const exactAlias = {};
  COMPANY_FIELDS.forEach(f => f.aliases.forEach(a => (exactAlias[a] ??= 'company.' + f.key)));
  PROJECT_FIELDS.forEach(f => f.aliases.forEach(a => (exactAlias[a] ??= 'project.' + f.key)));
  const contactAlias = {};
  CONTACT_FIELDS.forEach(f => f.aliases.forEach(a => (contactAlias[a] = f.key)));

  // Best guess for one header, ignoring which targets are already taken.
  function guessTarget(header) {
    const hk = headerKey(header);
    if (!hk) return 'ignore';
    if (exactAlias[hk]) return exactAlias[hk];
    if (contactAlias[hk]) return 'contact1.' + contactAlias[hk];
    const m = hk.match(/^([a-z]+?)(\d)$/);
    if (m && contactAlias[m[1]] && +m[2] >= 1 && +m[2] <= MAX_CONTACTS) return `contact${m[2]}.${contactAlias[m[1]]}`;
    if (m && contactAlias['contact' + m[1]]) return `contact${m[2]}.${contactAlias['contact' + m[1]]}`;
    for (const [frag, t] of CONTAINS) if (hk.includes(frag)) return t;
    return 'extra';
  }

  // Maps every header of a sheet to a target. Exact matches claim a field before fuzzy ones;
  // a second column for the same field becomes "extra".
  function mapHeaders(headers, memory = {}) {
    const out = headers.map(() => null), taken = new Set();
    const claim = (i, t) => {
      if (!MULTI_TARGETS.has(t) && taken.has(t)) return false;
      taken.add(t); out[i] = t; return true;
    };
    headers.forEach((h, i) => { const mem = memory[headerKey(h)]; if (mem) claim(i, mem); });
    headers.forEach((h, i) => {
      if (out[i]) return;
      const t = guessTarget(h), hk = headerKey(h);
      const exact = exactAlias[hk] || contactAlias[hk] || /\d$/.test(hk);
      if (exact && t !== 'extra') claim(i, t);
    });
    headers.forEach((h, i) => { if (!out[i]) claim(i, guessTarget(h)) || claim(i, 'extra'); });
    return out;
  }

  // Picks the row that looks most like a header within the first 25 rows.
  function detectHeaderRow(rows) {
    let best = 0, bestScore = -1;
    rows.slice(0, 25).forEach((r, i) => {
      const cells = r.filter(v => typeof v === 'string' && v.trim());
      const t = cells.map(guessTarget);
      const score = t.filter(x => x !== 'extra' && x !== 'ignore').length + (t.includes('company.name') ? 3 : 0);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return best;
  }

  // Looks for "In EUR k" style hints above the header.
  function detectUnit(rows, headerRow) {
    const text = rows.slice(0, headerRow + 1).flat().join(' ').toLowerCase();
    if (/(eur|€|usd|\$)\s*'?k\b|\bin\s*k\b|thousand|'000|x\s*1[.,]?000\b|\(k\)|k€/.test(text)) return 'k';
    return 'm';
  }

  // "($USDmm" in Capital IQ headers, "In EUR k" in title rows.
  function detectCurrency(rows, headerRow) {
    const text = rows.slice(0, headerRow + 1).flat().join(' ').toLowerCase();
    if (/usd|us\$|\$/.test(text)) return 'USD';
    if (/gbp|£/.test(text)) return 'GBP';
    if (/\bchf\b/.test(text)) return 'CHF';
    if (/\bsek\b/.test(text)) return 'SEK';
    return 'EUR';
  }

  function guessRoleFromSheet(name) {
    const s = lower(name);
    if (/financ|invest|private equity|\bpe\b|fund|sponsor/.test(s)) return 'Investor';
    if (/strateg|buyer|corporate|acquir/.test(s)) return 'Buyer';
    if (/target|seller/.test(s)) return 'Target';
    return '';
  }
  const SKIP_SHEETS = /dashboard|graveyard|\bold\b|source|process|cache|^>>|>>$|readme|instruction|lookup|list of values/i;

  function guessProject(filename) {
    const m = String(filename).match(/project[\s_-]+([a-z0-9]+)/i);
    return m ? m[1][0].toUpperCase() + m[1].slice(1) : '';
  }

  // "€12,5m" -> 12.5, "1.2bn" -> 1200, "850k" -> 0.85. Plain numbers are multiplied by `unitMult`.
  function parseNumber(v, unitMult = 1) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v * unitMult : null;
    let s = lower(v).replace(/^(circa|approx\.?|ca\.?|c\.|~|>|<|\+\/-)\s*/, '').replace(/[€$£\s]|eur|usd|gbp/g, '');
    if (EMPTYISH.test(s) || !/\d/.test(s)) return null;
    let mult = unitMult;
    if (/(bn|b)$/.test(s)) { mult = 1000; s = s.replace(/(bn|b)$/, ''); }
    else if (/(mln|mio|mm|m)$/.test(s)) { mult = 1; s = s.replace(/(mln|mio|mm|m)$/, ''); }
    else if (/k$/.test(s)) { mult = 0.001; s = s.replace(/k$/, ''); }
    s = s.replace(/[^0-9.,-]/g, '');
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.250.000,5
    else if (s.includes(',') && !s.includes('.')) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * mult * 1000) / 1000;
  }

  // Excel serial dates (46316) and common text dates -> "2026-10-21".
  function parseDate(v) {
    if (v === '' || v == null) return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    const s = norm(v);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return s;
  }

  const splitList = s => norm(s).split(/[;,|/]+/).map(lower).filter(Boolean);

  function normaliseRole(r) {
    const s = lower(r);
    if (!s) return '';
    if (/target|seller|sell|verkoop|for sale|mandate/.test(s)) return 'Target';
    if (/invest|private equity|\bpe\b|fund|family office|financial|sponsor/.test(s)) return 'Investor';
    if (/buyer|strategic|acquir|koper|corporate/.test(s)) return 'Buyer';
    return norm(r);
  }

  function regionOf(c) {
    if (c.region) return norm(c.region);
    return COUNTRY_TO_REGION[lower(c.country)] || '';
  }

  // Turns one spreadsheet row into { company, contacts, project }.
  function parseRow(row, headers, targets, opts = {}) {
    const unitMult = opts.unit === 'k' ? 0.001 : 1;
    const company = {}, contacts = [], project = { project: opts.project || '', source: opts.source || '', remarks: [], extra: {} };
    targets.forEach((t, i) => {
      const raw = row[i];
      if (!t || t === 'ignore' || raw === '' || raw == null) return;
      const [scope, key] = t.split('.');
      if (scope === 'company') {
        const f = COMPANY_FIELDS.find(x => x.key === key);
        const v = f.num ? parseNumber(raw, f.money ? unitMult : 1) : clean(raw);
        if (v !== '' && v != null && company[key] == null) company[key] = v;
      } else if (scope.startsWith('contact')) {
        const idx = +scope.slice(7) - 1;
        const v = clean(raw);
        if (!v) return;
        contacts[idx] ??= {};
        if (key === 'email') {
          const m = v.match(EMAIL_RE);
          if (m) contacts[idx].email = m[0].toLowerCase();
          else contacts[idx].note = v;
        } else if (key === 'linkedin') contacts[idx].linkedin = cleanUrl(v);
        else contacts[idx][key] = v;
      } else if (scope === 'project') {
        if (key === 'remarks') { const v = clean(raw); if (v) project.remarks.push(`${norm(headers[i])}: ${v}`); }
        else if (key === 'last_contact') project.last_contact = parseDate(raw);
        else project[key] = norm(raw);
      } else if (t === 'extra') {
        const h = norm(headers[i]) || `Column ${i + 1}`;
        const v = typeof raw === 'number' && /date/i.test(h) ? parseDate(raw) : norm(raw);
        if (v && !EMPTYISH.test(v)) project.extra[h] = v;
      }
    });
    company.role = normaliseRole(company.role) || (/private equity|venture capital|investment firm|family office/i.test(company.ownership || '') ? 'Investor' : '') || opts.role || '';
    if (company.linkedin_url) company.linkedin_url = cleanUrl(company.linkedin_url);
    if (company.website && !/[a-z0-9-]\.[a-z]{2,}/i.test(company.website)) delete company.website; // e.g. "Reference", "n/a"
    if (!company.currency && (company.revenue != null || company.ebitda != null)) company.currency = opts.currency || 'EUR';
    project.remarks = project.remarks.join(' | ');
    return { company, contacts: contacts.filter(c => c && (c.name || c.email)), project };
  }

  // ---------- Duplicates ----------
  function normName(name) {
    const s = lower(name)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ');
    const words = s.split(' ').filter(w => w && !LEGAL_WORDS.has(w));
    return words.join(' ') || s.trim();
  }
  function domainOf(url) {
    const s = lower(url);
    if (!s) return '';
    try { return new URL(/^https?:/.test(s) ? s : 'https://' + s).hostname.replace(/^www\d?\./, ''); } catch { return ''; }
  }

  function cleanUrl(u) {
    const s = norm(u);
    if (!s || !/[a-z0-9-]+\.[a-z]{2,}/i.test(s)) return '';
    return (/^https?:\/\//i.test(s) ? s : 'https://' + s).replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
  // "Thomas Bähler" = "Thomas Baehler" = "thomas bahler"
  const personKey = s => lower(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(dr|mr|mrs|ms|prof|ir|drs|ing|mag)\.?\s+/g, '').replace(/[^a-z]/g, '');
  const linkedinKey = u => lower(u).replace(/^https?:\/\/([a-z]{2,3}\.)?(www\.)?/, '').replace(/\/+$/, '');

  // Lookup maps so duplicate checks stay fast with tens of thousands of companies.
  function buildIndex(list) {
    const idx = { byNorm: new Map(), byDomain: new Map(), byKey: new Map(), byFirst: new Map() };
    list.forEach(c => indexAdd(idx, c));
    return idx;
  }
  const push = (m, k, c) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(c)) a.push(c); } else m.set(k, [c]); };
  function indexAdd(idx, c) {
    const n = c._norm ?? normName(c.name);
    push(idx.byNorm, n, c);
    push(idx.byDomain, c._domain ?? domainOf(c.website), c);
    if (c.capiq_id) push(idx.byKey, 'ciq:' + lower(c.capiq_id), c);
    if (c.linkedin_url) push(idx.byKey, 'li:' + linkedinKey(c.linkedin_url), c);
    push(idx.byFirst, n.split(' ')[0], c);
  }

  // Exact: same website domain, Capital IQ ID, LinkedIn page or cleaned name. Possible: one name is the start of the other.
  function findDuplicates(company, listOrIndex) {
    const idx = Array.isArray(listOrIndex) ? buildIndex(listOrIndex) : listOrIndex;
    const n = normName(company.name), d = domainOf(company.website);
    const exact = new Set();
    for (const c of [...(idx.byNorm.get(n) || []), ...(d ? idx.byDomain.get(d) || [] : []),
      ...(company.capiq_id ? idx.byKey.get('ciq:' + lower(company.capiq_id)) || [] : []),
      ...(company.linkedin_url ? idx.byKey.get('li:' + linkedinKey(company.linkedin_url)) || [] : [])]) if (c !== company) exact.add(c);
    const possible = [];
    if (n.length >= 4) for (const c of idx.byFirst.get(n.split(' ')[0]) || []) {
      if (c === company || exact.has(c)) continue;
      const cn = c._norm ?? normName(c.name);
      if (cn.length >= 4 && (cn.startsWith(n + ' ') || n.startsWith(cn + ' ') || n.replace(/ /g, '') === cn.replace(/ /g, ''))) possible.push(c);
    }
    return { exact: [...exact], possible };
  }

  const isBlank = v => v === '' || v == null;

  // Merges parsed row data into an existing company. Blank fields are filled; existing values win.
  function mergeInto(target, { company, contacts = [], project }) {
    for (const [k, v] of Object.entries(company)) if (!isBlank(v) && isBlank(target[k])) target[k] = v;
    target.contacts ??= [];
    for (const ct of contacts) {
      const same = target.contacts.find(x => (ct.email && x.email === ct.email) || (ct.linkedin && x.linkedin && linkedinKey(x.linkedin) === linkedinKey(ct.linkedin)) || (!ct.email || !x.email) && ct.name && personKey(x.name) === personKey(ct.name));
      if (same) { for (const [k, v] of Object.entries(ct)) if (!isBlank(v) && isBlank(same[k])) same[k] = v; }
      else target.contacts.push({ ...ct });
    }
    const hasProjectData = project && ['status', 'furthest_stage', 'log', 'last_contact', 'responsible', 'tier', 'remarks', 'pass_reason', 'rationale', 'wave'].some(k => !isBlank(project[k]));
    // Plain company lists (e.g. Capital IQ screens) keep their extra columns on the company itself.
    if (project && !hasProjectData && !project.project && Object.keys(project.extra || {}).length) target.extra = { ...(target.extra || {}), ...project.extra };
    if (project && (hasProjectData || project.project)) {
      if (!project.project) project = { ...project, project: String(project.source || 'List').split(' › ')[0].replace(/\.[^.]+$/, '') };
      target.projects ??= [];
      const p = target.projects.find(x => x.project === project.project);
      if (p) {
        // The newest upload of the same project wins for status fields.
        for (const [k, v] of Object.entries(project)) if (k !== 'extra' && !isBlank(v)) p[k] = v;
        p.extra = { ...(p.extra || {}), ...(project.extra || {}) };
        if (project.source && !String(p.source).includes(project.source)) p.source = [p.source, project.source].filter(Boolean).join('; ');
      } else target.projects.push({ ...project });
    }
    if (project?.source) {
      target.sources ??= [];
      if (!target.sources.includes(project.source)) target.sources.push(project.source);
    }
    target._norm = normName(target.name);
    target._domain = domainOf(target.website);
    return target;
  }

  // Merges company `b` into `a` (manual merge).
  function mergeCompanies(a, b) {
    mergeInto(a, { company: Object.fromEntries(Object.entries(b).filter(([k]) => !['id', 'contacts', 'projects', 'sources', 'acquisitions', 'enrichment', '_norm', '_domain'].includes(k))), contacts: b.contacts || [] });
    if (!a.acquisitions?.length && b.acquisitions?.length) a.acquisitions = b.acquisitions;
    if (!a.enrichment && b.enrichment) a.enrichment = b.enrichment;
    for (const p of b.projects || []) mergeInto(a, { company: {}, project: p });
    a.sources ??= [];
    for (const s of b.sources || []) if (!a.sources.includes(s)) a.sources.push(s);
    return a;
  }

  // ---------- Matching ----------
  const primaryContact = c => (c.contacts || []).find(x => x.email) || null;
  const hasEmail = c => !!primaryContact(c);

  function tokens(c) {
    const text = [c.short_description, c.summary, c.description, c.keywords, (c.tags || []).join(' '), c.subsector, c.sector, c.portfolio].join(' ').toLowerCase();
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
    if (dc && candWants.some(w => w === dc || w === lower(dr) || (w === 'europe' && EUROPE.has(dr)) || w === 'global')) return [1, `Targets ${deal.country}`];
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
        return { company: c, score: Math.round((sum / totalW) * 100), reasons: Object.values(parts).map(p => p[1]).filter(Boolean) };
      })
      .sort((a, b) => b.score - a.score);
  }

  function fmt(n) {
    if (n == null || n === '') return '';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 1 : 0 });
  }

  // Fills {{placeholders}} in a template for one contact at a candidate company.
  function render(tpl, deal, cand, contact = {}, extra = {}) {
    const first = norm(contact?.name).replace(/^(dr|mr|mrs|ms|prof|ir|drs|ing)\.?\s+/i, '').split(/\s+/)[0] || '';
    const vars = {
      first_name: first || 'Sir/Madam', contact_name: contact?.name || '', contact_title: contact?.title || '',
      company: cand.name || '', sector: cand.sector || '', country: cand.country || '',
      deal_name: deal.name || '', deal_sector: deal.sector || '', deal_subsector: deal.subsector || '', deal_country: deal.country || '',
      deal_revenue: deal.revenue != null ? `€${fmt(deal.revenue)}m` : '', deal_ebitda: deal.ebitda != null ? `€${fmt(deal.ebitda)}m` : '',
      deal_description: deal.description || '', ...extra,
    };
    return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  return {
    COMPANY_FIELDS, CONTACT_FIELDS, PROJECT_FIELDS, STAGE_GROUPS, stageGroup, ownershipType, TARGET_OPTIONS, MAX_CONTACTS, STATUSES, DEFAULT_WEIGHTS, WEIGHT_LABELS, SKIP_SHEETS,
    headerKey, guessTarget, mapHeaders, detectHeaderRow, detectUnit, detectCurrency, guessRoleFromSheet, guessProject, parseRow, parseNumber, parseDate,
    normName, domainOf, cleanUrl, linkedinKey, personKey, buildIndex, indexAdd, findDuplicates, mergeInto, mergeCompanies, primaryContact, hasEmail, match, render, fmt, regionOf, normaliseRole,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
