/* global Engine, Taxonomy, RevEst, state, byId, esc, logo, money, members, stats, stackBar, companyCell, stageChip, STAGE_COLORS, renderProjects, saveProjects, touch, toast, followUpsDue, employeesOf, ago */
// Buy-side mandates: a project can be a SELL mandate (we sell a company and look for buyers; pipeline.js) or a BUY
// mandate (a client wants to acquire; we screen the database for targets against the client's buy box).
// The screening follows how 33 Equity screens by hand (Project Orion target list): mandate categories (e.g.
// technology buckets), country, size (employees / revenue), customer type (Enterprise / Mid-market / SME / Public
// sector / Consumers), customer industries, delivery (software vs services), ownership, independence; candidates
// that fail a hard criterion go to a "graveyard" with the reason (Too small, Too big, No country fit, No longer
// independent, Ownership, Limited strategic fit), the rest get a fit score and a suggested tier 1-3.
const isBuy = proj => proj?.side === 'buy';
const noun = (proj, n = 2) => (isBuy(proj) ? (n === 1 ? 'target' : 'targets') : (n === 1 ? 'buyer' : 'buyers'));

// Pipeline stages keep their internal names; a buy mandate shows its own labels for them.
const BUY_STAGE_LABEL = { 'Not approached': 'Not approached', 'Teaser sent': 'Intro mail sent', 'Reminder sent': 'Reminder sent', 'NDA sent': 'In conversation', 'NDA signed': 'NDA signed', 'IM sent': 'Information received', 'IOI received': 'Indicative offer made', 'Management meeting': 'Intro with management', 'Data room / DD': 'Due diligence', 'Binding offer': 'Binding offer / LOI', Signed: 'Signed', Passed: 'Passed / excluded' };
const stageLabel = (st, proj) => (isBuy(proj) ? BUY_STAGE_LABEL[st] || st : st);

