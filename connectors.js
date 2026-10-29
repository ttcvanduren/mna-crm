/* global Engine, Store, state, byId, esc, toast, touch, flush, migrate, renderCompanies, renderDrawer, downloadJson, saveSettingsLocal */
// Connectors: optional data sources. Everything works without them; each one adds data when configured.
// Apollo can be used three ways: CSV export import (no setup), Claude Code with the Apollo connector (subscription),
// or the Apollo API through a small proxy (supabase/functions/apollo) so the key never reaches the browser.

// Who to look for at a buyer, mapped to Apollo title keywords.
const PERSONAS = {
  'M&A / Corp Dev': ['Head of M&A', 'M&A', 'Mergers and Acquisitions', 'Corporate Development', 'Head of Corporate Development', 'VP Corporate Development', 'Director Corporate Development'],
  Strategy: ['Chief Strategy Officer', 'Head of Strategy', 'Strategy Director', 'VP Strategy'],
  'CEO / MD': ['CEO', 'Chief Executive Officer', 'Managing Director', 'Geschäftsführer', 'President'],
  CFO: ['CFO', 'Chief Financial Officer', 'Group CFO', 'Finance Director'],
  Founder: ['Founder', 'Co-Founder', 'Owner'],
  'PE investment team': ['Partner', 'Managing Partner', 'Principal', 'Investment Director', 'Investment Manager'],
  'Business Development': ['Head of Business Development', 'Business Development Director', 'VP Business Development'],
};
const DEFAULT_PERSONAS = ['M&A / Corp Dev', 'Strategy', 'CEO / MD', 'CFO', 'PE investment team'];
const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director'];
const personasOn = () => state.settings.apolloPersonas?.length ? state.settings.apolloPersonas : DEFAULT_PERSONAS;
const apolloConfigured = () => !!state.settings.apolloProxyUrl;

