// Industry › sector › sub-sector › niche taxonomy for software M&A. Broad labels like "Application Software" say nothing
// about fit, so every company (and every acquisition) is classified into niches from its texts, using the synonyms
// below; the three levels above a niche follow from it. Companies outside software (an insurer, a consultancy) are
// placed at industry › sector level, from research, by hand, or from their Capital IQ industry label.
const Taxonomy = (() => {
  // Technology: [sector, sub-sector] — every sub-sector used in T below must be listed here.
  const TECH = [
    ['Horizontal software', ['ERP & finance', 'CRM, marketing & CX', 'Data, analytics & AI', 'Business process & automation', 'Content, documents & collaboration', 'HR & workforce', 'Engineering, manufacturing & supply chain']],
    ['Infrastructure & security software', ['Cybersecurity', 'IT management & DevOps', 'Cloud & hosting']],
    ['Vertical software', ['Healthcare & life sciences software', 'Financial services software', 'Legal & professional services software', 'Public sector & education software', 'Real estate & construction software', 'Retail, hospitality & leisure software', 'Energy & utilities software', 'Transport & mobility software', 'Media & telecom software']],
    ['Software groups', ['Serial acquirers & software holdings', 'Large platforms & hyperscalers']],
    ['IT services', ['IT consulting & integration', 'BPO & outsourcing', 'IT distribution & resale']],
    ['Internet & digital platforms', ['Marketplaces & online platforms']],
    ['Hardware & semiconductors', ['Semiconductors', 'Devices, electronics & IoT', 'Communications equipment']],
  ];
  // Other industries: [industry, [sectors]]. Used for buyers outside software and as end markets of vertical software.
  const OTHER = [
    ['Financial Services', ['Banks & specialty finance', 'Insurance & brokers', 'Asset & wealth management', 'Private equity & venture capital', 'Exchanges & financial data', 'Diversified holdings']],
    ['Business Services', ['Professional services', 'Marketing & communications', 'Staffing & HR services', 'Information & records management', 'Support & facility services']],
    ['Healthcare & Life Sciences', ['Care providers', 'Pharma & biotech', 'Medtech & life science tools']],
    ['Industrials & Manufacturing', ['Machinery & automation', 'Electrical & electronic equipment', 'Aerospace & defence', 'Automotive', 'Chemicals & materials', 'Distribution & trading', 'Industrial conglomerates']],
    ['Construction & Real Estate', ['Construction & engineering', 'Building products', 'Real estate']],
    ['Energy & Utilities', ['Utilities', 'Oil, gas & renewables']],
    ['Transport & Logistics', ['Logistics & freight', 'Passenger transport']],
    ['Consumer & Retail', ['Retail', 'Hospitality & leisure', 'Consumer goods & food']],
    ['Media & Telecom', ['Telecom operators', 'Media & entertainment', 'Gaming']],
    ['Public Sector & Education', ['Government', 'Education']],
  ];
  // [sub-sector, niche, synonyms]. Synonyms are lower-case phrases matched on word boundaries; keep them specific.
  const T = [
    ['Business process & automation', 'Process mining & intelligence', ['process mining', 'process intelligence', 'task mining', 'process discovery', 'process analytics', 'event log', 'object-centric process', 'process excellence', 'process performance management', 'execution management']],
    ['Business process & automation', 'BPM & workflow', ['business process management', 'bpm', 'bpmn', 'workflow automation', 'workflow management', 'process automation', 'process modeling', 'process modelling', 'process management software', 'case management', 'digital process automation']],
    ['Business process & automation', 'RPA & intelligent automation', ['robotic process automation', 'rpa', 'intelligent automation', 'hyperautomation', 'software robots', 'agentic automation']],
    ['Business process & automation', 'Low-code / no-code', ['low-code', 'low code', 'no-code', 'no code', 'citizen developer', 'application development platform', 'rapid application development']],
    ['Business process & automation', 'Intelligent document processing', ['intelligent document processing', 'idp', 'document capture', 'ocr', 'data capture', 'input management', 'document understanding', 'document automation']],
    ['Business process & automation', 'Enterprise architecture', ['enterprise architecture', 'application portfolio management', 'business architecture', 'it architecture management', 'strategic portfolio management']],
    ['Business process & automation', 'Integration & iPaaS', ['ipaas', 'integration platform', 'api management', 'middleware', 'b2b integration', 'edi', 'enterprise service bus', 'application integration']],
    ['Data, analytics & AI', 'BI & analytics', ['business intelligence', 'bi platform', 'bi tools', 'self-service analytics', 'data visualization', 'data visualisation', 'dashboards', 'reporting software', 'embedded analytics', 'analytics platform', 'analytics automation', 'data analytics', 'financial information']],
    ['Data, analytics & AI', 'Data management & integration', ['data integration', 'etl', 'data quality', 'master data', 'mdm', 'data governance', 'data catalog', 'data warehouse', 'data pipeline', 'data lake', 'data preparation', 'data virtualization', 'sap data']],
    ['Data, analytics & AI', 'AI & machine learning', ['machine learning', 'artificial intelligence', 'ai platform', 'mlops', 'computer vision', 'natural language processing', 'nlp', 'generative ai', 'large language model', 'ai agents', 'ai platforms', 'machine translation', 'language ai', 'document ai', 'agentic ai']],
    ['Data, analytics & AI', 'Performance management (CPM/EPM)', ['corporate performance management', 'cpm', 'epm', 'enterprise performance management', 'financial planning', 'fp&a', 'budgeting', 'planning and forecasting', 'financial consolidation', 'xp&a']],
    ['Data, analytics & AI', 'Market & web data', ['web analytics', 'digital analytics', 'market intelligence', 'web data', 'competitive intelligence', 'consumer insights', 'survey software', 'experience management']],
    ['ERP & finance', 'ERP', ['erp', 'enterprise resource planning']],
    ['ERP & finance', 'Accounting & finance software', ['accounting software', 'bookkeeping', 'accounts payable', 'accounts receivable', 'e-invoicing', 'invoice processing', 'expense management', 'treasury management', 'financial close', 'billing software']],
    ['ERP & finance', 'Procurement & spend management', ['procurement', 'spend management', 'purchase-to-pay', 'source-to-pay', 'e-procurement', 'supplier management', 'sourcing software']],
    ['ERP & finance', 'Tax & compliance reporting', ['tax software', 'tax compliance', 'vat compliance', 'regulatory reporting', 'xbrl', 'esg reporting']],
    ['CRM, marketing & CX', 'CRM & sales', ['crm', 'customer relationship management', 'sales automation', 'cpq', 'sales enablement', 'sales intelligence', 'revenue intelligence']],
    ['CRM, marketing & CX', 'Marketing automation & martech', ['marketing automation', 'email marketing', 'martech', 'marketing technology', 'campaign management', 'loyalty', 'personalisation', 'personalization', 'social media management']],
    ['CRM, marketing & CX', 'Customer data & identity', ['customer data platform', 'cdp', 'identity resolution', 'first-party data', 'consent management', 'customer identity']],
    ['CRM, marketing & CX', 'Digital experience & CMS', ['content management system', 'cms', 'digital experience platform', 'dxp', 'web content management', 'headless cms', 'website builder']],
    ['CRM, marketing & CX', 'Customer service & contact centre', ['contact center', 'contact centre', 'ccaas', 'customer service software', 'helpdesk', 'help desk software', 'conversational ai', 'chatbot', 'customer engagement platform']],
    ['CRM, marketing & CX', 'E-commerce', ['e-commerce', 'ecommerce', 'webshop', 'online shop', 'commerce platform', 'product information management', 'pim', 'marketplace software', 'digital commerce', 'headless commerce']],
    ['CRM, marketing & CX', 'Adtech', ['adtech', 'advertising technology', 'programmatic', 'ad server', 'demand-side platform', 'supply-side platform', 'retail media']],
    ['IT management & DevOps', 'IT service management', ['it service management', 'itsm', 'service desk', 'itom', 'it asset management', 'itam', 'enterprise service management', 'endpoint management', 'saas management', 'servicenow']],
    ['IT management & DevOps', 'Observability & monitoring', ['observability', 'application performance monitoring', 'apm', 'log management', 'infrastructure monitoring', 'network monitoring']],
    ['IT management & DevOps', 'DevOps & developer tools', ['devops', 'ci/cd', 'developer tools', 'version control', 'test automation', 'software testing', 'code quality', 'api testing']],
    ['Cloud & hosting', 'Cloud & hosting', ['web hosting', 'cloud hosting', 'managed hosting', 'cloud infrastructure', 'data centre', 'data center', 'domain names', 'iaas', 'sovereign cloud', 'cloud provider', 'gpu cloud', 'ai infrastructure', 'object storage', 'storage software', 'edge computing', 'hyperconverged']],
    ['IT management & DevOps', 'Workload automation & output', ['workload automation', 'job scheduling', 'output management', 'mainframe']],
    ['Cybersecurity', 'Identity & access management', ['identity and access management', 'iam', 'authentication', 'single sign-on', 'privileged access', 'identity governance', 'multi-factor authentication']],
    ['Cybersecurity', 'Security software', ['cybersecurity', 'cyber security', 'endpoint security', 'email security', 'network security', 'threat detection', 'siem', 'security operations', 'vulnerability management', 'data security', 'zero trust', 'encryption', 'end-to-end encryption', 'digital rights management', 'drm', 'anti-fraud', 'fraud detection']],
    ['Cybersecurity', 'GRC & compliance', ['governance, risk', 'grc', 'risk management software', 'compliance management', 'audit management', 'whistleblowing', 'regtech', 'internal control', 'policy management']],
    ['Content, documents & collaboration', 'Document & content management', ['document management', 'dms', 'enterprise content management', 'ecm', 'archiving', 'records management', 'content services']],
    ['Content, documents & collaboration', 'Customer communications (CCM)', ['customer communications management', 'ccm', 'document generation', 'omnichannel communication', 'output and print']],
    ['Content, documents & collaboration', 'Collaboration & work management', ['collaboration software', 'intranet', 'employee communication', 'project management software', 'work management', 'knowledge management', 'portfolio management software']],
    ['Content, documents & collaboration', 'E-signature & digital trust', ['electronic signature', 'e-signature', 'digital signature', 'trust services', 'qualified signature']],
    ['HR & workforce', 'HR & payroll', ['hr software', 'human resources software', 'hcm', 'human capital management', 'payroll', 'recruiting software', 'applicant tracking', 'talent management', 'learning management', 'lms']],
    ['HR & workforce', 'Workforce management', ['workforce management', 'shift planning', 'rostering', 'time and attendance', 'time tracking', 'personnel scheduling']],
    ['Engineering, manufacturing & supply chain', 'PLM, CAD & simulation', ['product lifecycle management', 'plm', 'cad', 'cae', 'engineering simulation', 'computer-aided design', 'pdm']],
    ['Engineering, manufacturing & supply chain', 'Manufacturing (MES / IIoT)', ['manufacturing execution', 'mes', 'industrial iot', 'iiot', 'shop floor', 'industry 4.0', 'scada', 'production planning', 'advanced planning and scheduling', 'quality management system']],
    ['Engineering, manufacturing & supply chain', 'Supply chain & logistics', ['supply chain', 'logistics software', 'warehouse management', 'wms', 'transport management', 'tms', 'fleet management', 'route optimization', 'route optimisation', 'freight']],
    ['Engineering, manufacturing & supply chain', 'Field service & asset management', ['field service', 'enterprise asset management', 'eam', 'cmms', 'maintenance management', 'asset performance management']],
    ['Real estate & construction software', 'Construction & AEC', ['construction software', 'bim', 'building information modeling', 'architecture, engineering', 'aec']],
    ['Energy & utilities software', 'Energy & utilities software', ['energy management', 'utilities software', 'utility billing', 'smart grid', 'renewable energy', 'energy trading', 'meter data']],
    ['Healthcare & life sciences software', 'Healthcare software', ['healthcare software', 'hospital information', 'electronic health record', 'ehr', 'emr', 'clinical software', 'medical software', 'pharmacy software', 'care management', 'healthtech']],
    ['Financial services software', 'Insurance software', ['insurance software', 'insurtech', 'policy administration', 'claims management', 'insurers']],
    ['Financial services software', 'Banking & fintech software', ['banking software', 'core banking', 'fintech', 'payments', 'lending software', 'wealth management', 'capital markets', 'payment processing']],
    ['Legal & professional services software', 'Legal software', ['legal software', 'law firm', 'legal tech', 'legaltech', 'contract lifecycle management', 'practice management']],
    ['Public sector & education software', 'Public sector & govtech', ['public sector', 'govtech', 'e-government', 'municipalities', 'local government', 'public administration']],
    ['Real estate & construction software', 'Real estate & property', ['real estate software', 'property management', 'proptech', 'facility management', 'housing associations']],
    ['Public sector & education software', 'Education software', ['edtech', 'education software', 'school management', 'student information', 'e-learning']],
    ['Retail, hospitality & leisure software', 'Retail & hospitality software', ['retail software', 'point of sale', 'pos software', 'hospitality software', 'hotel software', 'restaurant software', 'property management system']],
    ['Transport & mobility software', 'Automotive & mobility software', ['automotive software', 'dealer management', 'mobility software', 'embedded automotive']],
    ['Media & telecom software', 'Telecom software', ['telecom software', 'telco', 'oss/bss', 'bss', 'network operators', 'mobile operators']],
    ['Media & telecom software', 'Media & publishing software', ['publishing software', 'newsroom', 'broadcast software', 'media asset management', 'digital asset management']],
    ['Serial acquirers & software holdings', 'Software holdings & serial acquirers', ['vertical market software', 'vertical-market software', 'serial acquirer', 'serial acquirers', 'acquires and grows', 'software holding', 'software group buying', 'buy-and-build platform', 'decentralised software group', 'permanent owner of software']],
    ['Large platforms & hyperscalers', 'Large platform & hyperscalers', ['hyperscaler', 'hyperscalers', 'cloud and ai', 'global technology company', 'technology conglomerate']],
    ['IT consulting & integration', 'IT services & consulting', ['it services', 'it consulting', 'system integrator', 'systems integration', 'managed services', 'digital transformation consultancy', 'implementation partner', 'it outsourcing', 'consultancy']],
    ['BPO & outsourcing', 'BPO & outsourcing', ['business process outsourcing', 'bpo', 'outsourcing services', 'shared services']],
  ];
  // Sub-sector -> its sector (Technology); sector -> industry.
  const SUB = new Map(TECH.flatMap(([sector, subs]) => subs.map(s => [s, { industry: 'Technology', sector, subsector: s }])));
  const SECTOR = new Map([...TECH.map(([s]) => [s, 'Technology']), ...OTHER.flatMap(([ind, secs]) => secs.map(s => [s, ind]))]);
  // `industry` on a niche is its sub-sector (the level right above it, as before); the full path is in sector / top.
  const NICHES = T.map(([subsector, niche, syn], i) => ({ id: i, industry: subsector, subsector, sector: SUB.get(subsector)?.sector || '', top: 'Technology', niche, syn: [niche.toLowerCase(), ...syn] }));
  const INDUSTRIES = ['Technology', ...OTHER.map(o => o[0])];
  const byNiche = new Map(NICHES.map(n => [n.niche.toLowerCase(), n]));
  // The four levels as a tree, for cascading Industry → Sector → Sub-sector → Niche selects.
  const TREE = [
    { industry: 'Technology', sectors: TECH.map(([sector, subs]) => ({ sector, subsectors: subs.map(s => ({ subsector: s, niches: NICHES.filter(n => n.subsector === s).map(n => n.niche) })) })) },
    ...OTHER.map(([industry, secs]) => ({ industry, sectors: secs.map(sector => ({ sector, subsectors: [] })) })),
  ];
  const path = (industry = '', sector = '', subsector = '', niche = '') => ({ industry, sector, subsector, niche });
  // Full path of a niche, a sub-sector or a sector name (whichever it is).
  function pathOf(name) {
    const k = String(name || '').trim();
    if (!k) return null;
    const n = byNiche.get(k.toLowerCase());
    if (n) return path('Technology', n.sector, n.subsector, n.niche);
    const s = SUB.get(k);
    if (s) return path(s.industry, s.sector, s.subsector);
    if (SECTOR.has(k)) return path(SECTOR.get(k), k);
    if (INDUSTRIES.includes(k)) return path(k);
    return null;
  }
  // Capital IQ / GICS industry labels and free-text sector labels -> industry › sector (› sub-sector). "Application
  // Software" only says Technology: the sector follows from the niche, never from that label.
  const LABELS = [
    [/private equity|venture capital|growth equity|buyout|family office|investment (firm|company|holding)|search fund/i, 'Financial Services', 'Private equity & venture capital'],
    [/^application software$|^software$|^software (&|and) services$|^saas$|^enterprise software$|^b2b software$|^technology$|^information technology$/i, 'Technology', ''],
    [/^systems software$/i, 'Technology', 'Infrastructure & security software'],
    [/it consulting|it services|system integrat|managed services|consultancy.*(it|digital|tech)/i, 'Technology', 'IT services', 'IT consulting & integration'],
    [/data processing and outsourced|business process outsourcing|\bbpo\b/i, 'Technology', 'IT services', 'BPO & outsourcing'],
    [/internet services and infrastructure|hosting|data cent(er|re)/i, 'Technology', 'Infrastructure & security software', 'Cloud & hosting'],
    [/health ?care technology/i, 'Technology', 'Vertical software', 'Healthcare & life sciences software'],
    [/technology distributors|it distribut|value.added resell/i, 'Technology', 'IT services', 'IT distribution & resale'],
    [/^semiconductor/i, 'Technology', 'Hardware & semiconductors', 'Semiconductors'],
    [/communications equipment/i, 'Technology', 'Hardware & semiconductors', 'Communications equipment'],
    [/technology hardware|electronic (equipment|components|manufacturing)|electronic instruments|consumer electronics/i, 'Technology', 'Hardware & semiconductors', 'Devices, electronics & IoT'],
    [/interactive media|internet (&|and) direct marketing|online (marketplace|platform)|marketplace/i, 'Technology', 'Internet & digital platforms', 'Marketplaces & online platforms'],
    [/interactive home entertainment|casinos|gaming/i, 'Media & Telecom', 'Gaming'],
    [/asset management|custody banks|wealth management/i, 'Financial Services', 'Asset & wealth management'],
    [/financial exchanges|financial data|credit rating/i, 'Financial Services', 'Exchanges & financial data'],
    [/insurance|reinsurance/i, 'Financial Services', 'Insurance & brokers'],
    [/banks?\b|banking|consumer finance|specialized finance|investment banking|brokerage|transaction (&|and) payment|mortgage|thrifts/i, 'Financial Services', 'Banks & specialty finance'],
    [/multi.sector holdings|diversified (financial|holding)|conglomerate.*holding/i, 'Financial Services', 'Diversified holdings'],
    [/research and consulting|consulting services|professional services|accounting|legal services|law firm/i, 'Business Services', 'Professional services'],
    [/advertising|marketing services|media agenc|public relations/i, 'Business Services', 'Marketing & communications'],
    [/human resource|employment services|staffing|recruitment/i, 'Business Services', 'Staffing & HR services'],
    [/records management|document (storage|services)|information management services/i, 'Business Services', 'Information & records management'],
    [/diversified support|office services|security and alarm|environmental and facilities|facility services|commercial printing/i, 'Business Services', 'Support & facility services'],
    [/health ?care (services|facilities|providers)|managed health care|hospital/i, 'Healthcare & Life Sciences', 'Care providers'],
    [/pharmaceutical|biotechnology/i, 'Healthcare & Life Sciences', 'Pharma & biotech'],
    [/health ?care (equipment|supplies|distributors)|life sciences tools|medical devices|medtech/i, 'Healthcare & Life Sciences', 'Medtech & life science tools'],
    [/aerospace|defen[cs]e/i, 'Industrials & Manufacturing', 'Aerospace & defence'],
    [/automotive|auto parts|automobile|motorcycle|tires/i, 'Industrials & Manufacturing', 'Automotive'],
    [/gold|silver|precious metals|forest products|containers|rubber/i, 'Industrials & Manufacturing', 'Chemicals & materials'],
    [/textiles|footwear|home furnishings|agricultural products/i, 'Consumer & Retail', 'Consumer goods & food'],
    [/airport services/i, 'Transport & Logistics', 'Passenger transport'],
    [/software consolidator|serial acquirer/i, 'Technology', 'Software groups', 'Serial acquirers & software holdings'],
    [/industrial machinery|construction machinery|heavy transportation equipment|agricultural.*machinery|machinery/i, 'Industrials & Manufacturing', 'Machinery & automation'],
    [/electrical (components|equipment)|heavy electrical/i, 'Industrials & Manufacturing', 'Electrical & electronic equipment'],
    [/chemicals|metals|mining|steel|paper|packaging|materials/i, 'Industrials & Manufacturing', 'Chemicals & materials'],
    [/trading companies|distributors/i, 'Industrials & Manufacturing', 'Distribution & trading'],
    [/industrial conglomerates/i, 'Industrials & Manufacturing', 'Industrial conglomerates'],
    [/construction (and|&) engineering|construction & engineering|homebuilding/i, 'Construction & Real Estate', 'Construction & engineering'],
    [/building products|construction materials/i, 'Construction & Real Estate', 'Building products'],
    [/real estate|reit/i, 'Construction & Real Estate', 'Real estate'],
    [/utilities|electric utilit|water utilit|gas utilit|renewable electricity|power producers/i, 'Energy & Utilities', 'Utilities'],
    [/oil|gas|energy equipment|coal/i, 'Energy & Utilities', 'Oil, gas & renewables'],
    [/air freight|logistics|trucking|marine|shipping|railroads|freight/i, 'Transport & Logistics', 'Logistics & freight'],
    [/passenger|airlines|ground transportation|transit/i, 'Transport & Logistics', 'Passenger transport'],
    [/retail|department stores/i, 'Consumer & Retail', 'Retail'],
    [/hotels|resorts|cruise|restaurants|leisure (facilities|products)|specialized consumer services/i, 'Consumer & Retail', 'Hospitality & leisure'],
    [/foods?\b|beverages|brewers|household|personal (care )?products|apparel|tobacco|consumer goods/i, 'Consumer & Retail', 'Consumer goods & food'],
    [/telecommunication|telecom|alternative carriers|wireless/i, 'Media & Telecom', 'Telecom operators'],
    [/movies|entertainment|publishing|broadcasting|cable|media/i, 'Media & Telecom', 'Media & entertainment'],
    [/education services|education/i, 'Public Sector & Education', 'Education'],
    [/government|public administration/i, 'Public Sector & Education', 'Government'],
  ];
  function fromLabel(label) {
    const s = String(label || '').trim();
    if (!s) return null;
    const direct = pathOf(s);
    if (direct) return direct;
    const r = LABELS.find(([re]) => re.test(s));
    return r ? path(r[1], r[2] || '', r[3] || '') : null;
  }
  // Where a company sits: what you or research set (cls_*), else investor -> private equity, else its niche,
  // else its industry label. Returns {industry, sector, subsector, niche, src} or null.
  const FIN_TYPES = new Set(['buyout', 'growth', 'vc', 'family_office', 'search_fund', 'corporate_vc']);
  const pathCache = new WeakMap();
  function pathOfCompany(c) {
    if (!c || typeof c !== 'object') return null;
    const sig = [c.cls_industry, c.cls_sector, c.cls_subsector, c.cls_src, c.role, c.investor_type, c.niche, c.sector, c.subsector].join('|');
    const hit = pathCache.get(c);
    if (hit && hit.sig === sig) return hit.v;
    const v = pathOfCompanyUncached(c);
    pathCache.set(c, { sig, v });
    return v;
  }
  function pathOfCompanyUncached(c) {
    if (c.cls_industry) return { ...path(c.cls_industry, c.cls_sector || '', c.cls_subsector || '', c.niche && pathOf(c.niche)?.subsector === c.cls_subsector ? c.niche : ''), src: c.cls_src || 'set' };
    if (c.role === 'Investor' || FIN_TYPES.has(c.investor_type)) return { ...path('Financial Services', 'Private equity & venture capital'), src: 'type' };
    if (c.niche) { const p = pathOf(c.niche); if (p) return { ...p, src: 'niche' }; }
    const l = fromLabel(c.sector) || fromLabel(c.subsector);
    return l ? { ...l, src: 'label' } : null;
  }
  // End markets: the industries a vertical (or industry-flavoured) sub-sector sells into. A company in that industry
  // that buys software (a construction group buying construction software) is a natural buyer.
  const END = {
    'Healthcare & life sciences software': [['Healthcare & Life Sciences']],
    'Financial services software': [['Financial Services', 'Banks & specialty finance'], ['Financial Services', 'Insurance & brokers'], ['Financial Services', 'Asset & wealth management'], ['Financial Services', 'Exchanges & financial data']],
    'Legal & professional services software': [['Business Services', 'Professional services']],
    'Public sector & education software': [['Public Sector & Education']],
    'Real estate & construction software': [['Construction & Real Estate']],
    'Retail, hospitality & leisure software': [['Consumer & Retail']],
    'Energy & utilities software': [['Energy & Utilities']],
    'Transport & mobility software': [['Transport & Logistics'], ['Industrials & Manufacturing', 'Automotive']],
    'Media & telecom software': [['Media & Telecom']],
    'Engineering, manufacturing & supply chain': [['Industrials & Manufacturing'], ['Transport & Logistics', 'Logistics & freight']],
    'HR & workforce': [['Business Services', 'Staffing & HR services']],
    'CRM, marketing & CX': [['Business Services', 'Marketing & communications']],
    'Data, analytics & AI': [['Financial Services', 'Exchanges & financial data']],
    'Content, documents & collaboration': [['Business Services', 'Information & records management']],
  };
  // Does a buyer at path `b` sell to / operate in the end market of sub-sector `subsector`? Returns a label or ''.
  function endMarket(subsector, b) {
    if (!b) return '';
    const hit = (END[subsector] || []).find(([ind, sec]) => b.industry === ind && (!sec || b.sector === sec));
    return hit ? hit.filter(Boolean).join(' › ') : '';
  }
  // S&P / generic labels that must never be read as a real industry.
  const GENERIC_SECTORS = /^(application software|systems software|software|software & services|software and services|it consulting and other services|internet services and infrastructure|internet software|technology|information technology|it|saas|enterprise software|b2b software|other)$/i;
  const isGeneric = s => !s || GENERIC_SECTORS.test(String(s).trim());

  // Phrase lookup on words: text and synonyms are both reduced to plain words ("process-mining" = "process mining",
  // "fp&a" = "fp a"), then every 1–5 word sequence of the text is looked up. Fast enough for 15,000+ companies.
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim().split(' ').filter(Boolean);
  const PHRASE = new Map();
  let MAXN = 1;
  NICHES.forEach(n => n.syn.forEach(s => { const w = words(s); if (!w.length) return; MAXN = Math.max(MAXN, w.length); const k = w.join(' '); if (!PHRASE.has(k)) PHRASE.set(k, []); if (!PHRASE.get(k).includes(n.id)) PHRASE.get(k).push(n.id); }));
  // Scores niches in weighted text parts: [[text, weight], ...]. Returns [{niche, industry, score, hits}] best first.
  function score(parts) {
    const acc = new Map();
    for (const [text, w] of parts) {
      const t = words(text);
      if (!t.length) continue;
      const seen = new Map();
      for (let i = 0; i < t.length; i++) {
        let k = '';
        for (let n = 0; n < MAXN && i + n < t.length; n++) {
          k = n ? k + ' ' + t[i + n] : t[i];
          const ids = PHRASE.get(k);
          if (!ids) continue;
          for (const id of ids) {
            const c = (seen.get(id) || 0) + 1;
            seen.set(id, c);
            if (c > 3) continue; // a word repeated ten times in one text doesn't make it ten times more relevant
            const a = acc.get(id) || { score: 0, hits: new Set() };
            a.score += w; a.hits.add(k); acc.set(id, a);
          }
        }
      }
    }
    return [...acc].map(([id, a]) => ({ niche: NICHES[id].niche, industry: NICHES[id].industry, score: a.score, hits: [...a.hits] })).sort((a, b) => b.score - a.score);
  }
  // A company's niches: subsector, tags and keywords weigh most, then the short description, then long texts.
  function classify(c) {
    const set = c.niche && !c.niche_auto ? [{ niche: c.niche, industry: byNiche.get(c.niche.toLowerCase())?.industry || c.industry || '', score: 99, hits: [] }] : [];
    const s = score([
      [c.subsector, 5],
      [[isGeneric(c.sector) ? '' : c.sector, (c.tags || []).join(' ; '), c.keywords].join(' ; '), 3],
      [c.short_description, 2],
      [[String(c.description || '').slice(0, 1200), String(c.summary || '').slice(0, 1200)].join(' '), 1],
    ]);
    // The main niche may rest on one mention if nothing competes with it; further niches need real evidence.
    const keep = s.filter((x, i) => !set.some(y => y.niche === x.niche) && (x.score >= 2 || (i === 0 && (s[1]?.score || 0) < x.score)));
    return [...set, ...keep].slice(0, 4);
  }
  // Niche of one acquisition (from its industry, tags and description).
  // Classifying ~50,000 deals is the slow part of a first buyer search, so the result is stored on the deal itself
  // (a.niche, '' = none; a.nv = taxonomy version) and only the start of long deal texts is read.
  const VERSION = 3; // raise when synonyms change, so stored deal niches are re-derived
  // One shared result object per niche (ofDeal is called for every deal in every buyer search).
  const byName = new Map(NICHES.map(n => [n.niche, Object.freeze({ niche: n.niche, industry: n.industry, score: 2, hits: [] })]));
  const head = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
  function ofDeal(a) {
    if (!a || typeof a !== 'object') return null;
    if (a.nv === VERSION && typeof a.niche === 'string') return byName.get(a.niche) || null;
    const v = score([[[a.industry, Array.isArray(a.tags) ? a.tags.join(' ; ') : a.tags].join(' ; '), 2], [[head(a.description, 400), head(a.why, 300), a.target].join(' '), 1]]).find(x => x.score >= 2) || null;
    a.niche = v ? v.niche : ''; a.nv = VERSION;
    return v;
  }
  // Synonyms of a niche, for phrase matching ("process intelligence" should hit "process mining").
  const synonyms = niche => byNiche.get(String(niche).toLowerCase())?.syn.filter(s => s.length > 3) || [];
  const list = () => NICHES.map(n => ({ industry: n.industry, subsector: n.subsector, sector: n.sector, niche: n.niche }));
  // Niches whose buyers often buy each other's companies, also across industries.
  const ADJ = [
    ['Process mining & intelligence', 'BPM & workflow', 'RPA & intelligent automation', 'Enterprise architecture', 'BI & analytics', 'Data management & integration', 'IT service management', 'Low-code / no-code'],
    ['BPM & workflow', 'Low-code / no-code', 'RPA & intelligent automation', 'Intelligent document processing', 'Document & content management', 'Enterprise architecture', 'GRC & compliance'],
    ['Intelligent document processing', 'Document & content management', 'Customer communications (CCM)', 'RPA & intelligent automation', 'E-signature & digital trust'],
    ['BI & analytics', 'Data management & integration', 'Performance management (CPM/EPM)', 'AI & machine learning', 'Market & web data'],
    ['CRM & sales', 'Marketing automation & martech', 'Customer data & identity', 'Customer service & contact centre', 'Digital experience & CMS', 'E-commerce'],
    ['Customer data & identity', 'Adtech', 'Marketing automation & martech', 'Identity & access management'],
    ['ERP', 'Accounting & finance software', 'Procurement & spend management', 'Performance management (CPM/EPM)', 'Supply chain & logistics', 'Manufacturing (MES / IIoT)'],
    ['IT service management', 'Observability & monitoring', 'Workload automation & output', 'Security software', 'DevOps & developer tools'],
    ['Manufacturing (MES / IIoT)', 'PLM, CAD & simulation', 'Field service & asset management', 'Supply chain & logistics'],
    ['GRC & compliance', 'Security software', 'Identity & access management', 'Tax & compliance reporting'],
  ];
  const adjacent = (a, b) => a !== b && ADJ.some(g => g[0] === a ? g.includes(b) : g[0] === b ? g.includes(a) : false);
  // Path of a deal: from its niche, else from its industry label.
  const pathOfDeal = a => { const n = ofDeal(a); return n ? pathOf(n.niche) : fromLabel(a?.industry); };
  const SUBSECTORS = [...SUB.keys()];
  const SECTORS = [...SECTOR.keys()];
  // industryOf(niche) keeps its old meaning "the level right above a niche", which is now the sub-sector.
  const subsectorOf = niche => byNiche.get(String(niche).toLowerCase())?.subsector || '';
  return { VERSION, INDUSTRIES, SECTORS, SUBSECTORS, TREE, NICHES: list(), classify, ofDeal, score, synonyms, isGeneric, adjacent,
    pathOf, pathOfDeal, pathOfCompany, fromLabel, endMarket, subsectorOf, industryOf: subsectorOf, sectorOf: s => SECTOR.has(s) ? s : SUB.get(s)?.sector || '' };
})();
