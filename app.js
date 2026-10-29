/* global Engine, Enricher, Store, XLSX, msal */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEFAULT_TEMPLATE = {
  id: 'default',
  name: 'Anonymous buyer approach',
  subject: 'Acquisition opportunity: {{deal_sector}} business in {{deal_country}}',
  body: `Dear {{first_name}},

We are advising the shareholders of a {{deal_sector}} business based in {{deal_country}} with revenues of approximately {{deal_revenue}}.

Given {{company}}'s activities in {{sector}}, we believe this could be an interesting add-on or platform opportunity for you.

If of interest, we would be happy to share a short anonymous teaser and, after signing an NDA, further information.

Kind regards,

{{sender_name}}`,
};

// Personal settings stay in this browser; the company data and templates are shared via Store.
const SETTINGS_KEY = 'crm.settings';
const DEFAULT_SETTINGS = {
  clientId: '', tenantId: 'organizations', senderName: '', delaySec: 3,
  anthropicKey: '', enrichModel: Enricher.DEFAULT_MODEL, enrichParallel: 2, enrichSkipDays: 90, spend: { usd: 0, count: 0 },
};
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
const saveSettingsLocal = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));

const state = {
  companies: [],
  templates: [DEFAULT_TEMPLATE],
  activity: [],
  projects: [],
  projectView: null,
  settings: loadSettings(),
  weights: { ...Engine.DEFAULT_WEIGHTS },
  mappingMemory: {},
  campaign: { dealId: null, recipientIds: [] },
  contactChoice: {},
  matches: [],
  selected: new Set(), // match engine selection
  picked: new Set(), // companies tab selection
  roleFilter: new Set(),
  previewId: null,
  sort: { key: 'name', dir: 1 },
  limit: 200,
  drawer: null, // { id, tab }
  queue: null,
};

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const byId = id => state.companies.find(c => c.id === id);

// Older saves had one flat contact per company.
function migrate(c) {
  if (!Array.isArray(c.contacts)) {
    c.contacts = [];
    if (c.contact_name || c.email) c.contacts.push({ name: c.contact_name || '', title: c.contact_title || '', email: c.email || '', phone: c.phone || '' });
    ['contact_name', 'contact_title', 'email', 'phone'].forEach(k => delete c[k]);
  }
  c.projects ??= [];
  c.sources ??= [];
  c._norm = Engine.normName(c.name);
  c._domain = Engine.domainOf(c.website);
  return c;
}
function newCompany(name) {
  return migrate({ id: uid(), name, created: new Date().toISOString(), status: 'New', contacts: [], projects: [], sources: [] });
}

// ---------- Saving ----------
const dirty = new Set();
let flushTimer = null;
function touch(...cs) {
  cs.forEach(c => c && dirty.add(c.id));
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 500);
}
async function flush() {
  if (!dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  setSync('Saving…');
  try {
    await Store.saveCompanies(ids.map(byId).filter(Boolean), state.companies);
    setSync('All changes saved');
  } catch (err) {
    ids.forEach(id => dirty.add(id));
    setSync('Save failed – retrying', true);
    toast('Could not save: ' + err.message, 6000);
    flushTimer = setTimeout(flush, 8000);
  }
}
async function removeCompanies(ids) {
  const drop = new Set(ids);
  state.companies = state.companies.filter(c => !drop.has(c.id));
  ids.forEach(id => { dirty.delete(id); state.picked.delete(id); state.selected.delete(id); });
  try { await Store.deleteCompanies(ids, state.companies); } catch (err) { toast('Could not delete: ' + err.message, 6000); }
}
const sharedTimers = {};
function saveShared(key, value) {
  clearTimeout(sharedTimers[key]);
  sharedTimers[key] = setTimeout(() => Store.setState(key, value).catch(err => toast('Could not save settings: ' + err.message)), 600);
}
function setSync(text, bad) {
  const where = Store.mode === 'cloud' ? `Team database${Store.user ? ' · ' + Store.user.email : ''}` : 'This browser only';
  $('#syncStatus').innerHTML = `<span style="color:${bad ? '#f97066' : '#32d583'}">●</span> ${esc(where)}<br><span>${esc(text || '')}</span>`;
}
window.addEventListener('beforeunload', e => { if (dirty.size) { flush(); e.preventDefault(); } });

// ---------- Tabs ----------
function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'projects') renderProjects();
  if (name === 'companies') renderCompanies();
  if (name === 'email') renderEmail();
  if (name === 'activity') renderActivity();
  if (name === 'match') runMatch();
}
$$('.tab').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'projects') state.projectView = null; showTab(b.dataset.tab); }));

// ---------- Small renderers ----------
const initials = s => (norm(s).match(/[A-Za-z0-9]/g) || ['?']).slice(0, 2).join('').toUpperCase();
function logo(c, lg) {
  const d = c._domain || Engine.domainOf(c.website);
  const i = esc(initials(c.name));
  return `<span class="co-logo ${lg ? 'lg' : ''}" data-i="${i}">${d ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64" alt="" loading="lazy" onerror="this.parentNode.textContent=this.parentNode.dataset.i">` : i}</span>`;
}
const roleChip = r => r ? `<span class="chip role-${esc(r)}">${esc(r)}</span>` : '';
const money = (c, v) => v == null || v === '' ? '' : `${c.currency && c.currency !== 'EUR' ? c.currency + ' ' : '€'}${Engine.fmt(v)}m`;
const employeesOf = c => c.linkedin_employees ?? c.employees ?? null;
const KEY_TAGS = new Set(['CEO', 'CFO', 'Corporate Development', 'M&A', 'Strategy']);
const tagShort = t => ({ 'Corporate Development': 'CorpDev', Strategy: 'Strat' }[t] || t);
const projectChips = c => (c.projects || []).filter(p => p.project).map(p => `<span class="chip ${STAGE_CHIP[Engine.stageGroup(p.status)]}" title="${esc([p.status, p.last_contact, p.responsible].filter(Boolean).join(' · '))}">${esc(p.project)}${p.status ? ': ' + esc(p.status.slice(0, 22)) : ''}</span>`).join('');
const daysAgo = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const ago = iso => { const d = daysAgo(iso); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`; };
const contactText = c => (c.contacts || []).map(x => [x.name, x.title, x.email].join(' ')).join(' ');

// ---------- Companies list ----------
function filteredCompanies() {
  const q = $('#search').value.toLowerCase().trim();
  const role = $('#filterRole').value, project = $('#filterProject').value, country = $('#filterCountry').value;
  const enr = $('#filterEnriched').value, email = $('#filterEmail').checked, multi = $('#filterMulti').checked;
  const sector = $('#filterSector').value, own = $('#filterOwnership').value;
  const [smin, smax] = ($('#filterSize').value || '-').split('-').map(v => (v === '' ? null : Number(v)));
  const list = state.companies.filter(c =>
    (!role || c.role === role) &&
    (!project || c.projects.some(p => p.project === project)) &&
    (!country || c.country === country) &&
    (!sector || c.sector === sector) &&
    (!own || Engine.ownershipType(c.ownership) === own) &&
    (smin == null && smax == null || (employeesOf(c) != null && (smin == null || employeesOf(c) >= smin) && (smax == null || employeesOf(c) < smax))) &&
    (!multi || c.projects.length > 1) &&
    (!$('#filterAcq').checked || (c.acquisitions || []).length >= 3) &&
    (!enr || (enr === 'yes') === !!c.enrichment) &&
    (!email || Engine.hasEmail(c)) &&
    (!q || [c.name, (c.aliases || []).join(' '), c.website, c.sector, c.subsector, c.country, c.ownership, c.keywords, (c.tags || []).join(' '), c.short_description, c.summary, c.description, contactText(c)].join(' ').toLowerCase().includes(q)));
  const { key, dir } = state.sort;
  const val = c => key === 'employees' ? employeesOf(c) : key === 'revenue' ? c.revenue : key === 'people' ? c.contacts.length : key === 'deals' ? (c.acquisitions || []).length : key === 'enriched' ? c.enrichment?.at || '' : String(c[key] || '').toLowerCase();
  return list.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || x === '') return 1;
    if (y == null || y === '') return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir;
  });
}