const OWNERSHIP_OPTIONS = ['Private / founder', 'PE-backed', 'VC-backed', 'Subsidiary', 'Listed'];
const DELIVERY_OPTIONS = ['Software', 'Software & services', 'Services'];
const listOf = v => (Array.isArray(v) ? v : String(v || '').split(/[;,\n]/)).map(s => String(s).trim()).filter(Boolean);
const REGION_WORDS = { dach: ['Germany', 'Austria', 'Switzerland'], benelux: ['Netherlands', 'Belgium', 'Luxembourg'], nordics: ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'], 'uk & ireland': ['United Kingdom', 'Ireland'], uk: ['United Kingdom'], 'southern europe': ['Spain', 'Italy', 'Portugal', 'Greece'] };
const EUROPE_WORDS = /^(europe|eu|european)$/i;

// The buy box as a "deal" the match engine understands: the client is the buyer, candidates are targets.
function buyDealOf(proj) {
  const b = proj.buybox || {};
  const cats = (b.categories || []).map(x => x.keywords || x.name).join('; ');
  return {
    id: 'buy:' + proj.id, project: proj.name, role: 'Buyer', currency: 'EUR', name: b.buyer || proj.client || proj.name,
    keywords: [b.keywords, cats, ...(b.niches || [])].filter(Boolean).join('; '), description: b.description || '',
    niche: (b.niches || [])[0] || '', min_revenue: b.rev_min ?? null, max_revenue: b.rev_max ?? null,
  };
}
// Thematic buy box: keywords / niches / categories decide the fit. Generalist ("any industry", e.g. a PE buyer that
// buys everything): no thematic fit needed; the hard filters (industry tree, size, founded, ownership, country)
// select and the score ranks on likelihood to sell, size fit, country and data quality.
const isThematic = b => !!(b.keywords || (b.niches || []).length || (b.categories || []).length);
const isGeneralist = b => b.scope === 'any' || !isThematic(b);
const hasBuyBox = proj => { const b = proj.buybox || {}; return isThematic(b) || !!b.description || b.scope === 'any' || !!(b.cls || []).length || listOf(b.countries).length > 0 || b.emp_min != null || b.emp_max != null || b.rev_min != null || b.rev_max != null || b.founded_min != null || b.founded_max != null || listOf(b.ownership).length > 0; };
const foundedYearOf = c => { const y = +String(c.founded || '').match(/\b(18|19|20)\d{2}\b/)?.[0]; return y || null; };

function countryFits(country, wanted) {
  if (!wanted.length) return true;
  const c = String(country || '').toLowerCase();
  if (!c) return null; // unknown country: not excluded, but no bonus
  for (const w of wanted.map(x => x.toLowerCase())) {
    if (w === c || (REGION_WORDS[w] || []).some(x => x.toLowerCase() === c)) return true;
    if (EUROPE_WORDS.test(w) && /benelux|dach|nordics|uk|france|southern|cee|europe/i.test(Engine.regionOf({ country }) || '')) return true;
  }
  return false;
}
// Which mandate category a candidate falls in: the category whose keywords / niches hit its texts best.
function categoryOf(c, cats) {
  if (!cats?.length) return '';
  const text = ' ' + [c.name, c.niche, c.sector, c.subsector, c.short_description, c.description, c.summary, (c.tags || []).join(' '), c.keywords].join(' ').toLowerCase() + ' ';
  let best = '', score = 0;
  for (const cat of cats) {
    const words = listOf(cat.keywords).concat(listOf(cat.niches)).map(w => w.toLowerCase());
    const s = words.filter(w => w.length > 2 && text.includes(w)).length + (listOf(cat.niches).includes(c.niche) ? 2 : 0);
    if (s > score) { score = s; best = cat.name; }
  }
  return best;
}

// Screens every non-investor company against the buy box. Returns { fits, excluded } (both scored, best first).
// Cached per project until the buy box, the database or the project's members change (a full screen takes seconds).
const screenCache = new Map();
function screenTargets(proj) {
  const sig = JSON.stringify(proj.buybox || {}) + '|' + state.companies.length + '|' + members(proj.name).length + '|' + (state.transactions?.length || 0) + '|' + JSON.stringify(state.weights);
  const hit = screenCache.get(proj.id);
  if (hit && hit.sig === sig) return hit.v;
  const v = screenTargetsUncached(proj);
  screenCache.set(proj.id, { sig, v });
  return v;
}
function screenTargetsUncached(proj) {
  const b = proj.buybox || {}, deal = buyDealOf(proj);
  const inProject = new Set(members(proj.name).map(m => m.c.id));
  const clientKey = Engine.normName(b.buyer || proj.client || '');
  const pool = state.companies.filter(c => c.role !== 'Investor' && !inProject.has(c.id) && Engine.normName(c.name) !== clientKey);
  const generalist = isGeneralist(b), cls = b.cls || [];
  // Generalist: every operating company is a candidate; the score is built below instead of the thematic match.
  const ranked = generalist ? pool.map(c => ({ company: c, score: 0, reasons: [] })) : Engine.match(deal, pool, state.weights);
  const wantSeg = listOf(b.segments), wantInd = listOf(b.industries).map(x => x.toLowerCase()), wantDel = listOf(b.delivery), wantOwn = listOf(b.ownership), countries = listOf(b.countries);
  const fits = [], excluded = [];
  for (const m of ranked) {
    const c = m.company;
    if (!generalist && m.score < (b.min_fit ?? 25)) continue; // no business fit at all: not worth a row
    const clsHit = cls.length ? cls.find(v => clsMatches(c, v)) : null;
    // Generalist with an industry choice: companies outside it are simply not candidates (no 20,000-row graveyard).
    if (generalist && cls.length && !clsHit) continue;
    const emp = employeesOf(c), rev = Engine.revenueOf(c), own = Engine.ownershipType(c.ownership) || (c.sponsor_name ? 'PE-backed' : c.parent_name ? 'Subsidiary' : ''), cu = Engine.customerOf(c), del = Engine.deliveryOf(c);
    const reasons = [], why = [...m.reasons.filter(r => !/Potential target|Likely target/.test(r))];
    // Hard criteria → graveyard reason (first one wins, like the "Reason for exclusion" column).
    if (cls.length && !clsHit) reasons.push('Other industry');
    const year = foundedYearOf(c);
    if (b.founded_min != null && year != null && year < b.founded_min) reasons.push(`Founded ${year} (before ${b.founded_min})`);
    if (b.founded_max != null && year != null && year > b.founded_max) reasons.push(`Founded ${year} (after ${b.founded_max})`);
    if ((b.founded_min != null || b.founded_max != null) && year == null && b.founded_required) reasons.push('Founding year unknown');
    const cf = countryFits(c.country, countries);
    if (cf === false) reasons.push('No country fit');
    if (b.emp_min != null && emp != null && emp < b.emp_min) reasons.push('Too small');
    else if (b.rev_min != null && rev && !rev.rough && rev.v < b.rev_min) reasons.push('Too small');
    if (b.emp_max != null && emp != null && emp > b.emp_max) reasons.push('Too big');
    else if (b.rev_max != null && rev && rev.v > b.rev_max) reasons.push('Too big');
    if (b.independent !== false && (own === 'Subsidiary' || c.parent_name)) reasons.push('No longer independent');
    if (wantOwn.length && own && !wantOwn.includes(own) && !(own === 'Private / founder' && wantOwn.includes('Private / founder'))) reasons.push(`Ownership (${own})`);
    if (own === 'Listed' && !wantOwn.includes('Listed') && wantOwn.length) reasons.push('Listed');
    if (wantOwn.length && !own && b.ownership_required) reasons.push('Ownership unknown');
    if (wantDel.length && del && !wantDel.includes(del)) reasons.push(`Delivery: ${del}`);
    // Soft criteria → bonus points and reasons.
    let bonus = 0;
    if (cf === true && countries.length) { bonus += 5; why.push(`Country: ${c.country}`); }
    if (wantSeg.length && cu.segments.some(s => wantSeg.includes(s))) { bonus += cu.guessed ? 4 : 8; why.push(`Customers: ${cu.segments.filter(s => wantSeg.includes(s)).join(', ')}${cu.guessed ? ' (from description)' : ''}`); }
    else if (wantSeg.length && cu.segments.length) bonus -= 6;
    if (wantInd.length) { const hit = wantInd.filter(w => (cu.industries + ' ' + c.short_description + ' ' + c.description).toLowerCase().includes(w)); if (hit.length) { bonus += Math.min(10, 4 * hit.length); why.push(`Serves ${hit.slice(0, 3).join(', ')}`); } }
    if (wantDel.length && wantDel.includes(del)) bonus += 4;
    const side = Engine.sideOf(c);
    let base = m.score;
    if (generalist) {
      // No thematic fit: likelihood to sell (founder / PE exit window / size sweet spot), size fit, ownership wanted,
      // industry match depth and data quality.
      const sizeSet = b.emp_min != null || b.emp_max != null || b.rev_min != null || b.rev_max != null;
      const sizeKnown = sizeSet && ((b.emp_min != null || b.emp_max != null) ? emp != null : rev && !rev.rough);
      base = Math.round(side.target * 38) + (sizeSet ? (sizeKnown ? 12 : 4) : 6);
      if (wantOwn.length && own && wantOwn.includes(own)) { base += 8; why.push(`Ownership: ${own}`); }
      // Industry depth: a niche or sub-sector pick that matches counts more than a broad sector.
      if (clsHit) { base += clsHit[0] === 'n' ? 10 : clsHit[0] === 'U' ? 7 : clsHit[0] === 'S' ? 3 : 1; why.push(`Industry: ${clsHit.slice(2)}`); }
      // Age: older founder-run companies are more likely to have a succession question.
      const age = year != null ? new Date().getFullYear() - year : null;
      if (age != null) base += age >= 25 ? 6 : age >= 15 ? 4 : age >= 8 ? 2 : 0;
      // Data quality: researched, a named CEO / owner, website, a revenue figure (stated beats estimated).
      const hasBoss = (c.contacts || []).some(x => /ceo|founder|owner|directeur|managing/i.test(`${x.title || ''} ${x.role_tag || ''}`));
      base += (c.research?.level >= 2 || c.enrichment ? 6 : 0) + (hasBoss ? 4 : 0) + (c.website ? 2 : 0) + (c.revenue != null ? 4 : rev ? 1 : 0);
      if (side.target >= 0.6) why.unshift(`Likely seller: ${side.why.target.slice(0, 2).join(', ')}`);
      if (year != null && (b.founded_min != null || b.founded_max != null)) why.push(`Founded ${year}`);
      if (sizeKnown) why.push(emp != null ? `${Engine.fmt(emp)} staff` : `Revenue ≈ €${Engine.fmt(Math.round(rev.v * 10) / 10)}m`);
    }
    const score = Math.max(0, Math.min(100, base + bonus));
    const row = { company: c, score, tier: score >= 65 ? '1' : score >= 50 ? '2' : '3', category: categoryOf(c, b.categories), why: [...new Set(why)], reason: reasons[0] || '', reasons, emp, rev, own, cu, del, side };
    // Generalist screens cover the whole database: only near misses (size, founded, ownership, delivery) go to the graveyard.
    if (generalist && reasons.includes('No country fit')) continue;
    (reasons.length ? excluded : fits).push(row);
  }
  fits.sort((a, b2) => b2.score - a.score);
  excluded.sort((a, b2) => b2.score - a.score);
  return { fits, excluded };
}

// ---------- Find targets tab ----------
const tf = { view: 'fits', limit: 150, picked: new Set(), cat: '', reason: '' };
function findTargetsHtml(proj) {
  if (!hasBuyBox(proj)) return `<div class="empty">First describe what the client wants to buy: a theme (categories / niches / keywords) or, for a generalist buyer, just industries, size, founded, ownership and countries.<br><br><button class="btn primary" data-x="editProfile">Set the buy box</button></div>`;
  const { fits, excluded } = screenTargets(proj);
  const cats = [...new Set(fits.map(r => r.category).filter(Boolean))];
  const reasons = [...excluded.reduce((m, r) => m.set(r.reason, (m.get(r.reason) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  let list = tf.view === 'fits' ? fits : excluded;
  if (tf.view === 'fits' && tf.cat) list = list.filter(r => r.category === tf.cat);
  if (tf.view !== 'fits' && tf.reason) list = list.filter(r => r.reason === tf.reason);
  const shown = list.slice(0, tf.limit);
  const segTxt = r => r.cu.segment ? `${esc(r.cu.segment)}${r.cu.guessed ? '<span class="muted">*</span>' : ''}` : '<span class="dash">–</span>';
  const revTxt = r => r.rev ? `${r.rev.est ? '≈ ' : ''}€${Engine.fmt(Math.round(r.rev.v * 10) / 10)}m` : '<span class="dash">–</span>';
  return `<div class="callout"><span>✦</span><div><b>${fits.length.toLocaleString()} targets fit the buy box</b> · ${excluded.length.toLocaleString()} excluded on hard criteria.
      ${isGeneralist(proj.buybox || {}) ? 'Generalist screen: every company in the chosen industries, ranked on likelihood to sell, size fit, ownership, industry match and data quality.' : 'Ranked on niche / keyword fit, size, likelihood to sell, customer type, industries and country.'} Tiers: 1 ≥ 65, 2 ≥ 50, else 3.</div></div>
    <div class="filters">
      <div class="seg-tabs"><button data-tview="fits" class="${tf.view === 'fits' ? 'on' : ''}">Fits (${fits.length})</button><button data-tview="excluded" class="${tf.view !== 'fits' ? 'on' : ''}">Graveyard (${excluded.length})</button></div>
      ${tf.view === 'fits' && cats.length ? `<select id="tfCat"><option value="">All categories</option>${cats.map(c => `<option ${c === tf.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
      ${tf.view !== 'fits' ? `<select id="tfReason"><option value="">All reasons</option>${reasons.map(([r, n]) => `<option value="${esc(r)}" ${r === tf.reason ? 'selected' : ''}>${esc(r)} (${n})</option>`).join('')}</select>` : ''}
      <span class="spacer"></span>
      <label class="row-label small">Show top <input type="number" id="tfLimit" value="${tf.limit}" min="10" max="2000" style="width:76px"></label>
      <button class="btn" data-y="exportScreen" title="Excel in the 33 Equity target-list format: the ticked fits (or the top shown) on the list, the excluded ones in the graveyard">Export target list</button>
      <button class="btn" data-y="pickTop">Select top 50</button>
      <button class="btn primary" data-y="addPicked">Add ${tf.picked.size || 'selected'} to ${esc(proj.name)}</button>
    </div>
    <div class="table-wrap"><table class="data target-list"><thead><tr><th class="cb"></th><th class="num">Fit</th><th>Company</th><th>Category</th><th>Country</th><th class="num">Staff</th><th class="num">Revenue</th><th>Customers</th><th>Owner</th><th>${tf.view === 'fits' ? 'Why it fits' : 'Excluded because'}</th></tr></thead><tbody>
      ${shown.map(r => `<tr data-id="${r.company.id}">
        <td class="cb"><input type="checkbox" data-tpick="${r.company.id}" ${tf.picked.has(r.company.id) ? 'checked' : ''}></td>
        <td class="num"><b>${r.score}</b><div class="cell-sub">T${r.tier}</div></td>
        <td>${companyCell(r.company)}</td>
        <td class="small">${esc(r.category || '')}</td>
        <td class="small">${esc(r.company.country || '')}</td>
        <td class="num">${r.emp != null ? Engine.fmt(r.emp) : '<span class="dash">–</span>'}</td>
        <td class="num">${revTxt(r)}</td>
        <td class="small">${segTxt(r)}${r.cu.industries ? `<div class="cell-sub" title="${esc(r.cu.industries)}">${esc(r.cu.industries.slice(0, 40))}</div>` : ''}</td>
        <td class="small">${esc(r.own || '')}${r.side.label === 'Likely target' ? '<div class="cell-sub">likely seller</div>' : ''}</td>
        <td class="small wrap ${tf.view !== 'fits' ? 'err' : 'muted'}">${esc(tf.view === 'fits' ? r.why.slice(0, 3).join(' · ') : r.reasons.join(' · '))}</td>
      </tr>`).join('') || `<tr><td colspan="10"><div class="empty">No ${tf.view === 'fits' ? 'targets fit' : 'excluded companies'} yet. Widen the buy box or import more companies.</div></td></tr>`}
    </tbody></table></div>
    <p class="muted small">* customer type read from the description; research makes it firm. Excluded companies can still be added by hand.</p>`;
}
function addTargets(proj, ids) {
  const { fits, excluded } = screenTargets(proj);
  const byIdRow = new Map([...fits, ...excluded].map(r => [r.company.id, r]));
  let n = 0;
  for (const id of ids) {
    const c = byId(id), r = byIdRow.get(id);
    if (!c || c.projects.some(p => p.project === proj.name)) continue;
    c.projects.push({ project: proj.name, status: 'Not approached', tier: r?.tier || '', category: r?.category || '', rationale: r ? `Fit ${r.score}: ${r.why.join('; ')}` : '', pass_reason: r?.reason ? `Excluded: ${r.reasons.join('; ')}` : '', source: 'Find targets' });
    touch(c); n++;
  }
  tf.picked.clear();
  toast(`${n} targets added to ${proj.name}.`, 5000);
}

// ---------- Overview for a buy mandate ----------
function buyOverviewHtml(proj) {
  const b = proj.buybox || {}, s = stats(proj.name), due = followUpsDue(proj.name);
  const fact = (k, v) => v ? `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>` : '';
  const range = (lo, hi, unit = '') => lo == null && hi == null ? '' : `${lo ?? 0}${unit} – ${hi != null ? hi + unit : 'any'}`;
  const byCat = new Map();
  for (const { p } of members(proj.name)) if (p.category) byCat.set(p.category, (byCat.get(p.category) || 0) + 1);
  return `<div class="overview-grid">
    <div class="card">
      <div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">Buy box</h2><span class="chip gold">Buy-side</span><span class="spacer"></span><button class="btn sm" data-x="editProfile">Edit</button></div>
      ${hasBuyBox(proj) ? `<p class="lead">${esc(b.buyer || proj.client || 'Client')} wants to acquire</p>${b.description ? `<p class="prose">${esc(b.description)}</p>` : ''}
        <div class="facts">
          ${fact('Scope', isGeneralist(b) ? 'Any business (generalist)' : 'Thematic')}
          ${fact('Industries', esc((b.cls || []).map(v => v.slice(2)).join(', ')))}
          ${fact('Founded', esc(range(b.founded_min, b.founded_max).replace(/^0 – /, 'up to ').replace(/ – any$/, ' or later')))}
          ${fact('Countries', esc(listOf(b.countries).join(', ')))}
          ${fact('Employees', esc(range(b.emp_min, b.emp_max)))}
          ${fact('Revenue (EUR m)', esc(range(b.rev_min, b.rev_max)))}
          ${fact('Customers', esc(listOf(b.segments).join(', ')))}
          ${fact('Customer industries', esc(listOf(b.industries).join(', ')))}
          ${fact('Delivery', esc(listOf(b.delivery).join(', ')))}
          ${fact('Ownership', esc(listOf(b.ownership).join(', ')) + (b.independent !== false ? '<div class="muted small">independent only</div>' : ''))}
          ${fact('Niches', esc((b.niches || []).join(', ')))}
        </div>
        ${(b.categories || []).length ? `<h3>Categories</h3><div class="chips">${b.categories.map(c => `<span class="chip" title="${esc(c.keywords || '')}">${esc(c.name)}${byCat.get(c.name) ? ` · ${byCat.get(c.name)}` : ''}</span>`).join('')}</div>` : ''}`
        : `<div class="empty">Describe what the client wants to buy so <b>Find targets</b> can screen the database.<br><br><button class="btn primary" data-x="editProfile">Set the buy box</button></div>`}
    </div>
    <div class="card">
      <h2>Outreach</h2>
      <div class="pc-nums"><div><b>${s.total}</b><span>targets</span></div><div><b>${s.total - s.groups['Not approached']}</b><span>contacted</span></div>
        <div><b style="color:${STAGE_COLORS.Engaged}">${s.groups.Engaged}</b><span>in conversation</span></div><div><b style="color:${STAGE_COLORS.Passed}">${s.groups.Passed}</b><span>passed</span></div></div>
      ${s.total ? stackBar(s.groups, s.total) : ''}
      <div class="stage-list">${Engine.BOARD_STAGES.map(st => { const n = members(proj.name).filter(m => Engine.boardStage(m.p.status) === st).length; return `<div><span>${esc(stageLabel(st, proj))}</span><b>${n}</b></div>`; }).join('')}</div>
      ${due.length ? `<div class="callout" style="margin:12px 0 0"><span>⏰</span><div><b>${due.length} follow-ups due</b></div><span class="spacer"></span><button class="btn sm" data-ptab="followups">Show</button></div>` : ''}
    </div>
  </div>`;
}

// ---------- Buy box editor (inside the project dialog) ----------
function buyBoxFormHtml(p) {
  const b = p.buybox || {};
  const checks = (name, opts, cur) => `<div class="check-row">${opts.map(o => `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}" ${listOf(cur).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
  const cats = (b.categories || []).map(c => `${c.name}: ${c.keywords || ''}${c.description ? ' | ' + c.description : ''}`).join('\n');
  // Industry › sector › sub-sector › niche tree from the Companies filter, as a multi-select (Ctrl / Cmd-click for several).
  const chosen = new Set(b.cls || []);
  const tree = clsFilterHtml('').replace(/<option value="">[^<]*<\/option>/, '').replace(/<optgroup[\s\S]*?<\/optgroup>/, '')
    .replace(/<option value="([^"]*)"/g, (m, v) => chosen.has(v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")) ? `${m} selected` : m);
  const generalist = b.scope === 'any';
  return `<h3>Buy box: what the client wants to acquire</h3>
    <p class="muted small">Used by <b>Find targets</b>. Hard criteria (industry, country, size, founded, ownership, independence, delivery) send a company to the graveyard with the reason; customer type and industries add points.</p>
    <div class="side-pick" style="margin-bottom:10px">
      <label class="check"><input type="radio" name="b_scope" value="theme" ${generalist ? '' : 'checked'}> <b>Thematic</b> <span class="muted small">niches, keywords and categories decide the fit (e.g. a software buyer looking for document automation)</span></label>
      <label class="check"><input type="radio" name="b_scope" value="any" ${generalist ? 'checked' : ''}> <b>Any business (generalist)</b> <span class="muted small">no theme needed: filter on industry, size, founded, ownership and country; ranked on likelihood to sell (e.g. a PE fund or holding that buys anything)</span></label>
    </div>
    <div class="form-grid">
      <label>Acquirer (client) <input name="b_buyer" value="${esc(b.buyer || p.client || '')}" placeholder="e.g. Netcall"></label>
      <label>Countries / regions <input name="b_countries" value="${esc(listOf(b.countries).join('; '))}" placeholder="e.g. Netherlands; DACH; France; Nordics"></label>
      <label class="full">Industries / sectors <span class="muted small">(none = all; Ctrl / Cmd-click to pick several, e.g. Technology › IT services and Business Services)</span>
        <select name="b_cls" multiple size="8" style="width:100%">${tree}</select></label>
      <label>Employees min – max <span class="pair"><input name="b_emp_min" value="${esc(b.emp_min ?? '')}" placeholder="20"><input name="b_emp_max" value="${esc(b.emp_max ?? '')}" placeholder="250"></span></label>
      <label>Revenue min – max (EUR m) <span class="pair"><input name="b_rev_min" value="${esc(b.rev_min ?? '')}" placeholder="3"><input name="b_rev_max" value="${esc(b.rev_max ?? '')}" placeholder="40"></span></label>
      <label>Founded from – to (year) <span class="pair"><input name="b_founded_min" value="${esc(b.founded_min ?? '')}" placeholder="1990"><input name="b_founded_max" value="${esc(b.founded_max ?? '')}" placeholder="2015"></span></label>
      <label class="check" style="align-self:end"><input type="checkbox" name="b_founded_required" ${b.founded_required ? 'checked' : ''}> Exclude companies without a known founding year</label>
      <label class="full">Categories (one per line: <i>name: keywords | description</i>; the description goes on the Technology sheet of the export) <textarea name="b_categories" rows="5" placeholder="Document automation: IDP; document capture; OCR; CCM | Automation of document-heavy processes&#10;CXM / Customer intelligence: contact centre; voice of customer; customer feedback&#10;Process intelligence / BPM: process mining; task mining; BPM&#10;Low-code / workflow automation: low-code; no-code; workflow&#10;iPaaS / integration: integration platform; API management">${esc(cats)}</textarea></label>
      <label class="full">Niches (from the taxonomy, ; separated) <input name="b_niches" list="nicheList" value="${esc((b.niches || []).join('; '))}" placeholder="e.g. Intelligent document processing; Low-code / no-code; Process mining & intelligence"></label>
      <label class="full">Extra keywords <input name="b_keywords" value="${esc(b.keywords || '')}" placeholder="e.g. case management; customer communications; KYC"></label>
      <label class="full">Customer type wanted ${checks('b_segments', Engine.SEGMENTS, b.segments)}</label>
      <label class="full">Customer industries <input name="b_industries" value="${esc(listOf(b.industries).join('; '))}" placeholder="e.g. financial services; insurance; public sector; healthcare"></label>
      <label class="full">Delivery ${checks('b_delivery', DELIVERY_OPTIONS, b.delivery)}</label>
      <label class="full">Ownership allowed <span class="muted small">(none ticked = any)</span> ${checks('b_ownership', OWNERSHIP_OPTIONS, b.ownership)}</label>
      <label class="check"><input type="checkbox" name="b_ownership_required" ${b.ownership_required ? 'checked' : ''}> Exclude companies whose ownership is unknown</label>
      <label class="check"><input type="checkbox" name="b_independent" ${b.independent !== false ? 'checked' : ''}> Independent companies only (exclude subsidiaries)</label>
      <label class="full">Strategic rationale <textarea name="b_description" rows="3" placeholder="What the client is looking for and why">${esc(b.description || '')}</textarea></label>
    </div>
    <datalist id="nicheList">${Taxonomy.NICHES.map(n => `<option value="${esc(n.niche)}">`).join('')}</datalist>`;
}
// Reads the buy box fields from the dialog's FormData.
function readBuyBox(fd) {
  const num = k => { const v = Engine.parseNumber(fd.get(k)); return v == null ? null : v; };
  return {
    buyer: String(fd.get('b_buyer') || '').trim(), countries: listOf(fd.get('b_countries')),
    scope: fd.get('b_scope') === 'any' ? 'any' : 'theme', cls: fd.getAll('b_cls').filter(Boolean),
    founded_min: num('b_founded_min'), founded_max: num('b_founded_max'), founded_required: fd.get('b_founded_required') === 'on', ownership_required: fd.get('b_ownership_required') === 'on',
    emp_min: num('b_emp_min'), emp_max: num('b_emp_max'), rev_min: num('b_rev_min'), rev_max: num('b_rev_max'),
    categories: String(fd.get('b_categories') || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, ...rest] = l.split(':'); const [kw, ...desc] = rest.join(':').split('|'); return { name: name.trim(), keywords: kw.trim(), ...(desc.length ? { description: desc.join('|').trim() } : {}) }; }),
    niches: listOf(fd.get('b_niches')).filter(n => Taxonomy.subsectorOf(n) || true), keywords: String(fd.get('b_keywords') || '').trim(),
    segments: fd.getAll('b_segments'), industries: listOf(fd.get('b_industries')), delivery: fd.getAll('b_delivery'), ownership: fd.getAll('b_ownership'),
    independent: fd.get('b_independent') === 'on', description: String(fd.get('b_description') || '').trim(),
  };
}

