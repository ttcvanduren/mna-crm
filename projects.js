/* global Engine, state, byId, esc, logo, roleChip, money, openDrawer, saveShared, uid, toast, touch, flush, downloadSheet, slug, showTab, norm, ago */
// Projects: one record per mandate (e.g. Lakeside for Inovoo). Companies link to it through company.projects[].project.
const STAGE_COLORS = { 'Not approached': '#98a2b3', Approached: '#1d4ed8', Engaged: '#067647', Passed: '#b42318', Other: '#b54708' };
const STAGE_CHIP = { 'Not approached': '', Approached: 'blue', Engaged: 'green', Passed: 'red', Other: 'amber' };
const PROJECT_STATUSES = ['Active', 'On hold', 'Closed – deal', 'Closed – no deal'];
const TARGET_FIELDS = [
  ['codename', 'Codename in emails', 'e.g. a German input-management software company'],
  ['website', 'Website', 'inovoo.com'],
  ['sector', 'Sector', 'e.g. Input management / IDP'],
  ['subsector', 'Sub-sector', 'e.g. AI document capture for insurers'],
  ['country', 'Country', 'Germany'],
  ['revenue', 'Revenue (EUR m)', 'e.g. 8.5'],
  ['ebitda', 'EBITDA (EUR m)', 'e.g. 1.6'],
  ['employees', 'Employees', 'e.g. 60'],
  ['keywords', 'Keywords for matching', 'e.g. input management; IDP; OCR; insurance; health insurers; document AI'],
  ['description', 'Description', 'What the company does, customers, products, geography, why it is attractive'],
];

const saveProjects = () => saveShared('projects', state.projects);

function ensureProject(name, extra = {}) {
  name = norm(name);
  if (!name) return null;
  let p = state.projects.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    p = { id: uid(), name, client: '', status: 'Active', description: '', created: new Date().toISOString(), ...extra };
    state.projects.push(p);
    saveProjects();
  } else if (extra.client && !p.client) { p.client = extra.client; saveProjects(); }
  return p;
}

// Project names that exist on companies but have no record yet (e.g. after a restore).
function syncProjectsFromCompanies() {
  const known = new Set(state.projects.map(p => p.name.toLowerCase()));
  const found = new Set(state.companies.flatMap(c => c.projects.map(p => p.project)).filter(Boolean));
  let added = false;
  for (const n of found) if (!known.has(n.toLowerCase())) { state.projects.push({ id: uid(), name: n, client: '', status: 'Active', description: '', created: new Date().toISOString() }); added = true; }
  if (added) saveProjects();
}

const members = name => state.companies.map(c => ({ c, p: c.projects.find(x => x.project === name) })).filter(m => m.p);
const stageChip = s => s ? `<span class="chip ${STAGE_CHIP[Engine.stageGroup(s)]}">${esc(s)}</span>` : '<span class="chip">Not approached</span>';

function stats(name) {
  const m = members(name);
  const groups = Object.fromEntries(Engine.STAGE_GROUPS.map(g => [g, 0]));
  let last = '';
  for (const { p } of m) {
    groups[Engine.stageGroup(p.status)]++;
    if (/^\d{4}-\d{2}-\d{2}/.test(p.last_contact || '') && p.last_contact > last) last = p.last_contact;
  }
  // Responsible columns sometimes hold notes ("Do not approach"); keep only initials.
  const team = [...new Set(m.map(x => norm(x.p.responsible)).filter(r => /^[A-Za-z]{2,4}$/.test(r)))];
  return { total: m.length, groups, last, team };
}

function stackBar(groups, total) {
  return `<div class="stack">${Engine.STAGE_GROUPS.filter(g => groups[g]).map(g => `<div title="${g}: ${groups[g]}" style="width:${(groups[g] / total) * 100}%;background:${STAGE_COLORS[g]}"></div>`).join('')}</div>`;
}