function renderCompanies() {
  const list = filteredCompanies();
  const shown = list.slice(0, state.limit);
  $('#companyCount').textContent = `${list.length.toLocaleString()} of ${state.companies.length.toLocaleString()} companies`;
  $$('#companyTable th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === state.sort.key);
    th.classList.toggle('asc', th.dataset.sort === state.sort.key && state.sort.dir === 1);
  });
  $('#companyTable tbody').innerHTML = shown.map(c => {
    const tags = [...new Set(c.contacts.map(x => x.role_tag).filter(t => KEY_TAGS.has(t)))];
    const emails = c.contacts.filter(x => x.email).length;
    const emp = employeesOf(c);
    return `<tr data-id="${c.id}" class="${state.picked.has(c.id) ? 'sel' : ''}">
      <td class="cb"><input type="checkbox" data-pick="${c.id}" ${state.picked.has(c.id) ? 'checked' : ''}></td>
      <td>${companyCell(c)}</td>
      <td>${roleChip(c.role)}</td>
      <td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${emp != null ? Engine.fmt(emp) + (c.linkedin_employees != null ? ' <span class="muted small">in</span>' : '') : ''}</td>
      <td class="num">${money(c, c.revenue)}</td>
      <td>${c.contacts.length ? `${c.contacts.length}${emails ? ` <span class="muted small">· ${emails} ✉</span>` : ''} ${tags.map(t => `<span class="tag k">${esc(tagShort(t))}</span>`).join('')}` : '<span class="muted">–</span>'}</td>
      <td>${(c.acquisitions || []).length ? `<button class="link" data-deals="${c.id}" title="${esc(c.acquisitions.slice(0, 5).map(a => `${a.date || a.year || ''} ${a.target}${a.industry ? ' – ' + a.industry : ''}`).join('\n'))}"><b>${c.acquisitions.length}</b> <span class="muted small">last ${esc(String(c.acquisitions[0].date || c.acquisitions[0].year || '').slice(0, 4))}</span></button>` : (c.acq_checked_at ? '<span class="muted small">none</span>' : '<span class="muted">–</span>')}</td>
      <td class="wrap">${projectChips(c)}</td>
      <td>${c.enrichment ? `<span class="chip purple" title="${esc(c.enrichment.model)}">✦ ${ago(c.enrichment.at)}</span>` : state.queue?.pending?.includes(c.id) ? '<span class="chip amber">queued</span>' : '<span class="muted small">—</span>'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="10"><div class="empty">${state.companies.length ? 'No companies match these filters.' : 'No companies yet. Click <b>Import Excel / CSV</b> to add your lists.'}</div></td></tr>`;
  $('#moreRows').innerHTML = list.length > shown.length ? `<button class="btn" id="showMore">Show more (${(list.length - shown.length).toLocaleString()} left)</button>` : '';
  $('#checkAllCompanies').checked = shown.length > 0 && shown.every(c => state.picked.has(c.id));
  renderBulkBar();
  renderFilterOptions();
}

function renderFilterOptions() {
  const fill = (sel, values, all) => {
    const cur = $(sel).value;
    const html = `<option value="">${all}</option>` + values.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
    if ($(sel)._html !== html) { $(sel).innerHTML = html; $(sel)._html = html; }
  };
  fill('#filterRole', [...new Set(state.companies.map(c => c.role).filter(Boolean))].sort(), 'All roles');
  fill('#filterProject', [...new Set(state.companies.flatMap(c => c.projects.map(p => p.project)).filter(Boolean))].sort(), 'All projects');
  fill('#filterCountry', [...new Set(state.companies.map(c => c.country).filter(Boolean))].sort(), 'All countries');
  fill('#filterSector', [...new Set(state.companies.map(c => c.sector).filter(Boolean))].sort(), 'All sectors');
  fill('#filterOwnership', [...new Set(state.companies.map(c => Engine.ownershipType(c.ownership)).filter(Boolean))].sort(), 'Any ownership');
  const dl = state.companies.map(c => `<option value="${esc(c.name)}">`).join('');
  if ($('#companyList')._html !== dl) { $('#companyList').innerHTML = dl; $('#companyList')._html = dl; }
}

function renderBulkBar() {
  $('#bulkBar').hidden = !state.picked.size;
  $('#bulkCount').textContent = `${state.picked.size} selected`;
}

let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.limit = 200; renderCompanies(); }, 150); });
const FILTERS = ['#filterRole', '#filterProject', '#filterCountry', '#filterSector', '#filterOwnership', '#filterSize', '#filterEnriched', '#filterEmail', '#filterMulti', '#filterAcq'];
FILTERS.forEach(s => $(s).addEventListener('change', () => { state.limit = 200; renderCompanies(); }));
$('#clearFilters').addEventListener('click', () => {
  FILTERS.forEach(s => { const el = $(s); if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
  $('#search').value = '';
  renderCompanies();
});
$('#companyTable thead').addEventListener('click', e => {
  const k = e.target.closest('th')?.dataset.sort;
  if (!k) return;
  state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (['employees', 'revenue', 'people', 'deals', 'enriched'].includes(k) ? -1 : 1) };
  renderCompanies();
});
$('#companyTable tbody').addEventListener('click', e => {
  if (e.target.dataset.pick) {
    e.target.checked ? state.picked.add(e.target.dataset.pick) : state.picked.delete(e.target.dataset.pick);
    e.target.closest('tr').classList.toggle('sel', e.target.checked);
    return renderBulkBar();
  }
  if (e.target.closest('a')) return;
  const deals = e.target.closest('[data-deals]');
  if (deals) return openDrawer(deals.dataset.deals, 'acquisitions');
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDrawer(tr.dataset.id);
});
$('#checkAllCompanies').addEventListener('change', e => {
  filteredCompanies().slice(0, state.limit).forEach(c => (e.target.checked ? state.picked.add(c.id) : state.picked.delete(c.id)));
  renderCompanies();
});
$('#moreRows').addEventListener('click', e => { if (e.target.id === 'showMore') { state.limit += 200; renderCompanies(); } });
$('#bulkClear').addEventListener('click', () => { state.picked.clear(); renderCompanies(); });
$('#bulkExport').addEventListener('click', () => downloadSheet([...state.picked].map(byId).filter(Boolean).map(flatten), 'companies-selection.xlsx'));
$('#bulkDelete').addEventListener('click', async () => {
  if (!confirm(`Delete ${state.picked.size} companies${Store.mode === 'cloud' ? ' for the whole team' : ''}?`)) return;
  await removeCompanies([...state.picked]);
  renderCompanies();
});
$('#bulkEnrich').addEventListener('click', () => startResearch([...state.picked]));
$('#bulkPeople').addEventListener('click', () => apolloBulk([...state.picked]));

// Descriptions written by Claude Code from the data in your own lists (no web research).
async function importDescriptions(items) {
  const idx = Engine.buildIndex(state.companies);
  let n = 0;
  for (const it of items || []) {
    const c = (it.id && byId(it.id)) || Engine.findDuplicates({ name: it.name || '' }, idx).exact[0];
    if (!c) continue;
    if (it.short_description && !c.enrichment?.short_description) c.short_description = it.short_description;
    if (it.summary) c.summary = it.summary;
    if (it.tags?.length) c.tags = [...new Set([...(c.tags || []), ...it.tags.map(t => String(t).toLowerCase())])];
    touch(c);
    n++;
  }
  await flush();
  renderCompanies();
  if (state.drawer) renderDrawer();
  toast(`Descriptions imported for ${n} companies.`, 6000);
}

// ---------- Research via Claude Code (subscription) ----------
// Export: a small JSON file with what Claude needs to identify each company.
// Import: the file Claude writes back (see CLAUDE.md for the format).
function downloadJson(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = filename;
  a.click();
}
$('#bulkResearchExport').addEventListener('click', () => {
  const list = [...state.picked].map(byId).filter(Boolean);
  const companies = list.map(c => ({
    id: c.id, name: c.name, website: c.website || '', country: c.country || '', sector: c.sector || '',
    linkedin_url: c.linkedin_url || '', description: String(c.description || '').slice(0, 500),
    known_people: c.contacts.map(x => [x.name, x.title].filter(Boolean).join(' – ')).filter(Boolean).slice(0, 6),
    researched_before: c.enrichment?.at?.slice(0, 10) || '',
  }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  downloadJson({ type: 'mna-crm-research-request', version: 1, created: new Date().toISOString(), companies }, `research-request-${stamp}.json`);
  toast(`Exported ${companies.length} companies. Give this file to Claude Code and ask it to research them.`, 7000);
});

$('#importResearch').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const items = Array.isArray(d) ? d : d.companies;
    if (d.type === 'mna-crm-descriptions') return importDescriptions(items);
    if (d.type === 'mna-crm-people') return importPeopleFile(d);
    if (d.type === 'mna-crm-acquisitions') return importAcquisitions(d);
    if (!Array.isArray(items) || !items.some(x => x.profile)) throw new Error('This is not a research results file.');
    const idx = Engine.buildIndex(state.companies);
    let updated = 0, added = 0, skipped = 0;
    for (const it of items) {
      if (!it.profile || !it.name) { skipped++; continue; }
      let c = (it.id && byId(it.id)) || Engine.findDuplicates({ name: it.name, website: it.website || it.profile.website }, idx).exact[0];
      if (!c) { c = newCompany(it.name); state.companies.push(c); Engine.indexAdd(idx, c); added++; } else updated++;
      Enricher.apply(c, it.profile, { at: it.researched_at || d.created || new Date().toISOString(), model: d.model || 'Claude Code (subscription)', usd: 0, searches: it.searches || 0 });
      migrate(c);
      touch(c);
    }
    await flush();
    renderCompanies();
    if (state.drawer) renderDrawer();
    toast(`Research imported: ${updated} updated${added ? `, ${added} new` : ''}${skipped ? `, ${skipped} skipped` : ''}.`, 7000);
  } catch (err) { toast('Could not import research: ' + err.message, 7000); }
});

// ---------- Duplicate review ----------
// Groups records of the same company from different lists. Merging is lossless: contacts and project history are
// combined, conflicting values are kept as alternatives and the merged records can be restored later.
const dup = { tab: 'certain', groups: null, sel: new Set(), keep: {}, skip: new Set() };
function openDuplicates() {
  const g = Engine.duplicateGroups(state.companies);
  const prep = list => list.map((x, i) => ({ ...x, key: `${x.members.map(c => c.id).sort().join('|')}`, members: [...x.members].sort((a, b) => Engine.richness(b) - Engine.richness(a)) }));
  dup.groups = { certain: prep(g.certain), likely: prep(g.likely) };
  dup.sel = new Set(dup.groups.certain.map(x => x.key));
  dup.keep = {};
  dup.skip = new Set();
  if (!dup.groups.certain.length) dup.tab = 'likely';
  renderDuplicates();
  $('#dupDialog').showModal();
}
function renderDuplicates() {
  const list = dup.groups[dup.tab];
  const selected = list.filter(x => dup.sel.has(x.key));
  const merging = selected.reduce((n, x) => n + x.members.filter(c => c.id !== (dup.keep[x.key] || x.members[0].id) && !dup.skip.has(x.key + c.id)).length, 0);
  $('#dupBody').innerHTML = `<div class="toolbar"><h2 style="margin:0">Duplicate companies</h2><span class="spacer"></span><button class="btn" data-dup="close">Close</button></div>
    <p class="muted small">Records of the same company from different lists. Merging keeps <b>everything</b>: all contacts, all project history, other names (as aliases) and conflicting values (as alternatives). The merged records are stored too, so you can restore them from the company's Sources tab.</p>
    <div class="page-tabs">
      <button data-duptab="certain" class="${dup.tab === 'certain' ? 'active' : ''}">Certain <span class="badge" style="background:var(--good)">${dup.groups.certain.length}</span></button>
      <button data-duptab="likely" class="${dup.tab === 'likely' ? 'active' : ''}">Check these <span class="badge" style="background:#f79009">${dup.groups.likely.length}</span></button>
    </div>
    <p class="muted small">${dup.tab === 'certain' ? 'Same main website (ignoring www, subdomains and paths), LinkedIn page, Capital IQ ID or name.' : 'Same brand on another country domain, contact emails at the other\'s website, or similar names. These can also be parent and subsidiary, so check before merging.'}</p>
    <div class="toolbar"><button class="btn sm" data-dup="all">Select all</button><button class="btn sm" data-dup="none">Select none</button><span class="spacer"></span>
      <button class="btn primary" data-dup="merge" ${selected.length ? '' : 'disabled'}>Merge ${selected.length} group${selected.length === 1 ? '' : 's'} (${merging} records)</button></div>
    <div class="dup-list">${list.slice(0, 300).map(x => {
      const keep = dup.keep[x.key] || x.members[0].id;
      return `<div class="dup-group ${dup.sel.has(x.key) ? 'on' : ''}">
        <div class="dg-head"><label class="check"><input type="checkbox" data-dsel="${esc(x.key)}" ${dup.sel.has(x.key) ? 'checked' : ''}> <b>${esc(x.members[0].name)}</b></label>
          ${x.reasons.map(r => `<span class="chip ${dup.tab === 'certain' ? 'green' : 'amber'}">${esc(r)}</span>`).join('')}</div>
        <table class="compact"><thead><tr><th>Keep</th><th>Merge</th><th>Name</th><th>Website</th><th>Country</th><th class="num">People</th><th>Projects</th><th>From</th></tr></thead><tbody>
        ${x.members.map(c => `<tr class="${dup.skip.has(x.key + c.id) ? 'unsel' : ''}">
          <td><input type="radio" name="k${esc(x.key)}" data-dkeep="${esc(x.key)}" value="${c.id}" ${c.id === keep ? 'checked' : ''}></td>
          <td>${c.id === keep ? '<span class="muted small">main</span>' : `<input type="checkbox" data-dinc="${esc(x.key + c.id)}" ${dup.skip.has(x.key + c.id) ? '' : 'checked'}>`}</td>
          <td>${esc(c.name)}</td><td class="small">${esc(c._domain || c.website || '–')}</td><td class="small">${esc(c.country || '')}</td>
          <td class="num">${c.contacts.length}</td><td>${projectChips(c)}</td><td class="small muted">${esc((c.sources || []).map(s => s.split(' › ')[0]).join('; ').slice(0, 60))}</td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('') || '<div class="empty">No duplicates in this category. 🎉</div>'}</div>`;
}
async function mergeSelectedDuplicates() {
  const remove = [];
  for (const x of dup.groups[dup.tab].filter(g => dup.sel.has(g.key))) {
    const keep = byId(dup.keep[x.key] || x.members[0].id);
    for (const c of x.members) {
      if (c.id === keep.id || dup.skip.has(x.key + c.id) || !byId(c.id)) continue;
      Engine.mergeCompanies(keep, c);
      remove.push(c.id);
    }
    touch(keep);
  }
  await removeCompanies(remove);
  renderCompanies();
  toast(`Merged ${remove.length} records. Nothing was deleted: everything is combined into the main record.`, 7000);
  openDuplicates();
}
$('#findDuplicates').addEventListener('click', openDuplicates);
$('#dupBody').addEventListener('click', e => {
  const a = e.target.closest('[data-dup]')?.dataset.dup, t = e.target.closest('[data-duptab]')?.dataset.duptab;
  if (t) { dup.tab = t; dup.sel = new Set(t === 'certain' ? dup.groups.certain.map(x => x.key) : []); return renderDuplicates(); }
  if (a === 'close') return $('#dupDialog').close();
  if (a === 'all') { dup.groups[dup.tab].forEach(x => dup.sel.add(x.key)); return renderDuplicates(); }
  if (a === 'none') { dup.sel.clear(); return renderDuplicates(); }
  if (a === 'merge') return mergeSelectedDuplicates();
});
$('#dupBody').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.dsel) t.checked ? dup.sel.add(t.dataset.dsel) : dup.sel.delete(t.dataset.dsel);
  if (t.dataset.dkeep) { dup.keep[t.dataset.dkeep] = t.value; dup.skip.delete(t.dataset.dkeep + t.value); }
  if (t.dataset.dinc) t.checked ? dup.skip.delete(t.dataset.dinc) : dup.skip.add(t.dataset.dinc);
  renderDuplicates();
});