// ---------- Target list export in the 33 Equity house format (Project Orion target list v27) ----------
// Same sheets, columns, fonts (Arial 10), colours (theme: navy #1A2B4C, blues #073983 / #0B5ED7), banner, tier
// legend, frozen panes, column widths and status list as the hand-made Orion workbook. ExcelJS is loaded on demand
// (SheetJS community cannot write styles).
const TargetList = (() => {
  const C = { navy: 'FF1A2B4C', slate: 'FF44546A', rule: 'FF54646C', banner: 'FFF2F2F2', grey: 'FFE8E8E8', blue1: 'FF073983', blue2: 'FF0B5ED7', link: 'FF467886', white: 'FFFFFFFF', black: 'FF000000' };
  const FONT = (o = {}) => ({ name: 'Arial', size: 10, color: { argb: C.black }, ...o });
  let loading = null;
  const load = () => window.ExcelJS ? Promise.resolve() : (loading ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.onload = res; s.onerror = () => { loading = null; rej(new Error('Could not load the Excel library (ExcelJS).')); }; document.head.append(s);
  }));

  const client = proj => (proj.buybox?.buyer || proj.client || proj.name || 'Client').trim();
  const STATUS = cl => ['1. Not approached yet', '2. Intro mail sent', '3. Reminder sent', '4. Second reminder sent', '5. NDA sent', '6. Intro with management', `7. Intro with ${cl}`, '8. In conversation', '0. Passed', '0. No contact'];
  const statusOf = (p, cl) => {
    const raw = String(p?.status || '').trim();
    if (/^[0-8]\.\s/.test(raw)) return raw; // already in the house list (imported from a target list)
    const st = Engine.boardStage(raw);
    return { 'Not approached': '1. Not approached yet', 'Teaser sent': '2. Intro mail sent', 'Reminder sent': '3. Reminder sent', 'NDA sent': '8. In conversation', 'NDA signed': '5. NDA sent',
      'Management meeting': '6. Intro with management', Passed: '0. Passed' }[st] || (st ? '8. In conversation' : '1. Not approached yet');
  };
  const LEGEND = cl => [
    `Strong strategic rationale through complementary technology, attractive customer relationships or a strong position in ${cl}'s target sectors and geographies`,
    'Relevant strategic rationale, but with a less compelling technology, customer, sector or geographic angle',
    `Some strategic relevance, but limited differentiation or a weaker rationale for ${cl} ownership`];
  const OWN_SHORT = { 'Private / founder': 'Private', 'PE-backed': 'PE', 'VC-backed': 'VC', Listed: 'Public', Subsidiary: 'Subsidiary' };
  const clientsOf = cu => { const s = cu.segments || []; if (s.includes('SME') && (s.includes('Enterprise') || s.includes('Mid-market'))) return 'SME/Enterprise'; return cu.segment === 'Mixed' ? s.join('/') : cu.segment || ''; };
  const url = w => { const s = String(w || '').trim(); return !s ? '' : /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, ''); };
  const k = v => v == null || v === '' || isNaN(v) ? null : Math.round(Number(v) * 1000 / 100) * 100; // EUR m → EUR k, to 100k
  // "Comment HY" style column: a comment column from an imported list that is neither ours (33E) nor the client's.
  // Comment columns of an imported list are kept as "Comment HY: … | Comment 33E: … | Comment Netcall: …" in remarks
  // (or in extra): split them back into their own columns.
  function commentsOf(p, cl) {
    const map = {}, rest = [];
    for (const [k2, v] of Object.entries(p?.extra || {})) if (/^comment\b/i.test(k2) && v) map[k2.trim()] = String(v);
    for (const seg of String(p?.remarks || '').split(/\s\|\s/)) { const m = seg.match(/^(Comment[^:]{0,30}):\s*([\s\S]*)$/i); if (m) map[m[1].trim()] ??= m[2].trim(); else if (seg.trim()) rest.push(seg.trim()); }
    const keys = Object.keys(map), lc = cl.toLowerCase();
    const ours = keys.find(x => /33\s?e/i.test(x)), theirs = keys.find(x => x.toLowerCase().includes(lc)), adv = keys.find(x => x !== ours && x !== theirs);
    return { c33: [ours ? map[ours] : '', ...rest].filter(Boolean).join(' | '), client: theirs ? map[theirs] : '', advisor: adv ? map[adv] : '' };
  }
  const extraOf = (p, re) => { const e = p?.extra || {}; const key = Object.keys(e).find(x => re.test(x.trim())); return key ? String(e[key]) : ''; };

  // One row of the list. r = a screen row ({ company, tier, category, why, reasons }) or a project member ({ c, p }).
  function rowOf(item, proj) {
    const c = item.company || item.c, p = item.p || (c.projects || []).find(x => x.project === proj.name) || null, cl = client(proj);
    const cu = Engine.customerOf(c), del = Engine.deliveryOf(c), own = Engine.ownershipType(c.ownership) || (c.sponsor_name ? 'PE-backed' : c.parent_name ? 'Subsidiary' : '');
    const rev = c.revenue != null ? c.revenue : c.rev_est?.mid ?? null;
    const pc = (c.contacts || []).find(x => x.email) || (c.contacts || [])[0] || {};
    const com = commentsOf(p, cl);
    const detail = extraOf(p, /^ownership detailed$/i) || [c.sponsor_name ? `${c.sponsor_name}${c.sponsor_since ? ` (${String(c.sponsor_since).slice(0, 4)})` : ''}` : '', c.parent_name ? `Part of ${c.parent_name}` : '', !c.sponsor_name && c.investors ? c.investors : ''].filter(Boolean).join('; ') || (own === 'Listed' ? c.ownership || '' : '');
    return {
      company: c.name || '', website: url(c.website), location: c.country || '', brief: c.short_description || String(c.description || '').slice(0, 220),
      tier: Number(p?.tier || item.tier) || (p?.tier || item.tier || ''),
      score: item.score ?? (Number(String(p?.rationale || '').match(/^Fit (\d+)/)?.[1]) || null),
      researched: c.research?.level >= 2 || c.enrichment ? 'Yes' : 'No',
      founded: Number(c.founded) || c.founded || '',
      technology: p?.category || item.category || categoryOf(c, proj.buybox?.categories) || c.niche || '', delivery: del || '',
      sector: cu.industries || (cu.segments?.length ? 'Agnostic' : ''), clients: clientsOf(cu), empl: Engine.parseNumber(c.linkedin_employees ?? c.employees ?? extraOf(p, /^#?\s*empl/i)) ?? '',
      revenue: k(rev), ebitda: k(c.ebitda), ownership: own === 'Listed' && c.ticker ? `Public (${c.ticker})` : OWN_SHORT[own] || (own === 'Other' ? c.ownership || '' : ''), ownDetail: detail,
      cAdvisor: com.advisor, c33: com.c33 || p?.rationale || (item.why ? item.why.slice(0, 4).join('; ') : ''), cClient: com.client,
      extended: c.summary || extraOf(p, /^extended description$/i) || c.description || '', responsible: p?.responsible || '', contact: pc.name || '', func: pc.title || '', email: pc.email || '',
      last: p?.last_contact ? new Date(p.last_contact) : null, status: statusOf(p, cl), log: p?.log || '',
      reason: (item.reasons || []).join('; ') || String(p?.pass_reason || '').replace(/^Excluded:\s*/, ''),
    };
  }

  const banner = (ws, title, lastCol) => {
    ws.getRow(1).height = 6; ws.getRow(2).height = 22.8;
    for (let col = 1; col <= lastCol; col++) for (const r of [1, 2]) {
      const cell = ws.getCell(r, col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.banner } }; cell.font = FONT({ color: { argb: C.slate } });
      if (r === 2) cell.border = { bottom: { style: 'medium', color: { argb: C.rule } } };
    }
    const t = ws.getCell(2, 1); t.value = title; t.font = FONT({ size: 20, bold: true, color: { argb: C.navy } }); t.alignment = { vertical: 'middle' };
  };
  const navyHead = (cell, text) => { cell.value = text; cell.font = FONT({ bold: true, color: { argb: C.white } }); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } }; cell.alignment = { horizontal: 'left', vertical: 'middle' }; };

  // Main sheet and graveyard share the column set; the graveyard adds "Reason for exclusion" (like Graveyard 2).
  function listSheet(wb, name, title, rows, proj, { graveyard = false } = {}) {
    const cl = client(proj);
    const cols = [
      ['#', 'n', 4.1, 'center'], ['Company', 'company', 27.9], ['Website', 'website', graveyard ? 28.7 : 9.2], ['Location', 'location', 13.2, null, true], ['Brief description', 'brief', graveyard ? 33.2 : 83.7],
      ['Tier ', 'tier', 10.6, 'center'], ['Fit score', 'score', 9.5, 'center'], ['Researched', 'researched', 11, 'center'], ...(graveyard ? [['Comment HY', 'cAdvisor', 13]] : []), ['Founded', 'founded', graveyard ? 9.9 : 10.6, 'center'], ['Technology', 'technology', 27.6], ['Delivery', 'delivery', 17.3],
      ['Sector focus', 'sector', 20], ['Clients', 'clients', 13.9], ['#empl.', 'empl', 8, 'center'], ['Revenue', 'revenue', 13.1, 'center'], ['EBITDA', 'ebitda', 13.1, 'center'],
      ['Ownership', 'ownership', 15.3, 'center'], ['Ownership detailed ', 'ownDetail', 30],
      ...(graveyard ? [] : [['Comment HY', 'cAdvisor', 22.7]]), ['Comment 33E', 'c33', 60], [`Comment ${cl}`, 'cClient', 45], ['Extended description', 'extended', 80],
      ...(graveyard ? [['Reason for exclusion', 'reason', 40]] : [['Responsible', 'responsible', 10.2, 'center', false, 'b1', true], ['Contact Name', 'contact', 30.1, null, false, 'b1'], ['Function ', 'func', 22, null, false, 'b1'],
        ['E-mail', 'email', 30.3, null, false, 'b1'], ['Date of last contact/note', 'last', 28.4, 'center', false, 'b2'], ['Status', 'status', 27.4, null, false, 'b2'], ['Log', 'log', 38.4, null, false, 'b2', true]]),
    ];
    const ws = wb.addWorksheet(name, { properties: { tabColor: graveyard ? undefined : { argb: C.navy } }, views: [graveyard ? { showGridLines: false, zoomScale: 115 } : { state: 'frozen', xSplit: 2, ySplit: 10, showGridLines: false, zoomScale: 85, topLeftCell: 'C11' }] });
    const head = graveyard ? 5 : 10, fin = head - 1, last = cols.length;
    ws.columns = cols.map(c => ({ width: c[2] }));
    banner(ws, title, last + 1);
    if (!graveyard) {
      ws.getRow(4).height = 13.05;
      navyHead(ws.getCell('B4'), 'Tier'); navyHead(ws.getCell('C4'), 'Description'); for (const a of ['D4', 'E4', 'F4', 'G4', 'H4']) navyHead(ws.getCell(a), '');
      LEGEND(cl).forEach((t, i) => { ws.getCell(5 + i, 2).value = i + 1; ws.getCell(5 + i, 3).value = t; for (const col of [2, 3]) { ws.getCell(5 + i, col).font = FONT(); ws.getCell(5 + i, col).alignment = { horizontal: 'left', vertical: 'middle' }; } });
    }
    // "Financial estimates in EUR k" over Revenue / EBITDA (centred across both).
    const revCol = cols.findIndex(c => c[1] === 'revenue') + 1;
    ws.getRow(fin).height = 13.05;
    for (const col of [revCol, revCol + 1]) { const cell = ws.getCell(fin, col); cell.value = col === revCol ? 'Financial estimates in EUR k' : null; cell.font = FONT({ bold: true }); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.grey } }; cell.alignment = { horizontal: 'centerContinuous', vertical: 'middle' }; }
    // Header row.
    const hr = ws.getRow(head); hr.height = 22.2;
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1); cell.value = i === 0 ? null : c[0]; cell.font = FONT({ bold: true }); cell.alignment = { horizontal: c[3] || undefined, vertical: 'middle' };
      if (c[5]) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c[5] === 'b1' ? C.blue1 : C.blue2 } }; cell.border = { left: { style: 'hair' }, right: c[5] === 'b1' ? { style: 'hair' } : undefined }; }
    });
    // Data rows.
    rows.forEach((r, i) => {
      const row = ws.getRow(head + 1 + i); row.height = 13.2;
      cols.forEach((c, j) => {
        const cell = row.getCell(j + 1); let v = c[1] === 'n' ? i + 1 : r[c[1]];
        if (v === '' || v == null) v = null;
        if (c[1] === 'website' && v) v = { text: v, hyperlink: v };
        cell.value = v;
        cell.font = FONT({ bold: !!c[6], color: { argb: c[1] === 'website' || (c[1] === 'email' && v) ? C.link : C.black } });
        cell.alignment = { horizontal: c[3] || undefined, vertical: 'middle', wrapText: !!c[4] || undefined };
        if (c[1] === 'last') cell.numFmt = 'm/d/yyyy';
      });
    });
    // Status drop-down from the (hidden) Status sheet, like the original.
    const statusCol = cols.findIndex(c => c[1] === 'status') + 1;
    if (statusCol > 0) for (let r = head + 1; r <= head + Math.max(rows.length, 1) + 50; r++) ws.getCell(r, statusCol).dataValidation = { type: 'list', allowBlank: true, formulae: ['Status!$B$3:$B$12'] };
    return ws;
  }

  function technologySheet(wb, proj) {
    const ws = wb.addWorksheet('Technology', { properties: { tabColor: { argb: C.slate } }, views: [{ showGridLines: false, zoomScale: 130 }] });
    ws.columns = [{ width: 2.2 }, { width: 32.7 }, { width: 56.3 }, { width: 8.3 }];
    const t = ws.getCell('B2'); t.value = 'Technology'; t.font = FONT({ bold: true });
    navyHead(ws.getCell('B4'), 'Category'); navyHead(ws.getCell('C4'), 'Description'); navyHead(ws.getCell('D4'), '');
    (proj.buybox?.categories || []).forEach((c, i) => {
      const r = ws.getRow(5 + i); r.height = 13.3;
      r.getCell(2).value = c.name; r.getCell(3).value = c.description || c.keywords || '';
      for (const col of [2, 3]) { r.getCell(col).font = FONT(); r.getCell(col).alignment = { vertical: 'middle' }; }
    });
  }

  function statusSheet(wb, proj) {
    const ws = wb.addWorksheet('Status', { state: 'hidden' });
    ws.columns = [{ width: 0.7 }, { width: 23.4 }];
    ws.getCell('B2').value = 'Status'; ws.getCell('B2').font = FONT({ bold: true });
    STATUS(client(proj)).forEach((s, i) => { const cell = ws.getCell(3 + i, 2); cell.value = s; cell.font = FONT(); cell.alignment = { horizontal: 'left' }; });
  }

  // fits / graveyard: arrays of screen rows or project members.
  async function download(proj, fits, graveyard, label = 'Target list') {
    await load();
    const cl = client(proj), name = proj.name || 'Project';
    const wb = new ExcelJS.Workbook(); wb.creator = '33 Equity'; wb.created = new Date();
    const order = (a, b) => (Number(a.tier) || 9) - (Number(b.tier) || 9) || (b.score ?? -1) - (a.score ?? -1) || a.company.localeCompare(b.company);
    listSheet(wb, `Target list - ${cl}`.slice(0, 31), `Project ${name} - target list`, fits.map(x => rowOf(x, proj)).sort(order), proj);
    technologySheet(wb, proj);
    listSheet(wb, 'Graveyard', `Project ${name} - graveyard`, graveyard.map(x => rowOf(x, proj)), proj, { graveyard: true });
    statusSheet(wb, proj);
    const buf = await wb.xlsx.writeBuffer();
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `${ymd} Project ${name} - ${label}.xlsx`.replace(/[\\/:*?"<>|]+/g, '-'); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return { fits: fits.length, graveyard: graveyard.length, file: a.download, buffer: buf };
  }

  // The project's own targets: active ones on the list, passed / excluded ones in the graveyard.
  const isOut = p => Engine.boardStage(p.status) === 'Passed' || /^0\.\s*Passed/i.test(String(p.status || '')) || !!String(p.pass_reason || '').trim();
  // Fit scores for the project's own targets: the same match against the buy box as Find targets.
  const fromProject = proj => {
    const m = members(proj.name);
    if (hasBuyBox(proj)) { const sc = new Map(Engine.match(buyDealOf(proj), m.map(x => x.c), state.weights).map(r => [r.company.id, r.score])); m.forEach(x => { x.score = sc.get(x.c.id) ?? null; }); }
    return download(proj, m.filter(x => !isOut(x.p)), m.filter(x => isOut(x.p)));
  };
  // The Find targets screen: ticked fits (or the top N shown) and the top of the graveyard.
  const fromScreen = proj => { const { fits, excluded } = screenTargets(proj); const pick = tf.picked.size ? fits.filter(r => tf.picked.has(r.company.id)) : fits.filter(r => !tf.cat || r.category === tf.cat).slice(0, tf.limit); return download(proj, pick, excluded.slice(0, tf.limit), 'Target screen'); };
  return { download, fromProject, fromScreen, rowOf, load };
})();