// ---------- Rendering ----------
function renderProjectNav() {
  $('#navProjects').innerHTML = state.projects.filter(p => p.status === 'Active').map(p =>
    `<button class="subtab ${state.projectView === p.name ? 'active' : ''}" data-nav-project="${esc(p.name)}">${esc(p.name)}</button>`).join('');
}
$('#navProjects').addEventListener('click', e => {
  const n = e.target.dataset.navProject;
  if (n === undefined) return;
  state.projectView = n;
  showTab('projects');
});

function renderProjects() {
  renderProjectNav();
  if (state.projectView && state.projects.some(p => p.name === state.projectView)) return renderProjectDetail(state.projectView);
  state.projectView = null;
  const order = s => PROJECT_STATUSES.indexOf(s);
  const list = [...state.projects].sort((a, b) => order(a.status) - order(b.status) || a.name.localeCompare(b.name));
  const multi = state.companies.filter(c => c.projects.length > 1).length;
  $('#projectsView').innerHTML = `<div class="page-head">
      <div><h1>Projects</h1><div class="muted">${list.length} projects · ${state.companies.length.toLocaleString()} companies in the database · ${multi} approached in more than one project</div></div>
      <div class="actions"><button class="btn" id="newProject">+ New project</button><button class="btn primary" id="projImport">Import buyer list</button></div>
    </div>
    <div class="project-grid">${list.map(p => {
      const s = stats(p.name);
      const reached = s.total - s.groups['Not approached'];
      return `<div class="project-card" data-project="${esc(p.name)}">
        <div class="pc-head"><div><div class="pc-name">${esc(p.name)}</div><div class="muted small">${esc(p.client || 'No client set')}</div></div>
          <span class="chip ${p.status === 'Active' ? 'green' : ''}">${esc(p.status)}</span></div>
        <div class="pc-nums"><div><b>${s.total}</b><span>buyers</span></div><div><b>${reached}</b><span>contacted</span></div>
          <div><b style="color:${STAGE_COLORS.Engaged}">${s.groups.Engaged}</b><span>engaged</span></div><div><b style="color:${STAGE_COLORS.Passed}">${s.groups.Passed}</b><span>passed</span></div></div>
        ${s.total ? stackBar(s.groups, s.total) : '<div class="stack"></div>'}
        <div class="muted small">${s.last ? `Last contact ${esc(s.last)}` : 'No contact yet'}${s.team.length ? ` · Team ${esc(s.team.join(', '))}` : ''}</div>
      </div>`;
    }).join('') || '<div class="empty">No projects yet. Import a buyer list to create the first project.</div>'}</div>`;
}