// Restores a record that was merged into `c` as a separate company again (the merged data also stays on `c`).
function unmerge(c, i) {
  const rec = c.merged_records?.[i];
  if (!rec) return;
  const restored = migrate(JSON.parse(JSON.stringify(rec)));
  if (byId(restored.id)) restored.id = uid();
  state.companies.push(restored);
  c.merged_records.splice(i, 1);
  c.merged_from?.splice(i, 1);
  touch(c, restored);
  renderCompanies();
  renderDrawer();
  toast(`${restored.name} restored as a separate company.`);
}

$('#downloadTemplate').addEventListener('click', () => {
  const headers = ['Company', 'Website', 'Role', 'Sector', 'Sub-sector', 'Country', 'City', 'Revenue (EUR m)', 'EBITDA (EUR m)', 'Employees', 'Founded', 'Ownership', 'Short description', 'Description', 'Keywords',
    'Looking for sectors', 'Looking for countries', 'Min revenue', 'Max revenue', 'Contact name', 'Function', 'E-mail', 'LinkedIn', 'Contact name 2', 'Function 2', 'E-mail 2', 'LinkedIn 2', 'Status', 'Date of last contact', 'Log'];
  const ex = [
    ['Example Packaging BV', 'example-packaging.nl', 'Target', 'Packaging', 'Flexible packaging', 'Netherlands', 'Utrecht', 25, 4, 120, 2004, 'Founder', 'Sustainable flexible packaging for food brands', 'Producer of sustainable flexible packaging and pouches for food brands in the Benelux.', 'packaging; sustainable; food', '', '', '', '', 'Jan de Vries', 'CEO', 'jan@example.com'],
    ['Example Industrial Group', 'example-industrial.de', 'Buyer', 'Packaging', '', 'Germany', 'Hamburg', 400, 50, 2000, 1965, 'Private', '', 'Industrial packaging group pursuing a buy-and-build strategy', '', 'Packaging; Labels', 'Netherlands; Belgium; Germany', 10, 100, 'Anna Schmidt', 'Head of M&A', 'anna@example.com', '', 'Max Müller', 'CFO', 'max@example.com', '', 'Teaser sent', '2026-10-01'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...ex]), 'Companies');
  XLSX.writeFile(wb, 'crm-template.xlsx');
});

