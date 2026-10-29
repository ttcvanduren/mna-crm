// Import parsing, duplicate detection and matching. No DOM access here, so it can be tested on its own.
const Engine = (() => {
  // ---------- Field definitions ----------
  // `aliases` are header names (lowercased, letters/digits only) recognised on upload.
  const COMPANY_FIELDS = [
    { key: 'name', label: 'Company name', aliases: ['company', 'companyname', 'name', 'bedrijf', 'bedrijfsnaam', 'organisation', 'organization', 'account', 'investor', 'buyer', 'target', 'fund'] },
    { key: 'website', label: 'Website', aliases: ['website', 'url', 'web', 'domain', 'site', 'companywebsite', 'webadres'] },
    { key: 'linkedin_url', label: 'LinkedIn page', aliases: ['companylinkedin', 'linkedinpage', 'linkedincompany', 'linkedincompanypage', 'companylinkedinurl'] },
    { key: 'role', label: 'Role (Target / Buyer / Investor)', aliases: ['role', 'type', 'buyertype', 'rol'] },
    { key: 'sector', label: 'Sector', aliases: ['sector', 'industry', 'branche', 'vertical', 'category', 'primaryindustry', 'industrygroup'] },
    { key: 'subsector', label: 'Sub-sector', aliases: ['subsector', 'subindustry', 'niche', 'segment', 'subcategory', 'industryclassifications', 'primarysector'] },
    { key: 'country', label: 'Country', aliases: ['country', 'land', 'hq', 'headquarters', 'location', 'countryregion', 'countryofincorporation', 'countryregionofincorporation', 'hqcountry', 'companycountry'] },
    { key: 'hq_city', label: 'HQ city', aliases: ['hqcity', 'companycity', 'plaats', 'stad', 'city'] },
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
    { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin', 'linkedinurl', 'linkedinprofile', 'contactlinkedin', 'personlinkedinurl', 'contactlinkedinurl'] },
    // Apollo-style exports split the name and add verification and department info.
    { key: 'first', label: 'first name', aliases: ['firstname', 'voornaam', 'vorname'] },
    { key: 'last', label: 'last name', aliases: ['lastname', 'surname', 'achternaam', 'nachname'] },
    { key: 'email_status', label: 'email status', aliases: ['emailstatus', 'emailverification'] },
    { key: 'seniority', label: 'seniority', aliases: ['seniority'] },
    { key: 'department', label: 'department', aliases: ['departments', 'department', 'subdepartments'] },
    { key: 'apollo_id', label: 'Apollo ID', aliases: ['apollocontactid', 'apolloid', 'apollopersonid'] },
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
    if (/nda|\bim\b|info ?memo|meeting|session|positive|conversation|interested|review|loi|\bioi\b|offer|binding|signed|data ?room|due diligence|dd\b|exclusiv|^[5-9]\./.test(t)) return 'Engaged';
    if (/teaser|reminder|contact|awaiting|no response|approached|sent|group level|via group|^[2-4]\./.test(t)) return 'Approached';
    return 'Other';
  }

  // Sell-side process stages per buyer, in order. Each stage also stamps a milestone date (DATE_KEYS).
  const BOARD_STAGES = ['Not approached', 'Teaser sent', 'Reminder sent', 'NDA sent', 'NDA signed', 'IM sent', 'IOI received', 'Management meeting', 'Data room / DD', 'Binding offer', 'Signed', 'Passed'];
  const DATE_KEYS = { 'Teaser sent': 'teaser', 'Reminder sent': 'reminder', 'NDA sent': 'nda_sent', 'NDA signed': 'nda_signed', 'IM sent': 'im', 'IOI received': 'ioi', 'Management meeting': 'meeting', 'Data room / DD': 'dataroom', 'Binding offer': 'binding', 'Signed': 'signed', 'Passed': 'passed' };
  function boardStage(s) {
    const t = lower(s);
    if (!t || /not (yet )?approached|^1\./.test(t)) return 'Not approached';
    if (/pass|declin|not interested|no interest|dropped|rejected/.test(t)) return 'Passed';
    if (/\bsigned\b(?!.*nda)|closed|completion|\bspa\b(?! mark)/.test(t) && !/nda/.test(t)) return 'Signed';
    if (/binding|\bloi\b|letter of intent|exclusiv|final offer/.test(t)) return 'Binding offer';
    if (/data ?room|due diligence|\bdd\b|\bvdr\b/.test(t)) return 'Data room / DD';
    if (/meeting|session|presentation|call|visit|\bmp\b/.test(t)) return 'Management meeting';
    if (/\bioi\b|indicative|offer|\bbid\b|term sheet/.test(t)) return 'IOI received';
    if (/\bim\b|info ?memo|under review|\bcim\b/.test(t)) return 'IM sent';
    if (/nda (sent|requested|out)|nda mark|positive|interested|conversation|^9\./.test(t)) return 'NDA sent';
    if (/nda/.test(t)) return 'NDA signed';
    if (/reminder|no response|awaiting|^[34]\./.test(t)) return 'Reminder sent';
    return 'Teaser sent';
  }
  const stageIndex = s => BOARD_STAGES.indexOf(boardStage(s));
  // Furthest real stage a buyer reached in a project (Passed doesn't count as progress).
  const reachedIndex = p => Math.max(stageIndex(p.status) === BOARD_STAGES.length - 1 ? 0 : stageIndex(p.status), p.furthest_stage ? stageIndex(p.furthest_stage) : 0);

  const PASS_REASONS = ['Price / valuation', 'Strategic fit', 'Size (too small/large)', 'Timing / other priorities', 'Product / technology overlap', 'Geography', 'Competitor or conflict', 'No response', 'Seller declined buyer', 'Other'];

  // Role tag from a job title, used to pick the right person to email.
  function inferRoleTag(title) {
    const t = lower(title);
    if (!t) return '';
    if (/m&a|m & a|mergers|acquisitions|\bm and a\b/.test(t)) return 'M&A';
    if (/corporate development|corp\.? ?dev|corporate finance/.test(t)) return 'Corporate Development';
    if (/strateg/.test(t)) return 'Strategy';
    if (/\bceo\b|chief executive|managing director|geschäftsführer|geschaftsfuhrer|\bmd\b|president|algemeen directeur/.test(t)) return 'CEO';
    if (/\bcfo\b|chief financial|finance director|financial director|head of finance/.test(t)) return 'CFO';
    if (/founder|owner|eigenaar|gründer/.test(t)) return 'Founder';
    if (/\bcoo\b|chief operating/.test(t)) return 'COO';
    if (/\bcto\b|chief technology/.test(t)) return 'CTO';
    if (/chair|board|aufsichtsrat|supervisory/.test(t)) return 'Board';
    if (/partner|principal|investment (manager|director)|associate/.test(t)) return 'Investment team';
    if (/business development|\bbd\b|partnership/.test(t)) return 'Business Development';
    return 'Other';
  }
  // Who should receive deal outreach first.
  const OUTREACH_PRIORITY = ['M&A', 'Corporate Development', 'Investment team', 'Strategy', 'CEO', 'Founder', 'CFO', 'Business Development', 'COO', 'Board', 'CTO', 'Other', ''];
  function bestContacts(c) {
    const rank = x => OUTREACH_PRIORITY.indexOf(x.role_tag || inferRoleTag(x.title)) + (x.email_status && x.email_status !== 'verified' ? 0.5 : 0);
    return (c.contacts || []).filter(x => x.email).sort((a, b) => rank(a) - rank(b));
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

  // Too common in company descriptions to say anything about fit.
  const GENERIC = new Set('management platform platforms software solution solutions service services system systems technology technologies digital data enterprise enterprises business businesses customer customers client clients product products offering offers provides provider providers vendor vendors developer develops company germany german europe european global international leading based market markets industry industries including also other multiple various range full suite cloud online web it tools tool specialist specialised specialized'.split(' '));
  const STOPWORDS = new Set('a an and or the of for in on to with by from at as is are be we our their its it this that b2b b2c company companies group holding bv nv ltd gmbh inc llc services solutions provider leading based international also own e.g. etc'.split(' '));
  // Removed when comparing names for duplicates: "x-tention Unternehmensgruppe" = "X-Tention GmbH".
  const LEGAL_WORDS = new Set('bv b.v nv n.v gmbh ag sa sas sarl srl spa ltd limited plc inc incorporated llc lp llp co kg ohg se ab as oy aps bvba vof cv holding holdings group groep gruppe unternehmensgruppe the de and'.split(' '));

  const DEFAULT_WEIGHTS = { sector: 30, keywords: 25, appetite: 15, geography: 10, size: 10, history: 5, role: 5 };
  const WEIGHT_LABELS = { sector: 'Sector', keywords: 'Keywords', appetite: 'M&A appetite', geography: 'Geography', size: 'Size fit', history: 'History with us', role: 'Buyer/target role' };

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
        let v = f.num ? parseNumber(raw, f.money ? unitMult : 1) : clean(raw);
        // Absolute amounts (e.g. Apollo's "Annual Revenue" 12500000) in a millions column.
        if (f.money && typeof v === 'number' && v > 100000 && unitMult === 1) v = v / 1e6;
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
    for (const ct of contacts) {
      if (!ct) continue;
      if (!ct.name && (ct.first || ct.last)) ct.name = [ct.first, ct.last].filter(Boolean).join(' ');
      delete ct.first; delete ct.last;
      if (ct.email_status) ct.email_status = lower(ct.email_status);
      if (ct.title && !ct.role_tag) ct.role_tag = inferRoleTag(ct.title);
    }
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

  // The registrable domain: "en.shop.acme.co.uk/de" -> "acme.co.uk". Sites like LinkedIn aren't a company's own website.
  const SLD = new Set('co.uk org.uk ac.uk com.au net.au co.nz com.br co.jp com.cn co.za com.sg com.tr co.in com.mx com.ar co.il com.hk com.tw co.kr com.my com.ph co.at or.at'.split(' '));
  const NOT_COMPANY = new Set('linkedin.com google.com facebook.com twitter.com x.com wikipedia.org crunchbase.com github.com github.io wordpress.com wixsite.com bloomberg.com youtube.com xing.com instagram.com'.split(' '));
  function rootDomain(url) {
    const h = domainOf(url);
    if (!h || !h.includes('.') || /^\d+(\.\d+){3}$/.test(h)) return '';
    const parts = h.split('.');
    const root = parts.slice(SLD.has(parts.slice(-2).join('.')) ? -3 : -2).join('.');
    return NOT_COMPANY.has(root) ? '' : root;
  }
  // "x-tention.com" and "x-tention.at" share the brand "x-tention".
  const brandOf = url => { const b = rootDomain(url).split('.')[0]; return b.length >= 4 ? b : ''; };
  const FREEMAIL = new Set('gmail.com googlemail.com outlook.com hotmail.com live.com yahoo.com icloud.com me.com gmx.de gmx.net web.de t-online.de proton.me protonmail.com aol.com msn.com'.split(' '));
  const emailDomains = c => [...new Set((c.contacts || []).map(x => String(x.email || '').split('@')[1]).filter(d => d && !FREEMAIL.has(d)).map(rootDomain).filter(Boolean))];

  // Lookup maps so duplicate checks stay fast with tens of thousands of companies.
  function buildIndex(list) {
    const idx = { byNorm: new Map(), byDomain: new Map(), byKey: new Map(), byFirst: new Map(), byBrand: new Map(), byMail: new Map() };
    list.forEach(c => indexAdd(idx, c));
    return idx;
  }
  const push = (m, k, c) => { if (!k) return; const a = m.get(k); if (a) { if (!a.includes(c)) a.push(c); } else m.set(k, [c]); };
  function indexAdd(idx, c) {
    const n = c._norm ?? normName(c.name);
    push(idx.byNorm, n, c);
    push(idx.byDomain, rootDomain(c.website), c);
    push(idx.byBrand, brandOf(c.website), c);
    emailDomains(c).forEach(d => push(idx.byMail, d, c));
    if (c.capiq_id) push(idx.byKey, 'ciq:' + lower(c.capiq_id), c);
    if (c.linkedin_url) push(idx.byKey, 'li:' + linkedinKey(c.linkedin_url), c);
    push(idx.byFirst, n.split(' ')[0], c);
  }

  // Exact: same main website domain, Capital IQ ID, LinkedIn page or cleaned name.
  // Possible: same brand on another country domain, contacts' email domain = the other's website, or one name starts the other.
  function findDuplicates(company, listOrIndex) {
    const idx = Array.isArray(listOrIndex) ? buildIndex(listOrIndex) : listOrIndex;
    const n = normName(company.name), d = rootDomain(company.website);
    const exact = new Set();
    for (const c of [...(idx.byNorm.get(n) || []), ...(d ? idx.byDomain.get(d) || [] : []),
      ...(company.capiq_id ? idx.byKey.get('ciq:' + lower(company.capiq_id)) || [] : []),
      ...(company.linkedin_url ? idx.byKey.get('li:' + linkedinKey(company.linkedin_url)) || [] : [])]) if (c !== company) exact.add(c);
    const possible = new Set();
    const add = c => { if (c !== company && !exact.has(c)) possible.add(c); };
    if (n.length >= 4) for (const c of idx.byFirst.get(n.split(' ')[0]) || []) {
      const cn = c._norm ?? normName(c.name);
      if (cn.length >= 4 && (cn.startsWith(n + ' ') || n.startsWith(cn + ' ') || n.replace(/ /g, '') === cn.replace(/ /g, ''))) add(c);
    }
    const b = brandOf(company.website);
    if (b) (idx.byBrand.get(b) || []).forEach(add);
    if (d) (idx.byMail.get(d) || []).forEach(add);
    for (const e of emailDomains(company)) (idx.byDomain.get(e) || []).forEach(add);
    return { exact: [...exact], possible: [...possible] };
  }

  // Why two records look like the same company (for the review screen).
  function duplicateReason(a, b) {
    const ra = rootDomain(a.website), rb = rootDomain(b.website);
    if (ra && ra === rb) return { certain: true, text: `Same website (${ra})` };
    if (a.linkedin_url && b.linkedin_url && linkedinKey(a.linkedin_url) === linkedinKey(b.linkedin_url)) return { certain: true, text: 'Same LinkedIn page' };
    if (a.capiq_id && b.capiq_id && lower(a.capiq_id) === lower(b.capiq_id)) return { certain: true, text: 'Same Capital IQ ID' };
    if (normName(a.name) === normName(b.name)) return { certain: true, text: 'Same name' };
    if (brandOf(a.website) && brandOf(a.website) === brandOf(b.website)) return { certain: false, text: `Same brand on another domain (${ra} / ${rb})` };
    if ((ra && emailDomains(b).includes(ra)) || (rb && emailDomains(a).includes(rb))) return { certain: false, text: `Contact emails at ${ra && emailDomains(b).includes(ra) ? ra : rb} (same company, or owner / parent?)` };
    return { certain: false, text: 'Similar name' };
  }

  // All duplicate groups in a list: certain groups (merge safely) and likely groups (check first).
  function duplicateGroups(list) {
    const idx = buildIndex(list);
    const parent = new Map(list.map(c => [c, c]));
    const find = c => { while (parent.get(c) !== c) { parent.set(c, parent.get(parent.get(c))); c = parent.get(c); } return c; };
    const union = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x); };
    const possibleLinks = [];
    for (const c of list) {
      const d = findDuplicates(c, idx);
      d.exact.forEach(x => union(c, x));
      d.possible.forEach(x => possibleLinks.push([c, x]));
    }
    const groupsOf = () => { const g = new Map(); for (const c of list) { const r = find(c); if (!g.has(r)) g.set(r, []); g.get(r).push(c); } return [...g.values()]; };
    const certain = groupsOf().filter(g => g.length > 1);
    const certainOf = new Map(list.map(c => [c, find(c)]));
    // Likely groups: link certain groups (or singles) through the possible links.
    const lp = new Map(list.map(c => [certainOf.get(c), certainOf.get(c)]));
    const lfind = c => { while (lp.get(c) !== c) c = lp.get(c); return c; };
    for (const [a, b] of possibleLinks) { const x = lfind(certainOf.get(a)), y = lfind(certainOf.get(b)); if (x !== y) lp.set(y, x); }
    const likelyMap = new Map();
    for (const c of list) { const r = lfind(certainOf.get(c)); if (!likelyMap.has(r)) likelyMap.set(r, []); likelyMap.get(r).push(c); }
    const likely = [...likelyMap.values()].filter(g => g.length > 1 && new Set(g.map(c => certainOf.get(c))).size > 1);
    const describe = g => ({ members: g, reasons: [...new Set(g.slice(1).map(x => duplicateReason(g[0], x).text))] });
    return { certain: certain.map(describe), likely: likely.map(describe) };
  }

  const isBlank = v => v === '' || v == null;
  // Values that look the same ignoring case and punctuation are not a conflict.
  const sameValue = (x, y) => typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : lower(String(x)).replace(/[^a-z0-9]/g, '') === lower(String(y)).replace(/[^a-z0-9]/g, '');
  const NO_ALT = new Set(['id', 'contacts', 'projects', 'sources', 'acquisitions', 'enrichment', '_norm', '_domain', 'alt', 'aliases', 'merged_from', 'merged_records', 'created', 'status', 'tags', 'extra', 'role']);
  // Keeps a conflicting value from another list instead of dropping it.
  function keepAlt(target, k, v) {
    if (NO_ALT.has(k) || isBlank(v) || isBlank(target[k]) || sameValue(target[k], v)) return;
    if (k === 'name') { target.aliases ??= []; if (!target.aliases.some(a => sameValue(a, v))) target.aliases.push(v); return; }
    if (k === 'website' && rootDomain(v) && rootDomain(v) === rootDomain(target[k])) return;
    target.alt ??= {};
    const list = (target.alt[k] ??= []);
    if (!list.some(x => sameValue(x, v))) list.push(v);
  }
  // Joins history text from two sources without repeating lines.
  const joinText = (a, b, sep) => { const parts = [...String(a || '').split(sep), ...String(b || '').split(sep)].map(s => s.trim()).filter(Boolean); return [...new Set(parts)].join(sep); };

  // Merges parsed row data into an existing company. Blank fields are filled; other values are kept as alternatives.
  function mergeInto(target, { company, contacts = [], project }, combine = false) {
    for (const [k, v] of Object.entries(company)) {
      if (isBlank(v)) continue;
      if (isBlank(target[k])) target[k] = v; else keepAlt(target, k, v);
    }
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
      if (p) mergeProjectEntry(p, project, combine);
      else target.projects.push({ ...project });
    }
    if (project?.source) {
      target.sources ??= [];
      if (!target.sources.includes(project.source)) target.sources.push(project.source);
    }
    target._norm = normName(target.name);
    target._domain = domainOf(target.website);
    return target;
  }

  // Same project from two sources. On import the newest upload wins for the status; when combining two
  // company records the furthest / most recent status wins. History text is always joined, never overwritten.
  function mergeProjectEntry(p, q, combine) {
    const takeQ = !combine || (isBlank(p.status) && !isBlank(q.status)) ||
      (!isBlank(q.status) && ((q.last_contact || '') > (p.last_contact || '') || (!(q.last_contact || p.last_contact) && stageIndex(q.status) > stageIndex(p.status))));
    for (const [k, v] of Object.entries(q)) {
      if (isBlank(v) || ['extra', 'log', 'remarks', 'rationale', 'pass_reason', 'source', 'dates', 'offer', 'offer_history'].includes(k)) continue;
      if (isBlank(p[k]) || (takeQ && ['status', 'last_contact', 'responsible', 'tier', 'wave'].includes(k))) p[k] = v;
    }
    if (q.furthest_stage && reachedIndex({ status: q.furthest_stage }) > reachedIndex(p)) p.furthest_stage = q.furthest_stage;
    p.log = joinText(q.log, p.log, '\n');
    p.remarks = joinText(p.remarks, q.remarks, ' | ');
    p.rationale = joinText(p.rationale, q.rationale, ' | ');
    p.pass_reason = joinText(p.pass_reason, q.pass_reason, ' | ');
    p.source = joinText(p.source, q.source, '; ');
    p.extra = { ...(q.extra || {}), ...(p.extra || {}) };
    if (q.dates) { p.dates ??= {}; for (const [k, v] of Object.entries(q.dates)) if (!p.dates[k] || v < p.dates[k]) p.dates[k] = v; }
    if (q.offer) { if (!p.offer) p.offer = q.offer; else if (p.offer !== q.offer) (p.offer_history ??= []).push(q.offer); }
    if (q.offer_history?.length) p.offer_history = [...(p.offer_history || []), ...q.offer_history];
    for (const k of ['log', 'remarks', 'rationale', 'pass_reason', 'source']) if (!p[k]) delete p[k];
  }

  // Merges company `b` into `a` without losing anything: conflicting values become alternatives, other names become
  // aliases, contacts and project history are combined, and `b` itself is kept in merged_records so it can be restored.
  function mergeCompanies(a, b) {
    const { _norm, _domain, ...snapshot } = b;
    mergeInto(a, { company: Object.fromEntries(Object.entries(b).filter(([k]) => !NO_ALT.has(k) || k === 'role')), contacts: b.contacts || [] }, true);
    keepAlt(a, 'name', b.name);
    for (const al of b.aliases || []) keepAlt(a, 'name', al);
    for (const [k, vals] of Object.entries(b.alt || {})) vals.forEach(v => (isBlank(a[k]) ? (a[k] = v) : keepAlt(a, k, v)));
    if (b.acquisitions?.length) {
      a.acquisitions ??= [];
      for (const q of b.acquisitions) if (!a.acquisitions.some(x => sameValue(x.target, q.target))) a.acquisitions.push(q);
    }
    if (b.enrichment && (!a.enrichment || (b.enrichment.at || '') > (a.enrichment.at || ''))) a.enrichment = b.enrichment;
    if (b.tags?.length) a.tags = [...new Set([...(a.tags || []), ...b.tags])];
    if (b.extra) a.extra = { ...b.extra, ...(a.extra || {}) };
    a.projects ??= [];
    for (const p of b.projects || []) {
      const mine = a.projects.find(x => x.project === p.project);
      if (mine) mergeProjectEntry(mine, p, true); else a.projects.push({ ...p });
    }
    a.sources = [...new Set([...(a.sources || []), ...(b.sources || [])])];
    a.merged_from = [...(a.merged_from || []), { id: b.id, name: b.name, website: b.website || '', at: new Date().toISOString() }];
    a.merged_records = [...(a.merged_records || []), JSON.parse(JSON.stringify(snapshot))];
    a._norm = normName(a.name);
    a._domain = domainOf(a.website);
    return a;
  }

  // Picks the record to keep: the one with the most information.
  function richness(c) {
    // Data counts, but the group's "headline" record should have a clean name ("ABBYY", not "ABBYY Europe GmbH")
    // and a plain website (not a country sub-page).
    const site = lower(c.website).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return (c.contacts || []).length * 2 + (c.projects || []).length * 3 + (c.website ? 3 : 0) + (c.enrichment ? 5 : 0)
      + Object.values(c).filter(v => typeof v === 'string' && v).length * 0.2
      - String(c.name || '').length * 0.15 - (/\/./.test(site) ? 4 : 0)
      - (/\b(europe|deutschland|germany|nederland|benelux|uk|france|gmbh|bv|ltd|inc|ag|sa|holding)\b/i.test(c.name || '') ? 3 : 0);
  }

  // ---------- Matching ----------
  const primaryContact = c => (c.contacts || []).find(x => x.email) || null;
  const hasEmail = c => !!primaryContact(c);

  const textOf = c => [c.short_description, c.summary, c.description, c.keywords, (c.tags || []).join(' '), c.subsector, c.sector, c.portfolio].join(' ').toLowerCase();
  function tokens(c) {
    return new Set(textOf(c).split(/[^a-z0-9à-ÿ]+/).filter(t => t.length > 2 && !STOPWORDS.has(t) && !GENERIC.has(t)));
  }

  const sameish = (a, b) => a && b && (a === b || a.includes(b) || b.includes(a));
  // "Input management / IDP" -> ["input management", "idp"]
  const segments = s => lower(s).split(/\s*[\/,;&|]\s*|\s+and\s+/).map(x => x.trim()).filter(x => x && !GENERIC.has(x));

  function sectorScore(deal, cand) {
    const ds = lower(deal.sector), cs = lower(cand.sector);
    const dSub = lower(deal.subsector), cSub = lower(cand.subsector);
    const candWants = splitList(cand.target_sectors), dealWants = splitList(deal.target_sectors);
    if (ds && candWants.some(w => sameish(w, ds) || sameish(w, dSub))) return [1, `Wants ${deal.sector}`];
    if (cs && dealWants.some(w => sameish(w, cs) || sameish(w, cSub))) return [1, `${cand.sector} is in deal focus`];
    if (ds && cs && ds === cs) return dSub && cSub && dSub === cSub ? [1, `Same sub-sector: ${cand.subsector}`] : [0.85, `Same sector: ${cand.sector}`];
    if (sameish(ds, cs) || (dSub && sameish(dSub, cSub))) return [0.6, `Related sector: ${cand.sector}`];
    const dSeg = segments(deal.sector + '/' + (deal.subsector || '')), cSeg = segments(cand.sector + '/' + (cand.subsector || ''));
    const segHit = dSeg.find(a => cSeg.some(b => a === b || (a.length > 4 && b.length > 4 && sameish(a, b))));
    if (segHit) return [0.75, `Same segment: ${segHit.toUpperCase().length <= 4 ? segHit.toUpperCase() : segHit}`];
    const dt = new Set(ds.split(/\W+/).filter(t => t.length > 3 && !GENERIC.has(t))), overlap = cs.split(/\W+/).filter(t => dt.has(t));
    if (overlap.length) return [0.35, `Sector overlap: ${overlap[0]}`];
    return [0, null];
  }

  // Deal keywords like "input management; document AI" matched as phrases in the buyer's texts.
  function phraseScore(deal, cand) {
    const phrases = [...new Set(splitList(deal.keywords).filter(p => p.length > 2 && !GENERIC.has(p)))];
    if (!phrases.length) return [0, []];
    const text = ' ' + textOf(cand).replace(/[^a-z0-9à-ÿ]+/g, ' ') + ' ';
    const hits = phrases.filter(p => text.includes(' ' + p.replace(/[^a-z0-9à-ÿ]+/g, ' ').trim() + ' '));
    return [Math.min(1, hits.length / Math.min(3, phrases.length)), hits];
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

  function keywordScore(dealTokens, cand, deal) {
    const [ps, hits] = phraseScore(deal, cand);
    const ct = tokens(cand);
    const shared = dealTokens.size && ct.size ? [...dealTokens].filter(t => ct.has(t)) : [];
    const sim = shared.length ? Math.min(1, (shared.length / Math.sqrt(dealTokens.size * ct.size)) * 2.5) : 0;
    if (hits.length && ps >= sim * 0.8) return [Math.max(ps, sim), `Matches: ${hits.slice(0, 4).join(', ')}`];
    if (!shared.length) return [0, null];
    return [sim * 0.8, `Keywords: ${shared.slice(0, 4).join(', ')}`];
  }

  const BUY_SIDE = new Set(['Buyer', 'Investor']);
  function roleScore(deal, cand) {
    if (!deal.role || !cand.role) return [0.5, null];
    if (deal.role === 'Target' && BUY_SIDE.has(cand.role)) return [1, `${cand.role} for a target`];
    if (BUY_SIDE.has(deal.role) && cand.role === 'Target') return [1, 'Potential target'];
    return [0, null];
  }

  // Sentences from your own lists that talk about acquisitions ("Serial acquirer: Integic, soffico, ICW…").
  const ACQ_WORDS = /acqui|acquir|bought|purchas|übernahm|übernimmt|übernahme|zukauf|overname|overgenomen|serial|buy[- ]and[- ]build|add-on|took over|takeover|merger|merged with|portfolio|platform investment|majority stake|stake in/i;
  function listAcquisitionNotes(c) {
    const sources = [['Description', c.description], ['Summary', c.summary], ['Notes', c.notes], ['Portfolio', c.portfolio], ...((c.alt?.description) || []).map(d => ['Other description', d])];
    for (const p of c.projects || []) {
      sources.push([`${p.project} remarks`, p.remarks], [`${p.project} log`, p.log], [`${p.project} rationale`, p.rationale]);
      for (const [k, v] of Object.entries(p.extra || {})) sources.push([`${p.project} – ${k}`, v]);
    }
    const out = [], seen = new Set();
    for (const [from, text] of sources) {
      for (const seg of String(text || '').split(/\n|\s\|\s|(?<=[.!?])\s+(?=[A-Z])/)) {
        const s = seg.replace(/^[^:]{0,40}:\s*(?=\S)/, m => (/remarks|comment|note/i.test(m) ? '' : m)).trim();
        if (s.length < 12 || !ACQ_WORDS.test(s)) continue;
        const key = s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text: s.length > 320 ? s.slice(0, 317) + '…' : s, from });
      }
    }
    return out;
  }

  // Serial acquirers and PE-backed platforms (add-on buyers) are more likely to buy.
  function appetiteScore(cand, deal) {
    const acq = (cand.acquisitions || []).length;
    const tags = (cand.tags || []).join(' ');
    const said = cand.acquisitive || cand.enrichment?.is_acquisitive;
    // Strongest signal: the buyer already bought something in the deal's space.
    const phrases = deal ? [...new Set([...splitList(deal.keywords), ...segments(deal.sector || '')].filter(p => p.length > 2 && !GENERIC.has(p)))] : [];
    if (phrases.length) {
      const hit = (cand.acquisitions || []).find(a => { const t = ' ' + lower([a.industry, a.description, a.target].join(' ')).replace(/[^a-z0-9à-ÿ]+/g, ' ') + ' '; return phrases.some(p => t.includes(' ' + p.replace(/[^a-z0-9à-ÿ]+/g, ' ').trim() + ' ')); });
      if (hit) return [1, `Bought ${hit.target}${hit.date || hit.year ? ` (${String(hit.date || hit.year).slice(0, 4)})` : ''}${hit.industry ? ': ' + hit.industry : ''}`];
    }
    if (acq >= 3 || said === 'yes' || /serial acquirer|acquisitive|buy-and-build|consolidator/.test(tags)) return [1, acq ? `${acq} acquisitions` : 'Acquisitive'];
    const notes = listAcquisitionNotes(cand);
    if (notes.some(n => /serial|acquisitive|buy[- ]and[- ]build|several acqui|multiple acqui/i.test(n.text))) return [0.9, 'Acquisitive (per your lists)'];
    if (notes.length) return [0.65, 'Acquisitions noted in your lists'];
    if (acq >= 1 || said === 'some') return [0.7, `${acq || 'Some'} acquisition${acq === 1 ? '' : 's'}`];
    if (ownershipType(cand.ownership) === 'PE-backed') return [0.6, 'PE-backed (add-on buyer)'];
    if (cand.role === 'Investor') return [0.6, null];
    return [0.2, null];
  }

  // How seriously this buyer engaged in our earlier projects ("historical seriousness").
  function historyScore(cand, deal) {
    const others = (cand.projects || []).filter(p => p.project && p.project !== deal.project);
    if (!others.length) return [0.4, null];
    const best = others.reduce((a, p) => (reachedIndex(p) > reachedIndex(a) ? p : a), others[0]);
    const r = reachedIndex(best);
    if (r >= BOARD_STAGES.indexOf('IOI received')) return [1, `Reached ${BOARD_STAGES[r]} in ${best.project}`];
    if (r >= BOARD_STAGES.indexOf('NDA signed')) return [0.85, `Signed NDA in ${best.project}`];
    const passed = others.find(p => stageGroup(p.status) === 'Passed');
    if (passed) return [0.3, `Passed in ${passed.project}${passed.pass_reason ? ` (${passed.pass_reason.slice(0, 30)})` : ''}`];
    return [0.55, `Known from ${others[0].project}`];
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
          keywords: keywordScore(dealTokens, c, deal),
          role: roleScore(deal, c),
          appetite: appetiteScore(c, deal),
          history: historyScore(c, deal),
        };
        let sum = 0;
        for (const [k, [v]] of Object.entries(parts)) sum += v * Number(weights[k] || 0);
        // Without any business fit, geography or appetite alone shouldn't make a good match.
        if (parts.sector[0] === 0 && parts.keywords[0] < 0.2) sum *= 0.4;
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
    COMPANY_FIELDS, CONTACT_FIELDS, PROJECT_FIELDS, STAGE_GROUPS, stageGroup, BOARD_STAGES, DATE_KEYS, boardStage, stageIndex, reachedIndex, PASS_REASONS, inferRoleTag, OUTREACH_PRIORITY, bestContacts, ownershipType, TARGET_OPTIONS, MAX_CONTACTS, STATUSES, DEFAULT_WEIGHTS, WEIGHT_LABELS, SKIP_SHEETS,
    headerKey, guessTarget, mapHeaders, detectHeaderRow, detectUnit, detectCurrency, guessRoleFromSheet, guessProject, parseRow, parseNumber, parseDate,
    listAcquisitionNotes, normName, domainOf, rootDomain, brandOf, cleanUrl, linkedinKey, personKey, buildIndex, indexAdd, findDuplicates, duplicateReason, duplicateGroups, richness, mergeInto, mergeCompanies, primaryContact, hasEmail, match, render, fmt, regionOf, normaliseRole,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