const pf = { q: '', group: '', tier: '', resp: '' };
function renderProjectDetail(name) {
  const proj = state.projects.find(p => p.name === name);
  const all = members(name);
  const s = stats(name);
  const q = pf.q.toLowerCase();
  const rows = all.filter(({ c, p }) =>
    (!pf.group || Engine.stageGroup(p.status) === pf.group) &&
    (!pf.tier || String(p.tier) === pf.tier) &&
    (!pf.resp || p.responsible === pf.resp) &&
    (!q || [c.name, c.sector, c.subsector, c.country, p.status, p.log, p.remarks, p.rationale, p.pass_reason].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(a.p.tier || 9).localeCompare(String(b.p.tier || 9)) || a.c.name.localeCompare(b.c.name));
  const tiers = [...new Set(all.map(m => m.p.tier).filter(Boolean))].sort();
  const resps = [...new Set(all.map(m => norm(m.p.responsible)).filter(r => /^[A-Za-z]{2,4}$/.test(r)))].sort();
  const opt = (vals, cur, all) => `<option value="">${all}</option>` + vals.map(v => `<option ${String(v) === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

  const tab = state.projectTab || 'overview';
  const due = followUpsDue(name).length;
  const tabs = [['overview', 'Overview'], ['buyers', `Buyers (${all.length})`], ['board', 'Pipeline board'], ['find', '✦ Find buyers'], ['followups', `Follow-ups${due ? ` <span class="badge">${due}</span>` : ''}`]];
  const head = `<div class="page-head">
      <div><button class="link small" id="backProjects">← All projects</button>
        <h1>${esc(proj.name)} <span class="chip ${proj.status === 'Active' ? 'green' : ''}" style="vertical-align:middle">${esc(proj.status)}</span></h1>
        <div class="muted">${esc(proj.client || 'No client set')}${proj.target?.sector ? ' · ' + esc(proj.target.sector) : ''}${proj.description ? ' · ' + esc(proj.description) : ''}</div></div>
      <div class="actions"><button class="btn" id="editProject">Edit project & deal profile</button><button class="btn" id="exportProject">Export Excel</button></div>
    </div>
    <div class="page-tabs">${tabs.map(([k, l]) => `<button data-ptab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  if (tab !== 'buyers') { $('#projectsView').innerHTML = head + `<div id="projectBody"></div>`; return renderProjectTab(proj, tab); }

  $('#projectsView').innerHTML = head + `
    <div class="funnel">${Engine.STAGE_GROUPS.filter(g => g !== 'Other' || s.groups.Other).map(g => `<button class="funnel-step ${pf.group === g ? 'on' : ''}" data-group="${g}" style="--c:${STAGE_COLORS[g]}">
        <b>${s.groups[g]}</b><span>${g}</span><i>${s.total ? Math.round((s.groups[g] / s.total) * 100) : 0}%</i></button>`).join('')}</div>
    <div class="filters">
      <input type="search" id="pfSearch" placeholder="Search buyers, notes, rationale…" value="${esc(pf.q)}">
      <select id="pfTier">${opt(tiers, pf.tier, 'All tiers')}</select>
      <select id="pfResp">${opt(resps, pf.resp, 'Everyone')}</select>
      ${pf.group || pf.tier || pf.resp || pf.q ? '<button class="btn ghost sm" id="pfClear">Clear filters</button>' : ''}
      <span class="muted small">${rows.length} of ${all.length} buyers</span>
      <span class="spacer"></span>
      <select id="pfMove"><option value="">Move selected to…</option>${Engine.BOARD_STAGES.map(s => `<option>${s}</option>`).join('')}</select>
      <button class="btn" id="projResearch">✦ Export for research</button>
      <button class="btn" id="pfPeople">👤 Find people</button>
      <button class="btn primary" id="pfEmail">✉ Email selected</button>
    </div>
    <div class="table-wrap">
      <table class="data" id="projectTable"><thead><tr>
        <th class="cb"><input type="checkbox" id="pfAll"></th><th>Company</th><th>Tier</th><th>Heat</th><th>Current stage</th><th>Furthest</th><th>Resp.</th><th>Last contact</th><th>People</th><th>Rationale / notes</th>
      </tr></thead><tbody>
      ${rows.slice(0, 400).map(({ c, p }) => `<tr data-id="${c.id}" class="${state.picked.has(c.id) ? 'sel' : ''}">
        <td class="cb"><input type="checkbox" data-pick="${c.id}" ${state.picked.has(c.id) ? 'checked' : ''}></td>
        <td>${companyCell(c)}</td>
        <td>${p.tier ? `<span class="tier t${esc(p.tier)}">T${esc(p.tier)}</span>` : ''}</td>
        <td>${heatChip(c, p)}</td>
        <td>${stageChip(p.status)} ${conflictChip(c, name)}</td>
        <td class="small">${p.furthest_stage && p.furthest_stage !== p.status ? esc(p.furthest_stage) : ''}</td>
        <td>${esc(p.responsible || '')}</td>
        <td class="small">${esc(p.last_contact || '')}</td>
        <td class="small">${c.contacts.length ? `${c.contacts.length} · ${c.contacts.filter(x => x.email).length} ✉` : '–'}</td>
        <td class="wrap small muted" title="${esc([p.rationale, p.pass_reason && 'Pass reason: ' + p.pass_reason, p.log].filter(Boolean).join('\n'))}">${esc((p.pass_reason ? 'Passed: ' + p.pass_reason : p.rationale || p.log || p.remarks || '').slice(0, 140))}</td>
      </tr>`).join('') || '<tr><td colspan="9"><div class="empty">No buyers match.</div></td></tr>'}
      </tbody></table>
    </div>`;
}

// Name cell with direct links, shared by the company list and project pages.
function companyCell(c) {
  const sub = c.short_description || [c.sector, c.country].filter(Boolean).join(' · ');
  const site = c.website ? Engine.cleanUrl(c.website) : '';
  return `<div class="co">${logo(c)}<div style="min-width:0">
    <div class="co-line"><span class="co-name">${esc(c.name)}</span>
      ${site ? `<a class="ext" href="${esc(site)}" target="_blank" rel="noopener" title="Open ${esc(c._domain || site)}">↗ ${esc(c._domain || 'website')}</a>` : ''}
      ${c.linkedin_url ? `<a class="ext li" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener" title="LinkedIn">in</a>` : ''}
    </div>
    <div class="co-sub" title="${esc(sub)}">${esc(sub)}</div></div></div>`;
}

$('#projectsView').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('[data-project]');
  if (card) { state.projectView = card.dataset.project; state.projectTab = 'overview'; Object.assign(pf, { q: '', group: '', tier: '', resp: '' }); return renderProjects(); }
  const id = e.target.id;
  const ptab = e.target.closest('[data-ptab]');
  if (ptab) { state.projectTab = ptab.dataset.ptab; return renderProjects(); }
  if (id === 'backProjects') { state.projectView = null; return renderProjects(); }
  if (id === 'pfPeople') {
    const ids = members(state.projectView).map(m => m.c.id).filter(i => state.picked.has(i));
    if (!ids.length) return toast('Select buyers first.');
    return apolloBulk(ids);
  }
  if (id === 'pfEmail') {
    const ids = members(state.projectView).map(m => m.c.id).filter(i => state.picked.has(i));
    return emailFromProject(state.projectView, ids);
  }
  if (id === 'newProject') return openProjectDialog(null);
  if (id === 'editProject') return openProjectDialog(state.projectView);
  if (id === 'projImport') return $('#upload').click();
  if (id === 'pfClear') { Object.assign(pf, { q: '', group: '', tier: '', resp: '' }); return renderProjects(); }
  if (id === 'exportProject') {
    const rows = members(state.projectView).map(({ c, p }) => ({ ...flatten(c), 'Project tier': p.tier || '', 'Project stage': p.status || '', 'Furthest stage': p.furthest_stage || '', Responsible: p.responsible || '', 'Last contact': p.last_contact || '', Rationale: p.rationale || '', 'Pass reason': p.pass_reason || '', Log: p.log || '' }));
    return downloadSheet(rows, `project-${slug(state.projectView)}.xlsx`);
  }
  if (id === 'projResearch') {
    const ids = state.picked.size ? [...state.picked] : members(state.projectView).map(m => m.c.id);
    const keep = new Set(state.picked);
    state.picked = new Set(ids);
    $('#bulkResearchExport').click();
    state.picked = keep;
    return;
  }
  const step = e.target.closest('[data-group]');
  if (step) { pf.group = pf.group === step.dataset.group ? '' : step.dataset.group; return renderProjects(); }
  if (e.target.dataset.pick) { e.target.checked ? state.picked.add(e.target.dataset.pick) : state.picked.delete(e.target.dataset.pick); e.target.closest('tr').classList.toggle('sel', e.target.checked); return; }
  if (id === 'pfAll') { $$('#projectTable [data-pick]').forEach(cb => { cb.checked = e.target.checked; e.target.checked ? state.picked.add(cb.dataset.pick) : state.picked.delete(cb.dataset.pick); cb.closest('tr').classList.toggle('sel', cb.checked); }); return; }
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDrawer(tr.dataset.id, 'projects');
});
$('#projectsView').addEventListener('change', e => {
  if (e.target.id === 'pfMove' && e.target.value) {
    const ids = members(state.projectView).map(m => m.c.id).filter(id => state.picked.has(id));
    if (!ids.length) { e.target.value = ''; return toast('Select buyers first.'); }
    ids.forEach(id => moveStage(byId(id), state.projectView, e.target.value));
    toast(`${ids.length} buyers moved to ${e.target.value}.`);
    return renderProjects();
  }
  if (e.target.id === 'pfTier') { pf.tier = e.target.value; renderProjects(); }
  if (e.target.id === 'pfResp') { pf.resp = e.target.value; renderProjects(); }
});
let pfTimer;
$('#projectsView').addEventListener('input', e => {
  if (e.target.id !== 'pfSearch') return;
  pf.q = e.target.value;
  clearTimeout(pfTimer);
  pfTimer = setTimeout(() => { renderProjects(); const s = $('#pfSearch'); s.focus(); s.setSelectionRange(pf.q.length, pf.q.length); }, 200);
});

// ---------- Create / edit ----------
function openProjectDialog(name) {
  const p = name ? state.projects.find(x => x.name === name) : { name: '', client: '', status: 'Active', description: '' };
  const dlg = $('#projectDialog');
  dlg.dataset.name = name || '';
  $('#projectForm').innerHTML = `<h2>${name ? 'Edit project' : 'New project'}</h2>
    <div class="form-grid">
      <label>Project name <input name="name" value="${esc(p.name)}" required placeholder="e.g. Thames"></label>
      <label>Client <input name="client" value="${esc(p.client)}" placeholder="e.g. Teavaro"></label>
      <label>Status <select name="status">${PROJECT_STATUSES.map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Sector <input name="sector" value="${esc(p.sector || '')}" placeholder="e.g. Customer data platform"></label>
      <label class="full">Project note <input name="description" value="${esc(p.description || '')}" placeholder="e.g. Sell-side, sovereign document editor, launched Sep-2026"></label>
    </div>
    <h3>Deal profile: the company you're selling</h3>
    <p class="muted small">Used by <b>Find buyers</b>, the valuation and the email placeholders ({{deal_sector}}, {{deal_country}}, {{deal_revenue}}…).</p>
    <div class="form-grid">
      ${TARGET_FIELDS.map(([k, label, ph]) => `<label class="${k === 'description' || k === 'keywords' ? 'full' : ''}">${label}${k === 'description'
        ? `<textarea name="t_${k}" rows="4" placeholder="${esc(ph)}">${esc(p.target?.[k] ?? '')}</textarea>`
        : `<input name="t_${k}" value="${esc(p.target?.[k] ?? '')}" placeholder="${esc(ph)}">`}</label>`).join('')}
    </div>
    <div class="toolbar"><span class="spacer"></span><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="save">Save</button></div>`;
  dlg.showModal();
}
$('#projectDialog').addEventListener('close', () => {
  const dlg = $('#projectDialog');
  if (dlg.returnValue !== 'save') return;
  const raw = Object.fromEntries(new FormData($('#projectForm')));
  const d = {}, target = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith('t_')) target[k.slice(2)] = v.trim(); else d[k] = v;
  for (const k of ['revenue', 'ebitda', 'employees']) target[k] = Engine.parseNumber(target[k]);
  d.target = target;
  d.name = norm(d.name);
  if (!d.name) return;
  const old = dlg.dataset.name;
  if (!old) { if (state.projects.some(p => p.name.toLowerCase() === d.name.toLowerCase())) return toast('A project with that name already exists.'); ensureProject(d.name, d); }
  else {
    const p = state.projects.find(x => x.name === old);
    if (d.name !== old) {
      // Renaming moves every buyer's history to the new name.
      for (const c of state.companies) for (const pr of c.projects) if (pr.project === old) { pr.project = d.name; touch(c); }
      if (state.projectView === old) state.projectView = d.name;
    }
    Object.assign(p, d);
    saveProjects();
  }
  renderProjects();
  renderCompanies();
});