// ---------- People files (Claude Code + Apollo connector, or any other source) ----------
function exportPeopleRequest(ids) {
  const companies = ids.map(byId).filter(Boolean).map(c => ({
    id: c.id, name: c.name, website: c._domain || c.website || '', country: c.country || '', role: c.role || '',
    known_people: c.contacts.map(x => [x.name, x.title, x.email ? 'has email' : ''].filter(Boolean).join(' – ')).slice(0, 8),
  }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  downloadJson({ type: 'mna-crm-people-request', version: 1, created: new Date().toISOString(), personas: personasOn(), titles: personasOn().flatMap(p => PERSONAS[p] || []), max_per_company: Number(state.settings.apolloPerCompany) || 3, companies }, `people-request-${stamp}.json`);
  toast(`Exported ${companies.length} companies. Ask Claude Code to find the decision makers with Apollo, then use ✦ Import research.`, 8000);
}

// Adds people to a company: matched on Apollo ID, email, LinkedIn or name; never overwrites a verified email.
function addPeople(c, people, source) {
  let added = 0;
  for (const raw of people || []) {
    const person = {
      name: raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' '), title: raw.title || '',
      email: (raw.email || '').toLowerCase(), email_status: (raw.email_status || '').toLowerCase(), linkedin: raw.linkedin_url ? Engine.cleanUrl(raw.linkedin_url) : (raw.linkedin || ''),
      phone: raw.phone || '', seniority: raw.seniority || '', department: [].concat(raw.departments || raw.department || []).join(', '), apollo_id: raw.apollo_id || raw.id || '',
    };
    if (!person.name && !person.email) continue;
    person.role_tag = Engine.inferRoleTag(person.title);
    const same = c.contacts.find(x => (person.apollo_id && x.apollo_id === person.apollo_id) || (person.email && x.email === person.email) || (person.linkedin && x.linkedin && Engine.linkedinKey(x.linkedin) === Engine.linkedinKey(person.linkedin)) || (person.name && Engine.personKey(x.name) === Engine.personKey(person.name)));
    if (same) {
      for (const [k, v] of Object.entries(person)) if (v && !same[k]) same[k] = v;
      if (person.email && person.email_status === 'verified' && same.email_status !== 'verified') { same.email = person.email; same.email_status = 'verified'; }
      same.source ??= source;
    } else { c.contacts.push({ ...person, source, verified_at: new Date().toISOString() }); added++; }
  }
  touch(c);
  return added;
}

async function importPeopleFile(d) {
  const idx = Engine.buildIndex(state.companies);
  let companies = 0, people = 0;
  for (const it of d.companies || []) {
    const c = (it.id && byId(it.id)) || Engine.findDuplicates({ name: it.name || '', website: it.website || '' }, idx).exact[0];
    if (!c) continue;
    people += addPeople(c, it.people, d.source || 'Apollo');
    companies++;
  }
  await flush();
  renderCompanies();
  if (state.drawer) renderDrawer();
  toast(`People imported: ${people} new contacts at ${companies} companies.`, 7000);
}

// ---------- Acquisition track records (research files from Claude Code) ----------
const acqKey = a => Engine.normName(a.target || '');
const acqDate = a => String(a.date || a.year || '');
// Merges researched deals into a company: new deals are added, known ones get missing details filled.
function mergeAcquisitions(c, list) {
  c.acquisitions ??= [];
  let added = 0;
  for (const a of list || []) {
    if (!a.target) continue;
    const same = c.acquisitions.find(x => acqKey(x) === acqKey(a));
    if (same) { for (const [k, v] of Object.entries(a)) if (v && !same[k]) same[k] = v; }
    else { c.acquisitions.push({ ...a, year: a.year || acqDate(a).slice(0, 4) }); added++; }
  }
  c.acquisitions.sort((x, y) => acqDate(y).localeCompare(acqDate(x)));
  return added;
}
async function importAcquisitions(d) {
  const idx = Engine.buildIndex(state.companies);
  let companies = 0, deals = 0;
  for (const it of d.companies || []) {
    const c = (it.id && byId(it.id)) || Engine.findDuplicates({ name: it.name || '', website: it.website || '' }, idx).exact[0];
    if (!c) continue;
    deals += mergeAcquisitions(c, it.acquisitions);
    if (it.acquisitive && it.acquisitive !== 'unknown') c.acquisitive = it.acquisitive;
    if (it.notes) c.acq_notes = it.notes;
    c.acq_checked_at = d.created || new Date().toISOString();
    touch(c);
    companies++;
  }
  await flush();
  renderCompanies();
  if (state.drawer) renderDrawer();
  toast(`Acquisitions imported: ${deals} deals for ${companies} companies.`, 7000);
}

// ---------- Apollo API via proxy ----------
async function apollo(path, query, body) {
  const url = state.settings.apolloProxyUrl;
  if (!url) throw new Error('Set up the Apollo proxy in Settings → Connectors first.');
  const headers = { 'Content-Type': 'application/json' };
  const token = await Store.accessToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path, query, body }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apollo ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
const qs = obj => Object.entries(obj).flatMap(([k, v]) => [].concat(v).map(x => `${encodeURIComponent(k)}=${encodeURIComponent(x)}`)).join('&');

// Free search: people at the company's domain with the chosen titles and seniorities.
async function apolloSearch(c) {
  const domain = c._domain || Engine.domainOf(c.website);
  if (!domain) throw new Error(`${c.name} has no website, so Apollo can't search it.`);
  const titles = personasOn().flatMap(p => PERSONAS[p] || []);
  const r = await apollo('mixed_people/api_search', qs({ 'q_organization_domains_list[]': domain, 'person_titles[]': titles, 'person_seniorities[]': SENIORITIES, include_similar_titles: 'true', per_page: 25, page: 1 }));
  const rank = t => Engine.OUTREACH_PRIORITY.indexOf(Engine.inferRoleTag(t));
  return (r.people || []).map(p => ({ id: p.id, name: [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(' '), title: p.title || '', has_email: !!p.has_email, org: p.organization?.name || '' }))
    .sort((a, b) => rank(a.title) - rank(b.title));
}
// Paid step: 1 credit per person with a found email.
async function apolloReveal(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const r = await apollo('people/bulk_match', 'reveal_personal_emails=false', { details: ids.slice(i, i + 10).map(id => ({ id })) });
    out.push(...(r.matches || r.people || []).filter(Boolean));
  }
  return out;
}

// Drawer: find decision makers for one company.
async function findDecisionMakers(id) {
  const c = byId(id);
  if (!apolloConfigured()) return exportPeopleRequest([id]);
  try {
    toast('Searching Apollo (free)…');
    const found = await apolloSearch(c);
    if (!found.length) return toast(`Apollo found nobody with these titles at ${c.name}.`, 6000);
    const known = new Set(c.contacts.map(x => Engine.personKey(x.name)));
    const dlg = $('#stageDialog');
    dlg._ctx = { kind: 'apollo', id };
    $('#stageForm').innerHTML = `<h2>Decision makers at ${esc(c.name)} <span class="muted small">via Apollo</span></h2>
      <p class="muted small">Searching is free. Revealing an email costs 1 Apollo credit per person (nothing is charged if none is found). Only verified emails are used for outreach.</p>
      <div class="table-wrap" style="max-height:50vh"><table class="compact"><thead><tr><th></th><th>Name</th><th>Title</th><th>Department</th><th>Email available</th></tr></thead><tbody>
      ${found.map((p, i) => `<tr><td><input type="checkbox" name="pick" value="${esc(p.id)}" ${i < (Number(state.settings.apolloPerCompany) || 3) && p.has_email && !known.has(Engine.personKey(p.name)) ? 'checked' : ''}></td>
        <td>${esc(p.name)}${known.has(Engine.personKey(p.name)) ? ' <span class="chip">already in CRM</span>' : ''}</td><td>${esc(p.title)}</td><td><span class="tag k">${esc(Engine.inferRoleTag(p.title))}</span></td><td>${p.has_email ? '✓' : '<span class="muted">–</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="toolbar" style="margin-top:12px"><span class="spacer"></span><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="save">Reveal emails & add</button></div>`;
    dlg.showModal();
  } catch (err) { toast(err.message, 8000); }
}
async function revealPicked(ctx, ids) {
  const c = byId(ctx.id);
  if (!ids.length) return;
  try {
    const people = await apolloReveal(ids);
    const n = addPeople(c, people.map(p => ({ ...p, apollo_id: p.id })), 'Apollo');
    await flush();
    renderCompanies();
    renderDrawer();
    toast(`Added ${n} people from Apollo (${people.filter(p => p.email).length} with email).`, 6000);
  } catch (err) { toast(err.message, 8000); }
}

// Bulk: best N people per selected company. Search is free; confirm before spending credits.
async function apolloBulk(ids) {
  if (!apolloConfigured()) return exportPeopleRequest(ids);
  const per = Number(state.settings.apolloPerCompany) || 2;
  const list = ids.map(byId).filter(c => c && (c._domain || c.website));
  if (!confirm(`Find up to ${per} decision makers at ${list.length} companies with Apollo?\n\nSearching is free; revealing emails costs up to ${list.length * per} credits.`)) return;
  let added = 0, credits = 0;
  for (const [i, c] of list.entries()) {
    toast(`Apollo ${i + 1}/${list.length}: ${c.name}…`, 2000);
    try {
      const known = new Set(c.contacts.filter(x => x.email).map(x => Engine.personKey(x.name)));
      const pick = (await apolloSearch(c)).filter(p => p.has_email && !known.has(Engine.personKey(p.name))).slice(0, per);
      if (!pick.length) continue;
      const people = await apolloReveal(pick.map(p => p.id));
      credits += people.filter(p => p.email).length;
      added += addPeople(c, people.map(p => ({ ...p, apollo_id: p.id })), 'Apollo');
    } catch (err) { console.warn(c.name, err); if (/40[13]|429/.test(err.message)) { toast(err.message, 8000); break; } }
  }
  await flush();
  renderCompanies();
  toast(`Apollo done: ${added} people added, about ${credits} credits used.`, 8000);
}

// ---------- Settings: connector cards ----------
function renderConnectors() {
  const s = state.settings;
  const row = (name, on, body) => `<div class="connector"><div class="cn-head"><b>${name}</b><span class="chip ${on ? 'green' : ''}">${on ? 'Connected' : 'Not connected'}</span></div>${body}</div>`;
  $('#connectors').innerHTML = `
    ${row('Apollo: people & verified emails', apolloConfigured(), `
      <p class="muted small">Find CEO, CFO, Corp Dev / M&A and strategy people at buyers. Three ways, from simplest:</p>
      <ol class="small">
        <li><b>CSV export</b>: in Apollo, export a people list, then use <b>Import Excel / CSV</b>. Columns like Email Status, Seniority and Person Linkedin Url are recognised and people are added to the right company.</li>
        <li><b>Claude Code</b> (free with your subscription): select companies → <b>Find people</b> → give the file to Claude Code with the Apollo connector (<code>/mcp</code> → Apollo). Import the result with <b>✦ Import research</b>.</li>
        <li><b>Apollo API</b>: deploy <code>supabase/functions/apollo</code> (see README) and paste its URL here. Then <b>Find decision makers</b> works directly in the app.</li>
      </ol>
      <label>Apollo proxy URL <input id="apolloProxyUrl" value="${esc(s.apolloProxyUrl || '')}" placeholder="https://xxxx.supabase.co/functions/v1/apollo"></label>
      <label class="row-label">People per company <input type="number" id="apolloPerCompany" min="1" max="10" value="${Number(s.apolloPerCompany) || 3}" style="width:60px"></label>
      <div class="small"><b>Look for:</b></div>
      <div class="chips" id="personaChips">${Object.keys(PERSONAS).map(p => `<span class="chip ${personasOn().includes(p) ? 'blue' : 'off'}" data-persona="${esc(p)}">${esc(p)}</span>`).join('')}</div>
      <div class="toolbar" style="margin-top:10px"><button class="btn primary" id="saveApollo">Save</button><button class="btn" id="testApollo" ${apolloConfigured() ? '' : 'disabled'}>Test connection</button></div>`)}
    ${row('Claude research', !!s.anthropicKey, '<p class="muted small">Free via Claude Code (<b>Export for research</b>) or paid via the API key under Claude research.</p>')}
    ${row('Microsoft Outlook', !!s.clientId, '<p class="muted small">Drafts and sending from your mailbox. Set up under Microsoft / Outlook.</p>')}
    ${row('Team database (Supabase)', Store.mode === 'cloud', '<p class="muted small">Shared data for the whole team. Set up under Team database.</p>')}
    ${row('Capital IQ', true, '<p class="muted small">Export a screen to Excel and use <b>Import Excel / CSV</b>; the columns are recognised automatically.</p>')}`;
}
$('#connectors').addEventListener('click', async e => {
  const p = e.target.dataset.persona;
  if (p) {
    const on = new Set(personasOn());
    on.has(p) ? on.delete(p) : on.add(p);
    state.settings.apolloPersonas = [...on];
    saveSettingsLocal();
    return renderConnectors();
  }
  if (e.target.id === 'saveApollo') {
    state.settings.apolloProxyUrl = $('#apolloProxyUrl').value.trim();
    state.settings.apolloPerCompany = Number($('#apolloPerCompany').value) || 3;
    saveSettingsLocal();
    renderConnectors();
    toast('Apollo settings saved.');
  }
  if (e.target.id === 'testApollo') {
    try { await apollo('mixed_people/api_search', qs({ 'q_organization_domains_list[]': 'apollo.io', 'person_titles[]': 'CEO', per_page: 1 })); toast('Apollo connection works ✓'); }
    catch (err) { toast(err.message, 8000); }
  }
});