// ---------- Events (Find targets tab) ----------
$('#projectsView').addEventListener('click', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  if (!proj || !isBuy(proj)) return;
  const tv = e.target.closest('[data-tview]');
  if (tv) { tf.view = tv.dataset.tview; tf.reason = ''; return renderProjects(); }
  const y = e.target.closest('[data-y]')?.dataset.y;
  if (y === 'pickTop') { const { fits, excluded } = screenTargets(proj); (tf.view === 'fits' ? fits : excluded).filter(r => !tf.cat || r.category === tf.cat).slice(0, 50).forEach(r => tf.picked.add(r.company.id)); return renderProjects(); }
  if (y === 'exportScreen') { toast('Building the target list…'); return TargetList.fromScreen(proj).then(r => toast(`✓ Exported ${r.fits} targets and ${r.graveyard} in the graveyard.`, 5000)).catch(err => toast('Export failed: ' + err.message, 6000)); }
  if (y === 'addPicked') { if (!tf.picked.size) return toast('Tick the targets to add first.'); addTargets(proj, [...tf.picked]); return renderProjects(); }
  if (e.target.dataset.tpick) { e.target.checked ? tf.picked.add(e.target.dataset.tpick) : tf.picked.delete(e.target.dataset.tpick); const b = $('[data-y=addPicked]'); if (b) b.textContent = `Add ${tf.picked.size || 'selected'} to ${proj.name}`; }
});
$('#projectsView').addEventListener('change', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  if (!proj || !isBuy(proj)) return;
  if (e.target.id === 'tfCat') { tf.cat = e.target.value; renderProjects(); }
  if (e.target.id === 'tfReason') { tf.reason = e.target.value; renderProjects(); }
  if (e.target.id === 'tfLimit') { tf.limit = Math.max(10, Number(e.target.value) || 150); renderProjects(); }
});