// ---------- Company profile (drawer) ----------
function openDrawer(id, tab = 'overview') {
  state.drawer = { id, tab };
  $('#drawer').hidden = false;
  $('#drawerBackdrop').hidden = false;
  renderDrawer();
}
function closeDrawer() {
  state.drawer = null;
  $('#drawer').hidden = true;
  $('#drawerBackdrop').hidden = true;
}
$('#drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.drawer && !document.querySelector('dialog[open]')) closeDrawer(); });

function renderDrawer() {
  if (!state.drawer) return;
  const c = byId(state.drawer.id);
  if (!c) return closeDrawer();
  const tab = state.drawer.tab;
  const e = c.enrichment;
  const researching = state.queue?.running?.has(c.id);
  const fact = (k, v) => v != null && v !== '' ? `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>` : '';
  const tabs = [['overview', 'Overview'], ['people', `People (${c.contacts.length})`], ['acquisitions', `Acquisitions (${(c.acquisitions || []).length})`], ['projects', `Projects (${c.projects.length})`], ['sources', 'Sources']];

  let body = '';
  if (tab === 'overview') {
    body = `${!e ? `<div class="callout"><span>✦</span><div><b>Not researched yet.</b> <span class="muted">Claude can find the LinkedIn page, key people, acquisitions and a description. Export it, ask Claude Code to research the file, then use <b>Import research</b>.</span></div><span class="spacer"></span><button class="btn primary" data-act="export">Export for research</button></div>` : ''}
      ${c.short_description ? `<p class="lead">${esc(c.short_description)}</p>` : ''}
      ${(e?.long_description || c.summary || c.description) ? `<p class="prose">${esc(e?.long_description || c.summary || c.description)}</p>` : '<p class="muted">No description yet.</p>'}
      ${c.tags?.length ? `<div class="chips" style="margin-top:8px">${c.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
      ${c.alt && Object.keys(c.alt).length ? `<details class="small alt-values" style="margin-top:10px"><summary><b>Other values found in your lists</b> <span class="muted">(${Object.values(c.alt).flat().length})</span></summary>
        <table class="compact">${Object.entries(c.alt).map(([k, vals]) => `<tr><td class="muted">${esc(Engine.COMPANY_FIELDS.find(f => f.key === k)?.label || k)}</td><td><b>${esc(c[k] ?? '')}</b> <span class="muted">(shown)</span>${vals.map((v, i) => `<div>${esc(v)} <button class="link small" data-act="useAlt" data-k="${esc(k)}" data-i="${i}">use this</button></div>`).join('')}</td></tr>`).join('')}</table></details>` : ''}
      ${(e?.long_description || c.summary) && c.description && c.description !== (e?.long_description || c.summary) ? `<details class="small" style="margin-top:8px"><summary>Original description from your lists</summary><p class="prose">${esc(c.description)}</p></details>` : ''}
      <div class="facts">
        ${fact('Role', c.role && roleChip(c.role))}
        ${fact('Sector', esc([c.sector, c.subsector].filter(Boolean).join(' · ')))}
        ${fact('Headquarters', esc([c.hq_city, c.country].filter(Boolean).join(', ')))}
        ${fact('Founded', esc(c.founded))}
        ${fact('Ownership', esc(c.ownership))}
        ${fact('Employees', c.employees != null ? Engine.fmt(c.employees) : '')}
        ${fact('On LinkedIn', c.linkedin_employees_text ? esc(c.linkedin_employees_text) : c.linkedin_employees != null ? Engine.fmt(c.linkedin_employees) : '')}
        ${fact('Revenue', money(c, c.revenue))}
        ${fact('EBITDA', money(c, c.ebitda))}
        ${fact('Acquisitive', e?.is_acquisitive && e.is_acquisitive !== 'unknown' ? esc(e.is_acquisitive) : '')}
        ${fact('Ticker', esc(c.ticker))}
        ${fact('CRM status', esc(c.status))}
      </div>
      ${c.target_sectors || c.target_countries || c.min_revenue != null || c.max_revenue != null ? `<h3>Acquisition criteria</h3><div class="facts">
        ${fact('Sectors', esc(c.target_sectors))}${fact('Countries', esc(c.target_countries))}
        ${fact('Revenue range', c.min_revenue != null || c.max_revenue != null ? `€${c.min_revenue ?? 0}–${c.max_revenue ?? '∞'}m` : '')}</div>` : ''}
      ${c.projects.length ? `<h3>Track record with us</h3><div class="chips">${c.projects.map(p => `<span class="chip ${STAGE_CHIP[Engine.stageGroup(p.status)]}">${esc(p.project)}: ${esc(p.status || 'Not approached')}</span>`).join('')}</div>
        ${c.projects.filter(p => p.rationale).map(p => `<p class="small"><b>Why it fits ${esc(p.project)}:</b> ${esc(p.rationale)}</p>`).join('')}` : ''}
      ${c.portfolio ? `<h3>Portfolio</h3><p class="prose">${esc(c.portfolio)}</p>` : ''}
      ${c.notes ? `<h3>Notes</h3><p class="prose">${esc(c.notes)}</p>` : ''}
      ${e?.notes ? `<h3>Research notes</h3><p class="prose muted">${esc(e.notes)}</p>` : ''}`;
  } else if (tab === 'people') {
    const order = t => ['CEO', 'CFO', 'Corporate Development', 'M&A', 'Strategy', 'Founder', 'COO', 'CTO', 'Chairman', 'Board'].indexOf(t) + 1 || 99;
    const people = [...c.contacts].sort((a, b) => order(a.role_tag) - order(b.role_tag));
    body = people.length ? `<div class="people">${people.map(p => `<div class="person">
        <div class="avatar">${esc(initials(p.name || p.email))}</div>
        <div style="min-width:0">
          <div class="nm">${esc(p.name || p.email)} ${p.role_tag ? `<span class="tag k">${esc(tagShort(p.role_tag))}</span>` : ''}</div>
          <div class="ti">${esc(p.title || '')}</div>
          <div class="ln">
            ${p.email ? `<a href="mailto:${esc(p.email)}">✉ ${esc(p.email)}</a>` : '<span class="muted">no email</span>'}
            ${p.phone ? `<span>☎ ${esc(p.phone)}</span>` : ''}
            ${p.linkedin ? `<a href="${esc(p.linkedin)}" target="_blank" rel="noopener">in LinkedIn ↗</a>` : ''}
          </div>
          <div class="muted small" style="margin-top:4px">${p.source === 'Claude' ? `Found by Claude${p.source_url ? ` · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">source</a>` : ''}` : 'From your lists'}${p.verified_at ? ` · checked ${ago(p.verified_at)}` : ''}</div>
        </div></div>`).join('')}</div>` : `<div class="empty">No people yet.${c.enrichment ? '' : ' Research with Claude to find the CEO, CFO and Corp Dev / M&A contacts.'}</div>`;
    body = `<div class="toolbar"><span class="muted small">Outreach goes to the best contact first: M&A → Corp Dev → Strategy → CEO → CFO.</span><span class="spacer"></span>
      <button class="btn primary" data-act="people">👤 Find decision makers${apolloConfigured() ? ' (Apollo)' : ''}</button></div>` + body;
    body += `<p class="muted small" style="margin-top:12px">${apolloConfigured() ? 'Apollo search is free; revealing an email costs 1 credit.' : 'Without the Apollo API this exports a request file for Claude Code + Apollo; import the result with ✦ Import research.'}</p>`;
  } else if (tab === 'acquisitions') {
    const acq = [...(c.acquisitions || [])].sort((a, b) => String(b.date || b.year || '').localeCompare(String(a.date || a.year || '')));
    const years = acq.map(a => +String(a.date || a.year || '').slice(0, 4)).filter(Boolean);
    const recent = years.filter(y => y >= new Date().getFullYear() - 5).length;
    const inds = Object.entries(acq.reduce((m, a) => { if (a.industry) m[a.industry] = (m[a.industry] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
    body = acq.length ? `<div class="facts" style="margin-top:0">
        <div class="fact"><div class="k">Deals recorded</div><div class="v">${acq.length}</div></div>
        <div class="fact"><div class="k">Last 5 years</div><div class="v">${recent}</div></div>
        <div class="fact"><div class="k">Most recent</div><div class="v">${esc(String(acq[0].date || acq[0].year || '–'))}</div></div>
        <div class="fact"><div class="k">Acquisitive</div><div class="v">${esc(c.acquisitive || c.enrichment?.is_acquisitive || '–')}</div></div>
      </div>
      ${inds.length ? `<div class="chips" style="margin:10px 0">${inds.map(([k, n]) => `<span class="chip purple">${esc(k)}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</div>` : ''}
      ${c.acq_notes ? `<p class="muted small">${esc(c.acq_notes)}</p>` : ''}
      <div class="timeline">${acq.map(a => {
        const size = [a.deal_value && `Deal value ${a.deal_value}`, a.target_revenue && `Revenue ${a.target_revenue}`, a.target_employees && `${a.target_employees} employees`].filter(Boolean).join(' · ');
        const site = a.target_website ? Engine.cleanUrl(a.target_website) : '';
        return `<div class="tl-item"><div class="tl-year">${esc(a.date || a.year || 'Date unknown')}${a.type ? ` · ${esc(a.type)}` : ''}${a.stake ? ` · ${esc(a.stake)}` : ''}</div>
        <div class="co-line"><b>${esc(a.target)}</b>${site ? `<a class="ext" href="${esc(site)}" target="_blank" rel="noopener">↗ ${esc(Engine.domainOf(site))}</a>` : ''}
          ${a.industry ? `<span class="chip purple">${esc(a.industry)}</span>` : ''}${a.country ? `<span class="chip">${esc(a.country)}</span>` : ''}</div>
        ${size ? `<div class="small"><b>${esc(size)}</b></div>` : ''}
        <div class="muted">${esc(a.description || '')}${a.source_url ? ` <a class="small" href="${esc(a.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</div></div>`;
      }).join('')}</div>
      ${c.acq_checked_at ? `<p class="muted small">Researched ${esc(String(c.acq_checked_at).slice(0, 10))}.</p>` : ''}`
      : `<div class="empty">No acquisitions recorded${c.acq_checked_at ? ': none found when researched on ' + esc(String(c.acq_checked_at).slice(0, 10)) : '. Select it in the list → Export for research, or ask Claude Code to research its acquisitions'}.</div>`;
  } else if (tab === 'projects') {
    body = c.projects.map(p => `<div class="proj">
      <b>${esc(p.project || 'Project')}</b> <span class="muted small">${esc(state.projects.find(x => x.name === p.project)?.client || '')}</span> ${stageChip(p.status)}
      <span class="muted small">${esc([p.furthest_stage && p.furthest_stage !== p.status && 'Furthest: ' + p.furthest_stage, p.last_contact && 'Last contact ' + p.last_contact, p.responsible && 'Resp. ' + p.responsible, p.tier && 'Tier ' + p.tier, p.wave].filter(Boolean).join(' · '))}</span>
      ${p.rationale ? `<div class="small"><b>Rationale:</b> ${esc(p.rationale)}</div>` : ''}
      ${p.pass_reason ? `<div class="small err"><b>Pass reason:</b> ${esc(p.pass_reason)}</div>` : ''}
      ${p.log ? `<div class="small">${esc(p.log)}</div>` : ''}
      ${p.remarks ? `<div class="small muted">${esc(p.remarks)}</div>` : ''}
      ${Object.keys(p.extra || {}).length ? `<details class="small"><summary>More info</summary>${Object.entries(p.extra).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</details>` : ''}
      <div class="muted small">${esc(p.source || '')}</div></div>`).join('') || '<div class="empty">Not part of any project yet.</div>';
  } else if (tab === 'sources') {
    body = `<h3>Imported from</h3>${c.sources.length ? c.sources.map(s => `<div class="small">${esc(s)}</div>`).join('') : '<div class="muted small">Added by hand.</div>'}
      ${c.merged_from?.length ? `<h3>Merged records (${c.merged_from.length})</h3><p class="muted small">These duplicates were combined into this company. Their data is included above; restore one if it was a different company.</p>
        ${c.merged_from.map((m, i) => `<div class="merged-row"><span><b>${esc(m.name)}</b> <span class="muted small">${esc(Engine.domainOf(m.website) || '')} · merged ${esc(String(m.at).slice(0, 10))}</span></span>
          ${c.merged_records?.[i] ? `<button class="btn sm" data-act="unmerge" data-i="${i}">Restore as separate company</button>` : ''}</div>`).join('')}` : ''}
      <h3>Claude research</h3>${e ? `<div class="small">${new Date(e.at).toLocaleString()} · ${esc(e.model)} · ${e.searches} searches · ≈ $${Number(e.usd || 0).toFixed(2)}</div>
        <ul class="small">${(e.sources || []).map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join('')}</ul>` : '<div class="muted small">Not researched yet.</div>'}`;
  }

  $('#drawer').innerHTML = `<div class="drawer-head">
      <div class="drawer-title">${logo(c, true)}
        <div style="min-width:0"><h2>${esc(c.name)}</h2>
          <div class="drawer-links">
            ${c.website ? `<a href="${esc(Engine.cleanUrl(c.website))}" target="_blank" rel="noopener">🌐 ${esc(c._domain || c.website)}</a>` : ''}
            ${c.linkedin_url ? `<a href="${esc(c.linkedin_url)}" target="_blank" rel="noopener">in LinkedIn ↗</a>` : ''}
            ${roleChip(c.role)}
            ${c.merged_from?.length ? `<span class="chip purple" title="Combined from ${c.merged_from.length + 1} records">⧉ ${c.merged_from.length + 1} records combined</span>` : ''}
          </div>
          ${c.aliases?.length ? `<div class="muted small">Also known as: ${esc(c.aliases.join(' · '))}</div>` : ''}</div>
        <div class="drawer-actions">
          <button class="btn ${e ? '' : 'primary'}" data-act="export" title="Download a file to research in Claude Code (uses your subscription)">✦ Export for research</button>
          <button class="btn" data-act="research" ${researching ? 'disabled' : ''} title="Research directly via the Anthropic API (paid per company)">${researching ? 'Researching…' : e ? '↻ Research via API' : 'Research via API'}</button>
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn" data-act="match">Find matches</button>
          <button class="btn ghost" data-act="close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="drawer-tabs">${tabs.map(([k, l]) => `<button data-dtab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="drawer-body">${body}</div>`;
}
$('#drawer').addEventListener('click', e => {
  const t = e.target.closest('[data-dtab],[data-act]');
  if (!t || !state.drawer) return;
  const id = state.drawer.id;
  if (t.dataset.dtab) { state.drawer.tab = t.dataset.dtab; return renderDrawer(); }
  const act = t.dataset.act;
  if (act === 'close') closeDrawer();
  if (act === 'edit') openEdit(id);
  if (act === 'research') startResearch([id], { force: true });
  if (act === 'people') findDecisionMakers(id);
  if (act === 'unmerge') { const c = byId(id); if (confirm('Restore this record as a separate company? Its data also stays on this company.')) unmerge(c, +t.dataset.i); }
  if (act === 'useAlt') {
    const c = byId(id), k = t.dataset.k, i = +t.dataset.i;
    const cur = c[k];
    c[k] = c.alt[k][i];
    c.alt[k][i] = cur; // swap, so the previous value stays available
    migrate(c);
    touch(c);
    renderDrawer();
    renderCompanies();
  }
  if (act === 'export') {
    const keep = new Set(state.picked);
    state.picked = new Set([id]);
    $('#bulkResearchExport').click();
    state.picked = keep;
  }
  if (act === 'match') { closeDrawer(); setDeal(id); showTab('match'); }
});

// ---------- Claude research queue ----------
function estimatePerCompany() {
  const s = state.settings.spend;
  if (s.count >= 3) return s.usd / s.count;
  return { 'claude-opus-5-5': 0.25, 'claude-sonnet-5-5': 0.15, 'claude-haiku-5-5': 0.09 }[state.settings.enrichModel] || 0.25;
}

function startResearch(ids, { force = false } = {}) {
  if (!state.settings.anthropicKey) { toast('Add your Anthropic API key in Settings → Claude research first.', 5000); return showTab('settings'); }
  const skipDays = Number(state.settings.enrichSkipDays) || 0;
  const busy = new Set([...(state.queue?.pending || []), ...(state.queue?.running || [])]);
  let todo = ids.filter(id => !busy.has(id));
  const recent = todo.filter(id => { const e = byId(id)?.enrichment; return e && daysAgo(e.at) < skipDays; });
  if (!force && recent.length) todo = todo.filter(id => !recent.includes(id));
  if (!todo.length) return toast(recent.length ? `All ${recent.length} were researched in the last ${skipDays} days.` : 'Already in the queue.');
  if (todo.length > 1 || !force) {
    const est = todo.length * estimatePerCompany();
    if (!confirm(`Research ${todo.length} compan${todo.length === 1 ? 'y' : 'ies'} with ${Enricher.MODELS[state.settings.enrichModel]?.label || state.settings.enrichModel}?\n\nEstimated cost: about $${est.toFixed(2)} (≈ $${estimatePerCompany().toFixed(2)} each)${recent.length ? `\nSkipping ${recent.length} researched in the last ${skipDays} days.` : ''}`)) return;
  }
  if (!state.queue) state.queue = { pending: [], running: new Set(), done: 0, failed: [], usd: 0, total: 0, paused: false, controllers: new Map() };
  state.queue.pending.push(...todo);
  state.queue.total += todo.length;
  renderQueue();
  renderCompanies();
  if (state.drawer) renderDrawer();
  pumpQueue();
}

function pumpQueue() {
  const q = state.queue;
  if (!q) return;
  const max = Math.max(1, Math.min(5, Number(state.settings.enrichParallel) || 2));
  while (!q.paused && q.pending.length && q.running.size < max) runOne(q.pending.shift());
  if (!q.pending.length && !q.running.size) finishQueue();
}

async function runOne(id) {
  const q = state.queue, c = byId(id);
  if (!c) return pumpQueue();
  q.running.add(id);
  const ctrl = new AbortController();
  q.controllers.set(id, ctrl);
  renderQueue();
  if (state.drawer?.id === id) renderDrawer();
  try {
    const r = await Enricher.research(c, { apiKey: state.settings.anthropicKey, model: state.settings.enrichModel, signal: ctrl.signal });
    Enricher.apply(c, r.profile, { at: new Date().toISOString(), model: r.model, usd: r.usd, searches: r.searches });
    migrate(c);
    touch(c);
    q.done++;
    q.usd += r.usd;
    state.settings.spend.usd += r.usd;
    state.settings.spend.count++;
    saveSettingsLocal();
  } catch (err) {
    if (ctrl.signal.aborted) q.pending.unshift(id);
    else { q.failed.push({ id, name: c.name, error: err.message }); console.error(c.name, err); }
    if (/401|authentication|invalid x-api-key/i.test(err.message)) { q.paused = true; toast('Your Anthropic API key was rejected. Check it in Settings.', 7000); }
  } finally {
    q.running.delete(id);
    q.controllers.delete(id);
    renderQueue();
    scheduleListRender();
    if (state.drawer?.id === id) renderDrawer();
    pumpQueue();
  }
}

let listRenderTimer;
function scheduleListRender() { clearTimeout(listRenderTimer); listRenderTimer = setTimeout(renderCompanies, 300); }

function renderQueue() {
  const q = state.queue;
  if (!q) { $('#queue').hidden = true; return; }
  const finished = q.done + q.failed.length;
  const names = [...q.running].map(id => byId(id)?.name).filter(Boolean);
  $('#queue').hidden = false;
  $('#queue').innerHTML = `<h4>✦ Researching with Claude</h4>
    <div class="small">${finished} of ${q.total} done${q.failed.length ? ` · <span class="err">${q.failed.length} failed</span>` : ''} · ≈ $${q.usd.toFixed(2)}</div>
    <div class="bar"><div style="width:${q.total ? (finished / q.total) * 100 : 0}%"></div></div>
    <div class="cur">${q.paused ? 'Paused' : names.length ? 'Now: ' + esc(names.join(', ')) : 'Starting…'}</div>
    <div class="toolbar" style="margin:10px 0 0">
      <button class="btn sm" data-q="${q.paused ? 'resume' : 'pause'}">${q.paused ? 'Resume' : 'Pause'}</button>
      <button class="btn sm danger" data-q="stop">Stop</button>
      ${q.failed.length ? '<button class="btn sm" data-q="errors">Show errors</button>' : ''}
    </div>`;
}
$('#queue').addEventListener('click', e => {
  const a = e.target.dataset.q, q = state.queue;
  if (!a || !q) return;
  if (a === 'pause') { q.paused = true; renderQueue(); }
  if (a === 'resume') { q.paused = false; renderQueue(); pumpQueue(); }
  if (a === 'stop') { q.pending = []; q.controllers.forEach(c => c.abort()); q.paused = false; setTimeout(finishQueue, 50); }
  if (a === 'errors') alert(q.failed.map(f => `${f.name}: ${f.error}`).join('\n\n'));
});
function finishQueue() {
  const q = state.queue;
  if (!q || q.running.size) return;
  const msg = `Research finished: ${q.done} done${q.failed.length ? `, ${q.failed.length} failed` : ''}. Cost ≈ $${q.usd.toFixed(2)}.`;
  if (q.failed.length) alert(msg + '\n\n' + q.failed.map(f => `${f.name}: ${f.error}`).join('\n'));
  else toast(msg, 6000);
  state.queue = null;
  renderQueue();
  renderCompanies();
  renderSpend();
}

// ---------- Import wizard ----------
// imp = { files: [{ name, project, sheets: [...] }], fi, si, stage: 'sheets' | 'sheet' }
let imp = null;

function readSheet(ws, name) {
  if (!ws || !ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  // Some sheets are formatted all the way to column XFD; only read up to the last filled column.
  let maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const v = ws[k].v;
    if (v !== undefined && v !== null && String(v).trim() !== '') maxC = Math.max(maxC, XLSX.utils.decode_cell(k).c);
  }
  range.e.c = Math.min(range.e.c, maxC);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true, range });
  return { name, rows, r0: range.s.r };
}

