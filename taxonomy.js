// Industry > niche taxonomy for software M&A. Broad labels like "Application Software" say nothing about fit,
// so every company (and every acquisition) is classified into niches from its texts, using the synonyms below.
const Taxonomy = (() => {
  // [industry, niche, synonyms]. Synonyms are lower-case phrases matched on word boundaries; keep them specific.
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
    ['IT management & infrastructure', 'IT service management', ['it service management', 'itsm', 'service desk', 'itom', 'it asset management', 'itam', 'enterprise service management', 'endpoint management', 'saas management', 'servicenow']],
    ['IT management & infrastructure', 'Observability & monitoring', ['observability', 'application performance monitoring', 'apm', 'log management', 'infrastructure monitoring', 'network monitoring']],
    ['IT management & infrastructure', 'DevOps & developer tools', ['devops', 'ci/cd', 'developer tools', 'version control', 'test automation', 'software testing', 'code quality', 'api testing']],
    ['IT management & infrastructure', 'Cloud & hosting', ['web hosting', 'cloud hosting', 'managed hosting', 'cloud infrastructure', 'data centre', 'data center', 'domain names', 'iaas', 'sovereign cloud', 'cloud provider', 'gpu cloud', 'ai infrastructure']],
    ['IT management & infrastructure', 'Workload automation & output', ['workload automation', 'job scheduling', 'output management', 'mainframe']],
    ['Cybersecurity', 'Identity & access management', ['identity and access management', 'iam', 'authentication', 'single sign-on', 'privileged access', 'identity governance', 'multi-factor authentication']],
    ['Cybersecurity', 'Security software', ['cybersecurity', 'cyber security', 'endpoint security', 'email security', 'network security', 'threat detection', 'siem', 'security operations', 'vulnerability management', 'data security', 'zero trust']],
    ['Cybersecurity', 'GRC & compliance', ['governance, risk', 'grc', 'risk management software', 'compliance management', 'audit management', 'whistleblowing', 'regtech', 'internal control', 'policy management']],
    ['Content, documents & collaboration', 'Document & content management', ['document management', 'dms', 'enterprise content management', 'ecm', 'archiving', 'records management', 'content services']],
    ['Content, documents & collaboration', 'Customer communications (CCM)', ['customer communications management', 'ccm', 'document generation', 'omnichannel communication', 'output and print']],
    ['Content, documents & collaboration', 'Collaboration & work management', ['collaboration software', 'intranet', 'employee communication', 'project management software', 'work management', 'knowledge management', 'portfolio management software']],
    ['Content, documents & collaboration', 'E-signature & digital trust', ['electronic signature', 'e-signature', 'digital signature', 'trust services', 'qualified signature']],
    ['HR & workforce', 'HR & payroll', ['hr software', 'human resources software', 'hcm', 'human capital management', 'payroll', 'recruiting software', 'applicant tracking', 'talent management', 'learning management', 'lms']],
    ['HR & workforce', 'Workforce management', ['workforce management', 'shift planning', 'rostering', 'time and attendance', 'time tracking', 'personnel scheduling']],
    ['Industry & engineering', 'PLM, CAD & simulation', ['product lifecycle management', 'plm', 'cad', 'cae', 'engineering simulation', 'computer-aided design', 'pdm']],
    ['Industry & engineering', 'Manufacturing (MES / IIoT)', ['manufacturing execution', 'mes', 'industrial iot', 'iiot', 'shop floor', 'industry 4.0', 'scada', 'production planning', 'advanced planning and scheduling', 'quality management system']],
    ['Industry & engineering', 'Supply chain & logistics', ['supply chain', 'logistics software', 'warehouse management', 'wms', 'transport management', 'tms', 'fleet management', 'route optimization', 'route optimisation', 'freight']],
    ['Industry & engineering', 'Field service & asset management', ['field service', 'enterprise asset management', 'eam', 'cmms', 'maintenance management', 'asset performance management']],
    ['Industry & engineering', 'Construction & AEC', ['construction software', 'bim', 'building information modeling', 'architecture, engineering', 'aec']],
    ['Industry & engineering', 'Energy & utilities software', ['energy management', 'utilities software', 'utility billing', 'smart grid', 'renewable energy', 'energy trading', 'meter data']],
    ['Vertical software', 'Healthcare software', ['healthcare software', 'hospital information', 'electronic health record', 'ehr', 'emr', 'clinical software', 'medical software', 'pharmacy software', 'care management', 'healthtech']],
    ['Vertical software', 'Insurance software', ['insurance software', 'insurtech', 'policy administration', 'claims management', 'insurers']],
    ['Vertical software', 'Banking & fintech software', ['banking software', 'core banking', 'fintech', 'payments', 'lending software', 'wealth management', 'capital markets', 'payment processing']],
    ['Vertical software', 'Legal software', ['legal software', 'law firm', 'legal tech', 'legaltech', 'contract lifecycle management', 'practice management']],
    ['Vertical software', 'Public sector & govtech', ['public sector', 'govtech', 'e-government', 'municipalities', 'local government', 'public administration']],
    ['Vertical software', 'Real estate & property', ['real estate software', 'property management', 'proptech', 'facility management', 'housing associations']],
    ['Vertical software', 'Education software', ['edtech', 'education software', 'school management', 'student information', 'e-learning']],
    ['Vertical software', 'Retail & hospitality software', ['retail software', 'point of sale', 'pos software', 'hospitality software', 'hotel software', 'restaurant software', 'property management system']],
    ['Vertical software', 'Automotive & mobility software', ['automotive software', 'dealer management', 'mobility software', 'embedded automotive']],
    ['Vertical software', 'Telecom software', ['telecom software', 'telco', 'oss/bss', 'bss', 'network operators', 'mobile operators']],
    ['Vertical software', 'Media & publishing software', ['publishing software', 'newsroom', 'broadcast software', 'media asset management', 'digital asset management']],
    ['Diversified software groups', 'Software holdings & serial acquirers', ['vertical market software', 'vertical-market software', 'serial acquirer', 'serial acquirers', 'acquires and grows', 'software holding', 'software group buying', 'buy-and-build platform', 'decentralised software group', 'permanent owner of software']],
    ['Diversified software groups', 'Large platform & hyperscalers', ['hyperscaler', 'hyperscalers', 'cloud and ai', 'global technology company', 'technology conglomerate']],
    ['IT services & consulting', 'IT services & consulting', ['it services', 'it consulting', 'system integrator', 'systems integration', 'managed services', 'digital transformation consultancy', 'implementation partner', 'it outsourcing', 'consultancy']],
    ['IT services & consulting', 'BPO & outsourcing', ['business process outsourcing', 'bpo', 'outsourcing services', 'shared services']],
  ];
  const NICHES = T.map(([industry, niche, syn], i) => ({ id: i, industry, niche, syn: [niche.toLowerCase(), ...syn] }));
  const INDUSTRIES = [...new Set(T.map(t => t[0]))];
  const byNiche = new Map(NICHES.map(n => [n.niche.toLowerCase(), n]));
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
      [[c.description, c.summary].join(' '), 1],
    ]);
    // The main niche may rest on one mention if nothing competes with it; further niches need real evidence.
    const keep = s.filter((x, i) => !set.some(y => y.niche === x.niche) && (x.score >= 2 || (i === 0 && (s[1]?.score || 0) < x.score)));
    return [...set, ...keep].slice(0, 4);
  }
  // Niche of one acquisition (from its industry, tags and description).
  const dealCache = new WeakMap();
  function ofDeal(a) {
    if (!a || typeof a !== 'object') return null;
    if (dealCache.has(a)) return dealCache.get(a);
    const v = score([[[a.industry, Array.isArray(a.tags) ? a.tags.join(' ; ') : a.tags].join(' ; '), 2], [[a.description, a.why, a.target].join(' '), 1]]).find(x => x.score >= 2) || null;
    dealCache.set(a, v);
    return v;
  }
  // Synonyms of a niche, for phrase matching ("process intelligence" should hit "process mining").
  const synonyms = niche => byNiche.get(String(niche).toLowerCase())?.syn.filter(s => s.length > 3) || [];
  const list = () => NICHES.map(n => ({ industry: n.industry, niche: n.niche }));
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
  return { INDUSTRIES, NICHES: list(), classify, ofDeal, score, synonyms, isGeneric, adjacent, industryOf: niche => byNiche.get(String(niche).toLowerCase())?.industry || '' };
})();
