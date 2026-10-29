// Company research with Claude + web search. The browser loads the official SDK as window.Anthropic (see index.html).
const Enricher = (() => {
  const MODELS = {
    'claude-opus-5-5': { label: 'Claude Opus 5.5 (best quality)', price: [4, 20], fallback: true },
    'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (cheaper)', price: [2, 10], fallback: true },
    'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (cheapest)', price: [0.1, 0.5], fallback: false },
  };
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const SEARCH_PRICE = 0.01; // USD per web search
  const MAX_SEARCHES = 8;
  const ROLE_TAGS = ['CEO', 'CFO', 'COO', 'CTO', 'Founder', 'Chairman', 'Corporate Development', 'M&A', 'Strategy', 'Board', 'Other'];

  const str = { type: 'string' };
  const SAVE_TOOL = {
    name: 'save_profile',
    description: 'Save the researched company profile. Call this exactly once, after your research is done. Use empty strings for anything you could not verify.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['website', 'linkedin_url', 'linkedin_employees', 'employees', 'hq_city', 'country', 'founded', 'ownership', 'sector', 'subsector',
        'short_description', 'long_description', 'is_acquisitive', 'people', 'acquisitions', 'notes', 'sources'],
      properties: {
        website: str,
        linkedin_url: { type: 'string', description: 'Company page, e.g. https://www.linkedin.com/company/acme' },
        linkedin_employees: { type: 'string', description: 'Employee count as shown on LinkedIn, e.g. "1,240" or "201-500"' },
        employees: { type: 'string', description: 'Total employees from annual report / website if different from LinkedIn' },
        hq_city: str, country: str, founded: { type: 'string', description: 'Year' },
        ownership: { type: 'string', description: 'e.g. "Founder-owned", "PE-backed (Bregal, since 2021)", "Listed (XETRA: FAA)", "Subsidiary of X"' },
        sector: str, subsector: str,
        short_description: { type: 'string', description: 'One sentence' },
        long_description: { type: 'string', description: '4-6 sentences: products, customers, geography, size, strategy' },
        is_acquisitive: { type: 'string', enum: ['yes', 'some', 'no', 'unknown'] },
        people: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['name', 'title', 'role_tag', 'linkedin_url', 'source_url'],
            properties: { name: str, title: str, role_tag: { type: 'string', enum: ROLE_TAGS }, linkedin_url: str, source_url: str },
          },
        },
        acquisitions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['target', 'year', 'description', 'source_url'],
            properties: { target: str, year: str, description: str, source_url: str },
          },
        },
        notes: { type: 'string', description: 'Caveats, e.g. conflicting sources or a recent leadership change' },
        sources: { type: 'array', items: str },
      },
    },
  };

  const SYSTEM = `You are a meticulous M&A research analyst at a European corporate finance boutique. You build company profiles for a buyer and target database.
Only report facts supported by sources you found; leave a field as an empty string when you cannot verify it. Never guess or construct email addresses or LinkedIn URLs - only give a LinkedIn URL you actually saw in a search result.
People change roles often: prefer sources from the last 24 months and skip anyone who has clearly left.
Be efficient: aim for 4-8 searches. When you are done, call save_profile once.`;

  function prompt(c) {
    const known = [
      ['Name', c.name], ['Website', c.website], ['Country', c.country], ['Sector', c.sector],
      ['Known description', String(c.description || '').slice(0, 600)],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `Research this company:
${known}

Find:
1. Official website and the company's LinkedIn page (linkedin.com/company/...).
2. Number of employees shown on LinkedIn, and total employees if reported elsewhere.
3. HQ city and country, year founded, ownership (founder/family, PE-backed by whom and since when, listed with ticker, or subsidiary of whom).
4. Key people: CEO, CFO, and whoever is responsible for corporate development, M&A or strategy; active founders too. Include their LinkedIn profile URL when you saw it.
5. Acquisitions made by this company: target, year and one line each, most recent first, at most 15.
6. A one-sentence short description and a 4-6 sentence long description.

If the name is ambiguous, use the website and country to pick the right company, and say so in notes.`;
  }

  let client = null, clientKey = '';
  function getClient(apiKey) {
    if (!apiKey) throw new Error('Add your Anthropic API key in Settings first.');
    if (!window.Anthropic) throw new Error('The Claude library is still loading. Try again in a few seconds.');
    if (!client || clientKey !== apiKey) {
      client = new window.Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
      clientKey = apiKey;
    }
    return client;
  }

  function cost(model, usage) {
    const [pin, pout] = (MODELS[model] || MODELS[DEFAULT_MODEL]).price;
    const searches = usage.server_tool_use?.web_search_requests || 0;
    const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
    return { usd: (input * pin + (usage.output_tokens || 0) * pout) / 1e6 + searches * SEARCH_PRICE, searches };
  }

  // Returns { profile, usd, searches, model }. Throws on API errors and refusals.
  async function research(company, { apiKey, model = DEFAULT_MODEL, signal } = {}) {
    const anthropic = getClient(apiKey);
    const m = MODELS[model] ? model : DEFAULT_MODEL;
    const messages = [{ role: 'user', content: prompt(company) }];
    let usd = 0, searches = 0;
    for (let turn = 0; turn < 6; turn++) {
      const params = {
        model: m,
        max_tokens: 32000,
        system: SYSTEM,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }, SAVE_TOOL],
        messages,
      };
      // On a safety decline, the API re-runs the request on a suitable fallback model.
      if (MODELS[m].fallback) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      const stream = anthropic.beta.messages.stream(params, { signal });
      const msg = await stream.finalMessage();
      const c = cost(m, msg.usage || {});
      usd += c.usd; searches += c.searches;

      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to research this company' + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : '.'));
      const call = msg.content.find(b => b.type === 'tool_use' && b.name === 'save_profile');
      if (call) return { profile: call.input, usd, searches, model: msg.model || m };

      messages.push({ role: 'assistant', content: msg.content });
      // pause_turn: the server paused a long search turn - send it back to continue.
      if (msg.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: 'Please call save_profile now with what you found.' });
    }
    throw new Error('No profile returned after several attempts.');
  }

  const blank = v => v === '' || v == null;
  const toNumber = s => {
    const m = String(s || '').replace(/[,.\s](?=\d{3}\b)/g, '').match(/\d+/g);
    if (!m) return null;
    // "201-500" -> 500 is an upper bound; keep the lower end as the estimate.
    return Number(m[0]);
  };

  // Writes a research result onto a company. Facts from your own lists are kept; blanks are filled.
  function apply(c, r, meta) {
    const p = r || {};
    for (const k of ['website', 'country', 'hq_city', 'founded', 'ownership', 'sector', 'subsector']) if (blank(c[k]) && p[k]) c[k] = p[k];
    if (p.linkedin_url) c.linkedin_url = Engine.cleanUrl(p.linkedin_url);
    if (p.linkedin_employees) { c.linkedin_employees = toNumber(p.linkedin_employees); c.linkedin_employees_text = p.linkedin_employees; }
    if (blank(c.employees) && toNumber(p.employees)) c.employees = toNumber(p.employees);
    if (p.short_description) c.short_description = p.short_description;
    if (p.long_description && blank(c.description)) c.description = p.long_description;
    if (p.acquisitions?.length) c.acquisitions = p.acquisitions;
    c.contacts ??= [];
    for (const person of p.people || []) {
      if (!person.name) continue;
      const li = person.linkedin_url ? Engine.cleanUrl(person.linkedin_url) : '';
      const same = c.contacts.find(x => (li && x.linkedin && Engine.linkedinKey(x.linkedin) === Engine.linkedinKey(li)) || Engine.personKey(x.name) === Engine.personKey(person.name));
      if (same) {
        if (li) same.linkedin = li;
        if (person.title) same.title = same.title || person.title;
        if (person.role_tag && (person.role_tag !== 'Other' || !same.role_tag)) same.role_tag = person.role_tag;
        if (person.source_url) same.source_url = person.source_url;
        same.verified_at = meta.at;
      } else {
        c.contacts.push({ name: person.name, title: person.title, role_tag: person.role_tag, linkedin: li, source: 'Claude', source_url: person.source_url, verified_at: meta.at });
      }
    }
    c.enrichment = {
      at: meta.at, model: meta.model, usd: Math.round(meta.usd * 1000) / 1000, searches: meta.searches,
      short_description: p.short_description, long_description: p.long_description, is_acquisitive: p.is_acquisitive,
      notes: p.notes, sources: (p.sources || []).filter(Boolean).slice(0, 30),
    };
    return c;
  }

  return { MODELS, DEFAULT_MODEL, ROLE_TAGS, research, apply };
})();