function prepSheet(file, sh, resetMapping, idx = Engine.buildIndex(state.companies)) {
  sh.headers = (sh.rows[sh.headerRow] || []).map(norm);
  if (resetMapping || !sh.targets) sh.targets = Engine.mapHeaders(sh.headers, state.mappingMemory);
  const source = `${file.name} › ${sh.name}`;
  const firstByName = new Map();
  sh.parsed = sh.rows.slice(sh.headerRow + 1).map((row, i) => {
    const p = Engine.parseRow(row, sh.headers, sh.targets, { unit: sh.unit, currency: sh.currency, role: sh.role, project: sh.project || file.project, source });
    if (!p.company.name) return null;
    const dup = Engine.findDuplicates(p.company, idx);
    const n = Engine.normName(p.company.name);
    const sameRow = firstByName.get(n);
    if (!sameRow) firstByName.set(n, sh.r0 + sh.headerRow + i + 2);
    return { ...p, i, excelRow: sh.r0 + sh.headerRow + i + 2, text: row.join(' ').toLowerCase(), exact: dup.exact[0], possible: dup.possible.slice(0, 3), sameRow };
  }).filter(Boolean);
  // Section rows like "IPA" or "DMS" between groups of buyers: the name is a category used by
  // other rows (or a header word) and the row has no website or contacts.
  const categories = new Set(sh.parsed.flatMap(p => [p.company.sector, p.company.subsector]).filter(Boolean).map(s => s.toLowerCase()));
  const headerWords = new Set(sh.headers.map(h => h.toLowerCase()).concat(['category', 'company', 'multiple', 'other']));
  for (const p of sh.parsed) {
    const n = p.company.name.toLowerCase();
    // A repeated header row has several cells equal to the header labels.
    const repeatedHeader = sh.rows[sh.headerRow + 1 + p.i].filter((v, j) => v !== '' && norm(v).toLowerCase() === (sh.headers[j] || '').toLowerCase()).length >= 2;
    p.sectionRow = repeatedHeader || ((categories.has(n) || headerWords.has(n)) && !p.company.website && !p.contacts.length);
  }
  if (!sh.selected || resetMapping) sh.selected = new Set(sh.parsed.filter(p => !p.sectionRow).map(p => p.i));
  sh.choices ??= {};
}

$('#upload').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  imp = { files: [], fi: 0, si: 0, stage: 'sheets', search: '' };
  const idx = Engine.buildIndex(state.companies);
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
      const file = { name: f.name, project: Engine.guessProject(f.name), sheets: [] };
      for (const n of wb.SheetNames) {
        const sh = readSheet(wb.Sheets[n], n);
        if (!sh) continue;
        sh.headerRow = Engine.detectHeaderRow(sh.rows);
        sh.unit = Engine.detectUnit(sh.rows, sh.headerRow);
        sh.currency = Engine.detectCurrency(sh.rows, sh.headerRow);
        sh.role = Engine.guessRoleFromSheet(n);
        sh.project = state.mappingMemory['sheet:' + Engine.headerKey(n)] || '';
        prepSheet(file, sh, true, idx);
        sh.include = sh.parsed.length > 0 && !Engine.SKIP_SHEETS.test(n);
        file.sheets.push(sh);
      }
      imp.files.push(file);
    } catch (err) {
      console.error(err);
      toast(`Could not read ${f.name}: ${err.message}`, 6000);
    }
  }
  if (!imp.files.length) return;
  renderImport();
  $('#importDialog').showModal();
});

const curFile = () => imp.files[imp.fi];
const includedSheets = () => curFile().sheets.filter(s => s.include);
const curSheet = () => includedSheets()[imp.si];
const ROLE_OPTIONS = ['', 'Buyer', 'Investor', 'Target', 'Advisor'];
const roleSelect = (attr, sel) => `<select ${attr}>${ROLE_OPTIONS.map(r => `<option ${r === sel ? 'selected' : ''} value="${r}">${r || '—'}</option>`).join('')}</select>`;

function renderImport() {
  const file = curFile();
  const head = `<div class="muted small">File ${imp.fi + 1} of ${imp.files.length}</div>`;
  if (imp.stage === 'sheets') {
    $('#importBody').innerHTML = `${head}<h2>${esc(file.name)}</h2>
      <div class="form-grid" style="max-width:720px">
        <label>Project name <input id="impProject" value="${esc(file.project)}" placeholder="None (plain company list)"></label>
        <label>Client <input id="impClient" value="${esc(file.client || state.projects.find(p => p.name === file.project)?.client || '')}" placeholder="e.g. Teavaro"></label>
      </div>
      <p class="muted small">Importing creates the project (if new) and adds every company to the shared database. Companies that already exist are merged.</p>
      <p class="muted small">Pick the sheets to import. Each sheet can have its own layout; you check the columns on the next screen. Capital IQ exports are recognised automatically.</p>
      <table class="compact"><thead><tr><th></th><th>Sheet</th><th class="num">Companies</th><th>Default role</th></tr></thead><tbody>
      ${file.sheets.map((s, k) => `<tr>
        <td><input type="checkbox" data-inc="${k}" ${s.include ? 'checked' : ''}></td>
        <td>${esc(s.name)}</td><td class="num">${s.parsed.length}</td>
        <td>${roleSelect(`data-role="${k}"`, s.role)}</td>
      </tr>`).join('')}</tbody></table>
      <div class="toolbar" style="margin-top:16px"><span class="spacer"></span>
        <button class="btn" data-act="cancel">Cancel</button>
        ${imp.files.length > 1 ? '<button class="btn" data-act="skipfile">Skip this file</button>' : ''}
        <button class="btn primary" data-act="tosheets">Next →</button></div>`;
    return;
  }

  const sh = curSheet();
  const sheets = includedSheets();
  const optionsHtml = sel => {
    let g = '', html = '';
    for (const o of Engine.TARGET_OPTIONS) {
      if (o.group !== g) { html += (g ? '</optgroup>' : '') + `<optgroup label="${o.group}">`; g = o.group; }
      html += `<option value="${o.value}" ${o.value === sel ? 'selected' : ''}>${esc(o.label)}</option>`;
    }
    return html + '</optgroup>';
  };
  const sample = i => sh.rows.slice(sh.headerRow + 1).map(r => r[i]).filter(v => v !== '' && v != null).slice(0, 2).map(v => String(v).slice(0, 40)).join(' · ');
  const mapRows = sh.headers.map((h, i) => (h || sample(i)) ? `<div class="map-row ${sh.targets[i] === 'ignore' ? 'ignored' : ''}">
      <span class="map-h" title="${esc(h)}">${esc(h) || `<i class="muted">(no header, col ${XLSX.utils.encode_col(i)})</i>`}</span>
      <select data-map="${i}">${optionsHtml(sh.targets[i])}</select>
      <span class="muted small map-s">${esc(sample(i))}</span></div>` : '').join('');

  const q = imp.search.toLowerCase();
  const visible = sh.parsed.filter(p => !q || p.text.includes(q));
  const sel = sh.parsed.filter(p => sh.selected.has(p.i));
  const merges = sel.filter(p => { const ch = sh.choices[p.i] || 'auto'; return ch !== 'new' && (ch !== 'auto' || p.exact || p.sameRow); }).length;
  const dupCell = p => {
    const ch = sh.choices[p.i] || 'auto';
    const autoLabel = p.exact ? `Merge with ${p.exact.name}` : p.sameRow ? `Merge with row ${p.sameRow}` : 'New company';
    const opts = [`<option value="auto" ${ch === 'auto' ? 'selected' : ''}>${esc(autoLabel)}</option>`];
    if (p.exact || p.sameRow) opts.push(`<option value="new" ${ch === 'new' ? 'selected' : ''}>Keep separate</option>`);
    for (const c of p.possible) opts.push(`<option value="${c.id}" ${ch === c.id ? 'selected' : ''}>Merge with ${esc(c.name)}?</option>`);
    const cls = p.exact || p.sameRow ? 'dup-exact' : p.possible.length ? 'dup-possible' : '';
    return opts.length > 1 || cls ? `<select class="${cls}" data-choice="${p.i}">${opts.join('')}</select>` : '<span class="muted small">New</span>';
  };
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK'];

  $('#importBody').innerHTML = `${head}
    <h2>${esc(file.name)} › ${esc(sh.name)} <span class="muted small">(sheet ${imp.si + 1} of ${sheets.length})</span></h2>
    <div class="toolbar">
      <label class="row-label">Header row <input type="number" id="impHeader" min="1" value="${sh.r0 + sh.headerRow + 1}" style="width:70px"></label>
      <label class="row-label">Amounts in <select id="impUnit"><option value="m" ${sh.unit === 'm' ? 'selected' : ''}>millions</option><option value="k" ${sh.unit === 'k' ? 'selected' : ''}>thousands</option></select></label>
      <label class="row-label">Currency <select id="impCurrency">${CURRENCIES.map(c => `<option ${c === sh.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="row-label">Default role ${roleSelect('id="impRole"', sh.role)}</label>
      <label class="row-label">Project for this sheet <input id="impProject2" value="${esc(sh.project || file.project)}" placeholder="none" style="width:160px"></label>
    </div>
    <details ${imp.showMap !== false ? 'open' : ''} id="impMapDetails"><summary><b>Columns</b> <span class="muted small">check what each column means; your choices are remembered for next time</span></summary>
      <div class="map-grid">${mapRows}</div>
    </details>
    <h3 style="margin-top:14px">Rows <span class="muted">${sel.length} of ${sh.parsed.length} selected · ${sel.length - merges} new · ${merges} merge</span></h3>
    <div class="toolbar">
      <input type="search" id="impSearch" placeholder="Filter rows (any cell text)…" value="${esc(imp.search)}" style="min-width:240px">
      <button class="btn" data-act="selvis">Select ${q ? 'filtered' : 'all'}</button>
      <button class="btn" data-act="deselvis">Deselect ${q ? 'filtered' : 'all'}</button>
      <button class="btn" data-act="selemail">Only rows with email</button>
    </div>
    <div class="table-wrap" style="max-height:40vh">
      <table class="compact"><thead><tr><th></th><th>Row</th><th>Company</th><th>Role</th><th>Country</th><th class="num">Revenue</th><th>Contacts</th><th>Status</th><th>Duplicate?</th></tr></thead><tbody>
      ${visible.map(p => `<tr class="${sh.selected.has(p.i) ? '' : 'unsel'}">
        <td><input type="checkbox" data-row="${p.i}" ${sh.selected.has(p.i) ? 'checked' : ''}></td>
        <td class="muted">${p.excelRow}</td><td>${esc(p.company.name)}${p.sectionRow ? ' <span class="chip amber" title="Looks like a section header, not a company">section row?</span>' : ''}</td><td>${esc(p.company.role)}</td><td>${esc(p.company.country)}</td>
        <td class="num">${money(p.company, p.company.revenue)}</td>
        <td class="small">${p.contacts.map(c => esc(c.name || c.email) + (c.email ? '' : ' <span class="muted">(no email)</span>')).join('<br>')}</td>
        <td class="small">${esc((p.project.status || '').slice(0, 30))}</td>
        <td>${dupCell(p)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No rows. Check the header row and that a column is mapped to "Company name".</td></tr>'}
      </tbody></table>
    </div>
    <div class="toolbar" style="margin-top:12px"><span class="spacer"></span>
      <button class="btn" data-act="back">← Back</button>
      <button class="btn" data-act="skipsheet">Skip sheet</button>
      <button class="btn primary" data-act="import">Import ${sel.length} rows →</button></div>`;
}

function nextAfterSheet() {
  if (imp.si < includedSheets().length - 1) { imp.si++; imp.search = ''; return renderImport(); }
  if (imp.fi < imp.files.length - 1) { imp.fi++; imp.si = 0; imp.stage = 'sheets'; imp.search = ''; return renderImport(); }
  $('#importDialog').close();
  const t = imp.totals || { added: 0, merged: 0 };
  toast(`Import finished: ${t.added} new companies, ${t.merged} merged into existing ones.`, 7000);
  const proj = imp.files.map(f => f.project).filter(Boolean).pop();
  imp = null;
  renderCompanies();
  if (proj) { state.projectView = proj; showTab('projects'); }
}

function importSheet() {
  const file = curFile(), sh = curSheet();
  const idx = Engine.buildIndex(state.companies);
  const projName = sh.project || file.project;
  if (projName) ensureProject(projName, { client: file.client || '', source: file.name });
  let added = 0, merged = 0;
  for (const p of sh.parsed) {
    if (!sh.selected.has(p.i)) continue;
    const ch = sh.choices[p.i] || 'auto';
    let target = null;
    if (ch === 'auto') target = Engine.findDuplicates(p.company, idx).exact[0] || null;
    else if (ch !== 'new') target = byId(ch);
    if (target) { Engine.mergeInto(target, p); merged++; touch(target); }
    else {
      const c = newCompany(p.company.name);
      Engine.mergeInto(c, p);
      state.companies.push(c);
      Engine.indexAdd(idx, c);
      touch(c);
      added++;
    }
  }
  imp.totals = { added: (imp.totals?.added || 0) + added, merged: (imp.totals?.merged || 0) + merged };
  flush();
  toast(`${sh.name}: ${added} new, ${merged} merged.`);
  // Later sheets should see the companies just imported as duplicates.
  includedSheets().slice(imp.si + 1).forEach(s => prepSheet(file, s, false, idx));
  nextAfterSheet();
}

$('#importBody').addEventListener('click', e => {
  const act = e.target.dataset.act;
  if (!act) return;
  const file = curFile(), sh = imp.stage === 'sheet' ? curSheet() : null;
  if (act === 'cancel') { $('#importDialog').close(); imp = null; renderCompanies(); return; }
  if (act === 'skipfile') { imp.si = includedSheets().length; nextAfterSheet(); return; }
  if (act === 'tosheets') {
    file.project = norm($('#impProject').value);
    file.client = norm($('#impClient').value);
    if (!includedSheets().length) return toast('Select at least one sheet.');
    const idx = Engine.buildIndex(state.companies);
    file.sheets.forEach(s => prepSheet(file, s, false, idx));
    imp.stage = 'sheet'; imp.si = 0; return renderImport();
  }
  if (act === 'back') { if (imp.si > 0) imp.si--; else imp.stage = 'sheets'; return renderImport(); }
  if (act === 'skipsheet') return nextAfterSheet();
  if (act === 'import') return importSheet();
  const q = imp.search.toLowerCase();
  const vis = sh.parsed.filter(p => !q || p.text.includes(q));
  if (act === 'selvis') vis.forEach(p => sh.selected.add(p.i));
  if (act === 'deselvis') vis.forEach(p => sh.selected.delete(p.i));
  if (act === 'selemail') sh.parsed.forEach(p => (p.contacts.some(c => c.email) ? sh.selected.add(p.i) : sh.selected.delete(p.i)));
  renderImport();
});

$('#importBody').addEventListener('change', e => {
  const t = e.target, file = curFile();
  if (imp.stage === 'sheets') {
    if (t.dataset.inc) file.sheets[t.dataset.inc].include = t.checked;
    if (t.dataset.role !== undefined) { const s = file.sheets[t.dataset.role]; s.role = t.value; prepSheet(file, s, false); }
    if (t.id === 'impProject') file.project = norm(t.value);
    if (t.id === 'impClient') file.client = norm(t.value);
    return;
  }
  const sh = curSheet();
  if (t.dataset.row) { t.checked ? sh.selected.add(+t.dataset.row) : sh.selected.delete(+t.dataset.row); return renderImport(); }
  if (t.dataset.choice) { sh.choices[t.dataset.choice] = t.value; return renderImport(); }
  if (t.dataset.map) {
    const i = +t.dataset.map;
    sh.targets[i] = t.value;
    if (sh.headers[i]) { state.mappingMemory[Engine.headerKey(sh.headers[i])] = t.value; saveShared('mappingMemory', state.mappingMemory); }
  }
  if (t.id === 'impHeader') { sh.headerRow = Math.max(0, +t.value - 1 - sh.r0); prepSheet(file, sh, true); return renderImport(); }
  if (t.id === 'impUnit') sh.unit = t.value;
  if (t.id === 'impCurrency') sh.currency = t.value;
  if (t.id === 'impRole') sh.role = t.value;
  if (t.id === 'impProject2') {
    sh.project = norm(t.value);
    state.mappingMemory['sheet:' + Engine.headerKey(sh.name)] = sh.project;
    saveShared('mappingMemory', state.mappingMemory);
  }
  prepSheet(file, sh, false);
  renderImport();
});
$('#importBody').addEventListener('input', e => {
  if (e.target.id !== 'impSearch') return;
  imp.search = e.target.value;
  const pos = e.target.selectionStart;
  renderImport();
  const s = $('#impSearch'); s.focus(); s.setSelectionRange(pos, pos);
});
$('#importBody').addEventListener('toggle', e => { if (imp && e.target.id === 'impMapDetails') imp.showMap = e.target.open; }, true);

// ---------- Edit dialog ----------
const CONTACT_INPUTS = ['name', 'title', 'email', 'phone', 'linkedin'];
function openEdit(id) {
  const c = id ? byId(id) : newCompany('');
  const dlg = $('#editDialog');
  dlg.dataset.id = id || '';
  dlg._contacts = (c.contacts || []).map(x => ({ ...x }));
  $('#editTitle').textContent = id ? c.name : 'New company';
  const fieldHtml = f => {
    const v = c[f.key] ?? '';
    let input;
    if (f.key === 'role') input = `<select name="${f.key}">${ROLE_OPTIONS.map(r => `<option ${r === v ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
    else if (f.long) input = `<textarea name="${f.key}" rows="3">${esc(v)}</textarea>`;
    else input = `<input name="${f.key}" value="${esc(v)}" ${f.key === 'name' ? 'required' : ''}>`;
    return `<label class="${f.long ? 'full' : ''}">${esc(f.label)}${input}</label>`;
  };
  const statusSel = `<label>CRM status<select name="status">${Engine.STATUSES.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`;
  $('#editFields').innerHTML = `
    <div class="form-grid">${Engine.COMPANY_FIELDS.map(fieldHtml).join('')}${statusSel}</div>
    <h3>Contacts</h3><div id="editContacts"></div>
    <button type="button" class="btn" id="addContact">+ Add contact</button>
    ${id ? `<h3>Merge</h3><div class="toolbar">
      <input list="companyList" id="mergeWith" placeholder="Another company with the same identity…" style="flex:1">
      <button type="button" class="btn" id="mergeBtn">Merge into this company</button></div>
      <div class="toolbar"><button type="button" class="btn danger" id="deleteCompany">Delete company</button></div>` : ''}`;
  renderEditContacts();
  $('#addContact').addEventListener('click', () => { readEditContacts(); dlg._contacts.push({}); renderEditContacts(); });
  $('#deleteCompany')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${c.name}?`)) return;
    dlg.close('cancel');
    closeDrawer();
    await removeCompanies([id]);
    renderCompanies();
  });
  $('#mergeBtn')?.addEventListener('click', async () => {
    const name = $('#mergeWith').value.trim().toLowerCase();
    const other = state.companies.find(x => x.id !== id && x.name.toLowerCase() === name);
    if (!other) return toast('Pick an existing company from the list.');
    if (!confirm(`Merge "${other.name}" into "${c.name}"? "${other.name}" will be removed; its contacts and projects move here.`)) return;
    Engine.mergeCompanies(c, other);
    touch(c);
    dlg.close('cancel');
    await removeCompanies([other.id]);
    renderCompanies();
    renderDrawer();
  });
  dlg.showModal();
}
function renderEditContacts() {
  const list = $('#editDialog')._contacts;
  $('#editContacts').innerHTML = list.map((ct, i) => `<div class="contact-row">
    ${CONTACT_INPUTS.map(k => `<input data-ci="${i}" data-ck="${k}" placeholder="${k === 'title' ? 'function' : k}" value="${esc(ct[k] || '')}">`).join('')}
    <button type="button" class="link" data-rmc="${i}">remove</button></div>`).join('') || '<div class="muted small">No contacts.</div>';
  $$('[data-rmc]').forEach(b => b.addEventListener('click', () => { readEditContacts(); list.splice(+b.dataset.rmc, 1); renderEditContacts(); }));
}
function readEditContacts() {
  const list = $('#editDialog')._contacts;
  $$('#editContacts [data-ci]').forEach(inp => (list[+inp.dataset.ci][inp.dataset.ck] = inp.value.trim()));
}
$('#addCompany').addEventListener('click', () => openEdit(null));
$('#editDialog').addEventListener('close', () => {
  const dlg = $('#editDialog');
  if (dlg.returnValue !== 'save') return;
  readEditContacts();
  const data = Object.fromEntries(new FormData($('#editForm')));
  for (const f of Engine.COMPANY_FIELDS) if (f.num) data[f.key] = Engine.parseNumber(data[f.key]);
  data.role = Engine.normaliseRole(data.role);
  const contacts = dlg._contacts.filter(x => x.name || x.email).map(x => ({ ...x, email: (x.email || '').toLowerCase(), linkedin: x.linkedin ? Engine.cleanUrl(x.linkedin) : '' }));
  let c = dlg.dataset.id ? byId(dlg.dataset.id) : null;
  if (!c) { c = newCompany(data.name); state.companies.push(c); }
  Object.assign(c, data, { contacts });
  migrate(c);
  touch(c);
  renderCompanies();
  if (state.drawer?.id === c.id) renderDrawer();
  else if (!dlg.dataset.id) openDrawer(c.id);
});

// ---------- Match engine ----------
function renderWeights() {
  $('#weights').innerHTML = Object.entries(Engine.WEIGHT_LABELS).map(([k, label]) => `
    <div class="weight"><span>${label}</span><input type="range" min="0" max="50" value="${state.weights[k]}" data-w="${k}"><span>${state.weights[k]}</span></div>`).join('');
}
$('#weights').addEventListener('input', e => {
  const k = e.target.dataset.w;
  if (!k) return;
  state.weights[k] = Number(e.target.value);
  e.target.nextElementSibling.textContent = e.target.value;
  saveShared('weights', state.weights);
  runMatch();
});
$('#resetWeights').addEventListener('click', () => { state.weights = { ...Engine.DEFAULT_WEIGHTS }; saveShared('weights', state.weights); renderWeights(); runMatch(); });

function setDeal(id) {
  const deal = byId(id);
  if (!deal) return;
  state.campaign.dealId = id;
  state.campaign.project = null;
  $('#matchFor').value = deal.name;
  $('#matchForInfo').innerHTML = [deal.role, deal.sector, deal.subsector, deal.country, deal.revenue != null ? `${money(deal, deal.revenue)} revenue` : ''].filter(Boolean).map(esc).join(' · ');
  // Default: a target looks for buyers/investors, a buyer looks for targets.
  state.roleFilter = new Set(deal.role === 'Target' ? ['Buyer', 'Investor', ''] : deal.role ? ['Target', ''] : []);
  state.selected.clear();
  runMatch();
}
$('#matchFor').addEventListener('change', () => {
  const name = $('#matchFor').value.trim().toLowerCase();
  const c = state.companies.find(x => (x.name || '').toLowerCase() === name);
  if (c) setDeal(c.id); else toast('No company with that name.');
});

function renderRoleFilters() {
  const roles = [...new Set(state.companies.map(c => c.role || ''))];
  $('#roleFilters').innerHTML = roles.map(r => {
    const on = !state.roleFilter.size || state.roleFilter.has(r);
    return `<span class="chip ${on ? 'blue' : 'off'}" data-role="${esc(r)}">${esc(r || 'No role')}</span>`;
  }).join('');
}
$('#roleFilters').addEventListener('click', e => {
  const r = e.target.dataset.role;
  if (r === undefined) return;
  if (!state.roleFilter.size) state.roleFilter = new Set(state.companies.map(c => c.role || ''));
  state.roleFilter.has(r) ? state.roleFilter.delete(r) : state.roleFilter.add(r);
  runMatch();
});
['#onlyWithEmail', '#hideContacted', '#minScore'].forEach(s => $(s).addEventListener('input', runMatch));

function contactedFor(dealId) {
  return new Set(state.activity.filter(a => a.dealId === dealId && a.ok).map(a => a.companyId));
}

function runMatch() {
  renderRoleFilters();
  const deal = byId(state.campaign.dealId);
  if (!deal) { $('#matchTable tbody').innerHTML = '<tr><td colspan="9"><div class="empty">Choose a company on the left to find matches.</div></td></tr>'; if (!state.campaign.project) syncCampaign(); return; }
  const onlyEmail = $('#onlyWithEmail').checked, hide = $('#hideContacted').checked;
  const min = Number($('#minScore').value) || 0;
  const done = contactedFor(deal.id);
  state.matches = Engine.match(deal, state.companies, state.weights).filter(m =>
    m.score >= min &&
    (!state.roleFilter.size || state.roleFilter.has(m.company.role || '')) &&
    (!onlyEmail || Engine.hasEmail(m.company)) &&
    (!hide || !done.has(m.company.id)));
  $('#matchCount').textContent = `(${state.matches.length})`;
  $('#matchTable tbody').innerHTML = state.matches.slice(0, 500).map(({ company: c, score, reasons }) => {
    const pc = Engine.primaryContact(c);
    const n = c.contacts.filter(x => x.email).length;
    return `<tr>
      <td class="cb"><input type="checkbox" data-sel="${c.id}" ${state.selected.has(c.id) ? 'checked' : ''}></td>
      <td><span class="score" style="background:${scoreColor(score)}">${score}</span></td>
      <td><div class="co">${logo(c)}<button class="link co-name" data-open="${c.id}">${esc(c.name)}</button>${done.has(c.id) ? ' <span class="chip green">emailed</span>' : ''}</div></td>
      <td>${roleChip(c.role)}</td><td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${money(c, c.revenue)}</td><td>${esc(pc?.email || '')}${n > 1 ? ` <span class="muted">+${n - 1}</span>` : ''}</td>
      <td class="wrap">${reasons.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9"><div class="empty">No matches. Try lowering the minimum score or changing the role filter.</div></td></tr>';
  syncCampaign();
}
const scoreColor = s => (s >= 70 ? '#067647' : s >= 45 ? '#1d4ed8' : s >= 25 ? '#b54708' : '#98a2b3');

$('#matchTable').addEventListener('change', e => {
  const id = e.target.dataset.sel;
  if (!id) return;
  e.target.checked ? state.selected.add(id) : state.selected.delete(id);
  syncCampaign();
});
$('#matchTable').addEventListener('click', e => { if (e.target.dataset.open) openDrawer(e.target.dataset.open); });
$('#checkAll').addEventListener('change', e => { state.matches.forEach(m => (e.target.checked ? state.selected.add(m.company.id) : state.selected.delete(m.company.id))); runMatch(); });
$('#selectTop').addEventListener('click', () => { state.matches.slice(0, 25).forEach(m => state.selected.add(m.company.id)); runMatch(); });
$('#selectNone').addEventListener('click', () => { state.selected.clear(); runMatch(); });
$('#emailSelected').addEventListener('click', () => {
  if (!state.selected.size) return toast('Select at least one company first.');
  showTab('email');
});
$('#exportMatches').addEventListener('click', () => {
  const deal = byId(state.campaign.dealId);
  if (!deal) return;
  downloadSheet(state.matches.map(m => ({ score: m.score, ...flatten(m.company), reasons: m.reasons.join(' | ') })), `matches-${slug(deal.name)}.xlsx`);
});

function syncCampaign() {
  state.campaign.recipientIds = state.matches.map(m => m.company.id).filter(id => state.selected.has(id) && Engine.hasEmail(byId(id)));
}

// ---------- Email ----------
// Which contacts of a company get the email: 'primary' (first with email), 'all', or a contact index.
// 'primary' = the best person by department (M&A → Corp Dev → Strategy → CEO → CFO), verified emails first.
function sendsFor(c) {
  const best = Engine.bestContacts(c);
  const ch = state.contactChoice[c.id] ?? 'primary';
  if (ch === 'all') return best;
  if (ch === 'primary') return best.slice(0, 1);
  return c.contacts[+ch]?.email ? [c.contacts[+ch]] : best.slice(0, 1);
}
const allSends = () => state.campaign.recipientIds.map(byId).filter(Boolean).flatMap(c => sendsFor(c).map(contact => ({ company: c, contact })));

function currentTemplate() {
  return state.templates.find(t => t.id === $('#templateSelect').value) || state.templates[0];
}
function renderTemplates(selectId) {
  $('#templateSelect').innerHTML = state.templates.map(t => `<option value="${t.id}" ${t.id === selectId ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const t = currentTemplate();
  $('#subject').value = t.subject;
  $('#body').value = t.body;
}
$('#templateSelect').addEventListener('change', () => renderTemplates($('#templateSelect').value));
$('#saveTemplate').addEventListener('click', () => {
  Object.assign(currentTemplate(), { subject: $('#subject').value, body: $('#body').value });
  saveShared('templates', state.templates);
  toast('Template saved.');
});
$('#saveTemplateAs').addEventListener('click', () => {
  const name = prompt('Template name?');
  if (!name) return;
  const t = { id: uid(), name, subject: $('#subject').value, body: $('#body').value };
  state.templates.push(t);
  saveShared('templates', state.templates);
  renderTemplates(t.id);
});
$('#deleteTemplate').addEventListener('click', () => {
  if (state.templates.length <= 1) return toast('Keep at least one template.');
  const t = currentTemplate();
  if (!confirm(`Delete template "${t.name}"?`)) return;
  state.templates = state.templates.filter(x => x !== t);
  saveShared('templates', state.templates);
  renderTemplates(state.templates[0].id);
});
['#subject', '#body'].forEach(s => $(s).addEventListener('input', renderPreview));
$$('input[name=sendMode]').forEach(r => r.addEventListener('change', updateSendLabel));
const sendMode = () => $('input[name=sendMode]:checked').value;
function updateSendLabel() {
  const n = allSends().length;
  $('#sendBtn').textContent = sendMode() === 'send' ? `Send ${n} email${n === 1 ? '' : 's'}` : `Create ${n} Outlook draft${n === 1 ? '' : 's'}`;
  $('#sendBtn').disabled = !n;
}

// The company being sold: a company from the Match engine, or a project's deal profile.
function currentDeal() {
  if (state.campaign.dealId) return byId(state.campaign.dealId);
  const proj = state.campaign.project && state.projects.find(p => p.name === state.campaign.project);
  return proj ? dealOf(proj) : null;
}

function renderEmail() {
  const deal = currentDeal();
  const ids = state.campaign.recipientIds;
  $('#campaignInfo').innerHTML = deal ? `${state.campaign.project ? `Project <b>${esc(state.campaign.project)}</b> · sending moves each buyer to the next stage` : `Deal: <b>${esc(deal.name)}</b>`}` : 'No deal chosen. Pick buyers in a project or a company in the Match engine.';
  $('#recipientCount').textContent = `(${ids.length} companies · ${allSends().length} emails)`;
  if (!ids.includes(state.previewId)) state.previewId = ids[0] || null;
  $('#recipients').innerHTML = ids.map(id => {
    const c = byId(id);
    const best = Engine.bestContacts(c);
    const withEmail = best.map(x => ({ x, i: c.contacts.indexOf(x) }));
    const label = x => `${x.name || x.email}${x.role_tag || x.title ? ` (${x.role_tag || Engine.inferRoleTag(x.title)})` : ''}`;
    const ch = String(state.contactChoice[c.id] ?? 'primary');
    const sel = withEmail.length > 1 ? `<select data-cc="${id}">
        <option value="primary" ${ch === 'primary' ? 'selected' : ''}>Best: ${esc(label(withEmail[0].x))}</option>
        ${withEmail.slice(1).map(o => `<option value="${o.i}" ${ch === String(o.i) ? 'selected' : ''}>${esc(label(o.x))}</option>`).join('')}
        <option value="all" ${ch === 'all' ? 'selected' : ''}>All ${withEmail.length} contacts</option></select>`
      : `<span class="muted small">${esc(label(withEmail[0].x))} ${esc(withEmail[0].x.email)}</span>`;
    const st = sendsFor(c).map(x => state.sendStatus?.[c.id + '|' + x.email]).filter(Boolean).join(' ');
    return `<div class="recipient ${id === state.previewId ? 'active' : ''}" data-rid="${id}">
      <span>${esc(c.name)}</span>${sel}
      <span class="r-status ${st.includes('✗') ? 'err' : st ? 'ok' : ''}">${esc(st)}</span>
      <button class="link small" data-remove="${id}">remove</button></div>`;
  }).join('') || '<div class="muted small" style="padding:10px">No recipients selected.</div>';
  updateSendLabel();
  renderPreview();
}
$('#recipients').addEventListener('click', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
  const rm = e.target.dataset.remove;
  if (rm) { state.selected.delete(rm); state.campaign.recipientIds = state.campaign.recipientIds.filter(x => x !== rm); renderEmail(); return; }
  const row = e.target.closest('[data-rid]');
  if (row) { state.previewId = row.dataset.rid; renderEmail(); }
});
$('#recipients').addEventListener('change', e => {
  const id = e.target.dataset.cc;
  if (!id) return;
  state.contactChoice[id] = e.target.value;
  state.previewId = id;
  renderEmail();
});

function compose(deal, c, contact) {
  const extra = { sender_name: state.settings.senderName || '' };
  return { subject: Engine.render($('#subject').value, deal, c, contact, extra), body: Engine.render($('#body').value, deal, c, contact, extra) };
}
function renderPreview() {
  const deal = currentDeal(), c = byId(state.previewId);
  const contact = c && sendsFor(c)[0];
  if (!deal || !contact) { $('#preview').textContent = ''; return; }
  const m = compose(deal, c, contact);
  $('#preview').innerHTML = `<b>To:</b> ${contact.name ? `${esc(contact.name)} &lt;${esc(contact.email)}&gt;` : esc(contact.email)}\n<b>Subject:</b> ${esc(m.subject)}\n\n${esc(m.body)}`;
}

$('#sendBtn').addEventListener('click', async () => {
  const deal = currentDeal();
  const sends = allSends();
  if (!deal || !sends.length) return;
  const mode = sendMode();
  const verb = mode === 'send' ? 'SEND' : 'create drafts for';
  if (!confirm(`This will ${verb} ${sends.length} email(s) from your Outlook account for "${deal.name}". Continue?`)) return;
  let token;
  try { token = await getToken(); } catch (err) { return toast('Microsoft sign-in failed: ' + err.message, 8000); }

  $('#sendBtn').disabled = true;
  state.sendStatus = {};
  const cc = $('#cc').value.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const entries = [];
  const advanced = new Set();
  let ok = 0, fail = 0;
  for (let i = 0; i < sends.length; i++) {
    const { company: c, contact } = sends[i];
    const m = compose(deal, c, contact);
    $('#sendProgress').textContent = `${i + 1} / ${sends.length}: ${c.name} (${contact.email})…`;
    let result;
    try {
      await graphMail(token, mode, contact.email, cc, m.subject, m.body);
      result = mode === 'send' ? 'Sent' : 'Draft created';
      state.sendStatus[c.id + '|' + contact.email] = '✓';
      ok++;
      if (mode === 'send') {
        if (!c.status || c.status === 'New') c.status = 'Contacted';
        c.last_contacted = new Date().toISOString();
        // In a project, an email moves the buyer one outreach step (once per company).
        if (state.campaign.project && !advanced.has(c.id)) {
          advanced.add(c.id);
          const cur = c.projects.find(p => p.project === state.campaign.project)?.status;
          const next = nextOutreachStage(cur);
          if (next) moveStage(c, state.campaign.project, next, `email to ${contact.name || contact.email}`);
        }
        touch(c);
      }
    } catch (err) {
      result = 'Error: ' + err.message;
      state.sendStatus[c.id + '|' + contact.email] = '✗';
      fail++;
    }
    const entry = { id: uid(), date: new Date().toISOString(), dealId: deal.id, dealName: state.campaign.project || deal.name, companyId: c.id, companyName: c.name, contactName: contact.name || '', email: contact.email, subject: m.subject, result, ok: result === 'Sent', by: Store.user?.email || '' };
    state.activity.unshift(entry);
    entries.push(entry);
    renderEmail();
    if (i < sends.length - 1) await sleep((Number(state.settings.delaySec) || 3) * 1000);
  }
  try { await Store.addActivity(entries, state.activity); } catch (err) { toast('Could not save activity: ' + err.message); }
  renderCompanies();
  $('#sendProgress').innerHTML = `<span class="ok">${ok} done</span>${fail ? `, <span class="err">${fail} failed</span>` : ''}.` + (mode === 'draft' ? ' Open Outlook → Drafts to review and send.' : '');
  $('#sendBtn').disabled = false;
});

// ---------- Microsoft Graph ----------
const SCOPES = ['User.Read', 'Mail.Send', 'Mail.ReadWrite'];
let msalApp = null;
function getMsal() {
  const { clientId, tenantId } = state.settings;
  if (!clientId) throw new Error('Add your Azure Application (client) ID in Settings first.');
  if (!msalApp || msalApp._cid !== clientId + tenantId) {
    msalApp = new msal.PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId || 'organizations'}`, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' },
    });
    msalApp._cid = clientId + tenantId;
  }
  return msalApp;
}
async function signIn() {
  const app = getMsal();
  const r = await app.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
  app.setActiveAccount(r.account);
  renderAccount();
  return r.account;
}
async function getToken() {
  const app = getMsal();
  let account = app.getActiveAccount() || app.getAllAccounts()[0];
  if (!account) account = await signIn();
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch {
    return (await app.acquireTokenPopup({ scopes: SCOPES, account })).accessToken;
  }
}
function renderAccount() {
  let a = null;
  try { const app = state.settings.clientId && getMsal(); a = app && (app.getActiveAccount() || app.getAllAccounts()[0]); } catch { /* not configured */ }
  $('#account').textContent = a ? `Outlook: ${a.username}` : 'Outlook not connected';
}

const textToHtml = t => `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${esc(t).replace(/\n/g, '<br>')}</div>`;
async function graphMail(token, mode, to, cc, subject, body, attempt = 0) {
  const message = {
    subject,
    body: { contentType: 'HTML', content: textToHtml(body) },
    toRecipients: [{ emailAddress: { address: to } }],
    ccRecipients: cc.map(address => ({ emailAddress: { address } })),
  };
  const url = mode === 'send' ? 'https://graph.microsoft.com/v1.0/me/sendMail' : 'https://graph.microsoft.com/v1.0/me/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mode === 'send' ? { message, saveToSentItems: true } : message),
  });
  if (res.status === 429 && attempt < 3) {
    await sleep((Number(res.headers.get('Retry-After')) || 10) * 1000);
    return graphMail(token, mode, to, cc, subject, body, attempt + 1);
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
}

// ---------- Activity ----------
function renderActivity() {
  const q = $('#activitySearch').value.toLowerCase();
  const list = state.activity.filter(a => !q || [a.dealName, a.companyName, a.contactName, a.email, a.subject, a.result].join(' ').toLowerCase().includes(q));
  $('#activityTable tbody').innerHTML = list.slice(0, 1000).map(a => `
    <tr><td>${new Date(a.date).toLocaleString()}</td><td>${esc(a.dealName)}</td><td>${esc(a.companyName)}</td><td>${esc(a.contactName ? `${a.contactName} <${a.email}>` : a.email)}</td><td>${esc(a.subject)}</td>
    <td class="${a.result.startsWith('Error') ? 'err' : 'ok'}">${esc(a.result)}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">No emails yet.</div></td></tr>';
}
$('#activitySearch').addEventListener('input', renderActivity);
$('#exportActivity').addEventListener('click', () => downloadSheet(state.activity.map(({ id, dealId, companyId, ok, ...rest }) => rest), 'activity.xlsx'));

// ---------- Settings ----------
const OUTLOOK_KEYS = ['clientId', 'tenantId', 'senderName', 'delaySec'];
function renderSettings() {
  for (const k of OUTLOOK_KEYS) $('#' + k).value = state.settings[k] ?? '';
  $('#anthropicKey').value = state.settings.anthropicKey || '';
  $('#enrichModel').innerHTML = Object.entries(Enricher.MODELS).map(([id, m]) => `<option value="${id}" ${id === state.settings.enrichModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  $('#enrichParallel').value = state.settings.enrichParallel;
  $('#enrichSkipDays').value = state.settings.enrichSkipDays;
  renderSpend();

  const fromConfig = !!(window.CRM_CONFIG?.supabaseUrl && window.CRM_CONFIG?.supabaseAnonKey);
  $('#dbStatus').innerHTML = Store.mode === 'cloud'
    ? `<p><span class="chip green">Connected</span> ${Store.user ? 'Logged in as <b>' + esc(Store.user.email) + '</b>' : ''}</p>`
    : '<p><span class="chip amber">Not connected</span> Data is stored in this browser only.</p>';
  $('#dbConfig').hidden = fromConfig;
  $('#sbUrl').value = localStorage.getItem('crm.supabaseUrl') || '';
  $('#sbKey').value = localStorage.getItem('crm.supabaseAnonKey') || '';
  $('#copyLocal').hidden = Store.mode !== 'cloud';
  $('#signOutDb').hidden = Store.mode !== 'cloud';
}
function renderSpend() {
  const s = state.settings.spend;
  $('#claudeSpend').textContent = s.count ? `So far in this browser: ${s.count} companies researched · ≈ $${s.usd.toFixed(2)} (≈ $${(s.usd / s.count).toFixed(2)} each)` : '';
}
$('#saveSettings').addEventListener('click', () => {
  for (const k of OUTLOOK_KEYS) state.settings[k] = $('#' + k).value.trim();
  saveSettingsLocal();
  renderAccount();
  toast('Settings saved.');
});
$('#saveClaude').addEventListener('click', () => {
  state.settings.anthropicKey = $('#anthropicKey').value.trim();
  state.settings.enrichModel = $('#enrichModel').value;
  state.settings.enrichParallel = Number($('#enrichParallel').value) || 2;
  state.settings.enrichSkipDays = Number($('#enrichSkipDays').value) || 0;
  saveSettingsLocal();
  toast('Claude settings saved.');
});
$('#saveDb').addEventListener('click', () => {
  const u = $('#sbUrl').value.trim(), k = $('#sbKey').value.trim();
  if (!u || !k) { localStorage.removeItem('crm.supabaseUrl'); localStorage.removeItem('crm.supabaseAnonKey'); }
  else { localStorage.setItem('crm.supabaseUrl', u); localStorage.setItem('crm.supabaseAnonKey', k); }
  location.reload();
});
$('#signOutDb').addEventListener('click', async () => { await flush(); await Store.signOut(); location.reload(); });
$('#copyLocal').addEventListener('click', async () => {
  const local = (await Store.localCompanies()).map(migrate);
  if (!local.length) return toast('There is no data stored in this browser.');
  if (!confirm(`Copy ${local.length} companies from this browser into the team database? Duplicates are merged.`)) return;
  const idx = Engine.buildIndex(state.companies);
  let added = 0, merged = 0;
  for (const c of local) {
    const same = Engine.findDuplicates(c, idx).exact[0];
    if (same) { Engine.mergeCompanies(same, c); touch(same); merged++; }
    else { state.companies.push(c); Engine.indexAdd(idx, c); touch(c); added++; }
  }
  await flush();
  renderCompanies();
  toast(`Copied: ${added} new, ${merged} merged.`, 6000);
});
$('#signIn').addEventListener('click', async () => { try { await signIn(); toast('Signed in.'); } catch (e) { toast(e.message, 6000); } });
$('#signOut').addEventListener('click', async () => { try { const app = getMsal(); await app.logoutPopup({ account: app.getActiveAccount() }); } catch (e) { toast(e.message); } renderAccount(); });

// ---------- Backup ----------
$('#backup').addEventListener('click', () => {
  const data = { version: 4, exported: new Date().toISOString(), companies: state.companies.map(({ _norm, _domain, ...c }) => c), projects: state.projects, templates: state.templates, activity: state.activity, weights: state.weights, mappingMemory: state.mappingMemory };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `mna-crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$('#restore').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.companies)) throw new Error('Not a CRM backup file');
    if (!confirm(`Restore ${d.companies.length} companies from this backup? Companies with the same ID are overwritten; others are kept.`)) return;
    const incoming = d.companies.map(migrate);
    const map = new Map(state.companies.map(c => [c.id, c]));
    incoming.forEach(c => map.set(c.id, c));
    state.companies = [...map.values()];
    incoming.forEach(c => dirty.add(c.id));
    for (const p of d.projects || []) {
      const cur = state.projects.find(x => x.name.toLowerCase() === p.name.toLowerCase());
      if (cur) Object.assign(cur, { ...p, id: cur.id }); else state.projects.push(p);
    }
    syncProjectsFromCompanies();
    saveShared('projects', state.projects);
    if (d.templates?.length) { state.templates = d.templates; saveShared('templates', state.templates); }
    if (d.weights) { state.weights = d.weights; saveShared('weights', state.weights); }
    if (d.mappingMemory) { state.mappingMemory = d.mappingMemory; saveShared('mappingMemory', state.mappingMemory); }
    await flush();
    renderAll();
    toast('Backup restored.');
  } catch (err) { toast('Restore failed: ' + err.message, 6000); }
});
$('#exportAll').addEventListener('click', () => downloadSheet(state.companies.map(flatten), `crm-companies-${new Date().toISOString().slice(0, 10)}.xlsx`));
$('#wipe').addEventListener('click', async () => {
  const who = Store.mode === 'cloud' ? 'for the WHOLE TEAM' : 'from this browser';
  if (prompt(`This deletes all ${state.companies.length} companies ${who}. Download a backup first.\n\nType DELETE to confirm.`) !== 'DELETE') return;
  state.campaign = { dealId: null, recipientIds: [] };
  await removeCompanies(state.companies.map(c => c.id));
  renderAll();
});

// ---------- Helpers ----------
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// One row per company for Excel exports.
function flatten(c) {
  const row = Object.fromEntries(Engine.COMPANY_FIELDS.map(f => [f.label, c[f.key] ?? '']));
  c.contacts.forEach((x, i) => {
    const n = i ? ` ${i + 1}` : '';
    Object.assign(row, { [`Contact name${n}`]: x.name || '', [`Function${n}`]: x.title || '', [`E-mail${n}`]: x.email || '', [`Phone${n}`]: x.phone || '', [`LinkedIn${n}`]: x.linkedin || '' });
  });
  row.Acquisitions = (c.acquisitions || []).map(a => `${a.target}${a.date || a.year ? ` (${a.date || a.year})` : ''}${a.industry ? ` – ${a.industry}` : ''}${a.deal_value ? `, ${a.deal_value}` : ''}`).join('; ');
  row['# Acquisitions'] = (c.acquisitions || []).length;
  row.Projects = c.projects.map(p => [p.project, p.status].filter(Boolean).join(': ')).join(' | ');
  row.Sources = c.sources.join('; ');
  row['Researched by Claude'] = c.enrichment ? c.enrichment.at.slice(0, 10) : '';
  return row;
}
function downloadSheet(rows, filename) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, filename);
}

function renderAll() {
  renderDashboard();
  renderConnectors();
  renderProjects();
  renderCompanies();
  renderWeights();
  renderSettings();
  renderTemplates(state.templates[0].id);
  runMatch();
  renderAccount();
}

// ---------- Start ----------
async function loadData() {
  setSync('Loading…');
  const [companies, templates, activity, weights, mapping, projects] = await Promise.all([
    Store.loadCompanies(), Store.getState('templates', null), Store.loadActivity(), Store.getState('weights', null), Store.getState('mappingMemory', null), Store.getState('projects', null),
  ]);
  state.companies = companies.map(migrate);
  state.projects = projects || [];
  syncProjectsFromCompanies();
  state.templates = templates?.length ? templates : [DEFAULT_TEMPLATE];
  state.activity = activity || [];
  state.weights = { ...Engine.DEFAULT_WEIGHTS, ...(weights || {}) };
  state.mappingMemory = mapping || {};
  setSync(`${state.companies.length.toLocaleString()} companies loaded`);
  renderAll();
}

// Starts after all scripts (including projects.js) have loaded.
window.addEventListener('DOMContentLoaded', async function init() {
  try {
    const { mode, user } = await Store.init();
    if (mode === 'cloud' && !user) {
      $('#login').hidden = false;
      $('#loginEmail').placeholder = `you@${Store.domain}`;
      $('#loginBtn').addEventListener('click', async () => {
        $('#loginMsg').textContent = 'Sending…';
        try {
          await Store.sendLoginLink($('#loginEmail').value);
          $('#loginMsg').innerHTML = '<span class="ok">Check your inbox and click the link in the email.</span>';
        } catch (err) { $('#loginMsg').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
      });
      return;
    }
    await loadData();
  } catch (err) {
    console.error(err);
    setSync('Could not load data', true);
    toast('Could not load data: ' + err.message, 10000);
    renderAll();
  }
});
