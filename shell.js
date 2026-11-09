/* global state, $, $$, esc, showTab, openDrawer, Engine, Store */
// App shell: menu icons, collapsible sidebar, breadcrumb, global search (Ctrl K) and the status in the top bar.

// Line icons (24×24, stroke), drawn in the current text colour.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  presentation: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4"/><path d="M8 20h8"/><path d="M7 12l3-3 2 2 4-4"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/><path d="M10 21v-3h4v3"/>',
  arrows: '<path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  scale: '<path d="M12 3v18"/><path d="M7 21h10"/><path d="M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0z"/><path d="M19 7l-3 7a3 3 0 0 0 6 0z"/>',
  flame: '<path d="M12 21a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8a7 7 0 0 0 7 7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  chevrons: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
$$('[data-icon]').forEach(el => { (el.classList.contains('ico') ? el : el.querySelector('.ico')).innerHTML = svg(el.dataset.icon); });
$$('.tab').forEach(b => { b.title = b.querySelector('.lbl')?.textContent || ''; });

// Loading placeholders until the database has loaded (the first render replaces them).
{
  const row = () => `<tr><td class="cb"></td><td><div class="co"><span class="skel sq"></span><div style="flex:1"><span class="skel w60"></span><span class="skel w40" style="margin-top:6px;height:9px"></span></div></div></td>${'<td><span class="skel w80"></span></td>'.repeat(9)}</tr>`;
  const tb = $('#companyTable tbody');
  if (tb && !tb.children.length) tb.innerHTML = Array.from({ length: 10 }, row).join('');
  const dash = $('#dashboardView');
  if (dash && !dash.children.length) {
    dash.innerHTML = `<div class="page-head"><div style="width:280px"><span class="skel" style="height:28px;width:200px"></span><span class="skel w60" style="margin-top:10px"></span></div></div>
      <div class="kpis">${'<div class="kpi"><span class="skel w60" style="height:9px"></span><span class="skel w40" style="height:26px;margin-top:10px"></span></div>'.repeat(6)}</div>
      <div class="dash-grid">${'<div class="card"><span class="skel w40" style="height:14px"></span><span class="skel w80" style="margin-top:16px"></span><span class="skel w60" style="margin-top:10px"></span><span class="skel w80" style="margin-top:10px"></span></div>'.repeat(2)}</div>`;
  }
}

// Collapsible sidebar (remembered in this browser).
const NAV_KEY = 'mna-crm-nav-collapsed';
function setCollapsed(on) {
  $('#app').classList.toggle('collapsed', on);
  $('#collapseNav').title = on ? 'Expand menu' : 'Collapse menu';
  try { localStorage.setItem(NAV_KEY, on ? '1' : ''); } catch { /* not critical */ }
}
try { setCollapsed(localStorage.getItem(NAV_KEY) === '1'); } catch { /* storage blocked */ }
$('#collapseNav').addEventListener('click', () => setCollapsed(!$('#app').classList.contains('collapsed')));

// Breadcrumb: menu group / page (and the open project).
function onTabShown(name) {
  const btn = $(`.tab[data-tab="${name}"]`);
  let group = btn?.previousElementSibling;
  while (group && !group.classList.contains('nav-group')) group = group.previousElementSibling;
  $('#crumbGroup').textContent = group?.textContent || '';
  $('#crumbPage').textContent = (btn?.querySelector('.lbl')?.textContent || name) + (name === 'projects' && state.projectView ? ` · ${state.projectView}` : '');
  document.title = `${$('#crumbPage').textContent} · 33 Equity`;
}

// Status in the top bar mirrors the sidebar's save status; the avatar shows the signed-in user.
function renderTopStatus() {
  const saving = /saving/i.test($('#syncStatus').textContent), failed = /fail/i.test($('#syncStatus').textContent);
  $('#topSync').innerHTML = `<span class="dot ${failed ? 'bad' : saving ? 'busy' : ''}"></span>${failed ? 'Save failed' : saving ? 'Saving…' : 'All changes saved'}`;
  const who = Store.user?.email || '';
  $('#avatar').textContent = who ? who.split('@')[0].split(/[._-]/).map(s => s[0]).join('').slice(0, 2).toUpperCase() : '33';
  $('#avatar').title = who || (Store.mode === 'cloud' ? 'Team database' : 'Data in this browser');
}
new MutationObserver(renderTopStatus).observe($('#syncStatus'), { childList: true, subtree: true, characterData: true });

// Global search: companies (name, alias, website), projects and pitches. Enter opens the first hit.
let gsHits = [], gsIndex = 0;
function runGlobalSearch(q) {
  const box = $('#gsResults');
  q = q.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; gsHits = []; return; }
  const nq = Engine.normName(q);
  const companies = [];
  for (const c of state.companies) {
    const name = c._norm || Engine.normName(c.name);
    const rank = name === nq ? 0 : name.startsWith(nq) ? 1 : name.includes(nq) || (c.aliases || []).some(a => Engine.normName(a).includes(nq)) ? 2 : String(c.website || '').toLowerCase().includes(q) ? 3 : -1;
    if (rank >= 0) companies.push([rank, (c.projects || []).length ? 0 : 1, c]);
    if (companies.length > 400) break;
  }
  companies.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].name.length - b[2].name.length);
  const projects = (state.projects || []).filter(p => p.name.toLowerCase().includes(q) || String(p.client || '').toLowerCase().includes(q)).slice(0, 4);
  const pitches = (state.pitches || []).filter(p => String(p.cs?.target?.name || p.name || '').toLowerCase().includes(q)).slice(0, 3);
  gsHits = [
    ...projects.map(p => ({ kind: 'Project', label: p.name, sub: p.client || p.status || '', go: () => { state.projectView = p.name; showTab('projects'); } })),
    ...pitches.map(p => ({ kind: 'Pitch', label: p.cs?.target?.name || p.name, sub: p.status || '', go: () => { if (typeof pv !== 'undefined') { pv.open = p.id; pv.tab = 'deals'; } showTab('pitches'); } })),
    ...companies.slice(0, 8).map(([, , c]) => ({ kind: c.role === 'Investor' ? 'Financial' : 'Company', label: c.name, sub: [c.niche || c.sector, c.country].filter(Boolean).join(' · '), go: () => openDrawer(c.id) })),
  ];
  gsIndex = 0;
  box.innerHTML = gsHits.length ? gsHits.map((h, i) => `<button class="gs-hit ${i === gsIndex ? 'on' : ''}" data-gs="${i}"><span class="gs-kind">${h.kind}</span><b>${esc(h.label)}</b><span class="muted small">${esc(h.sub)}</span></button>`).join('') : '<div class="gs-empty">No matches</div>';
  box.hidden = false;
}
function pickHit(i) {
  const h = gsHits[i];
  if (!h) return;
  $('#gsResults').hidden = true;
  $('#globalSearch').value = '';
  $('#globalSearch').blur();
  h.go();
}
let gsTimer;
$('#globalSearch').addEventListener('input', e => { clearTimeout(gsTimer); gsTimer = setTimeout(() => runGlobalSearch(e.target.value), 120); });
$('#globalSearch').addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#gsResults').hidden = true; e.target.blur(); }
  if (!gsHits.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    gsIndex = (gsIndex + (e.key === 'ArrowDown' ? 1 : -1) + gsHits.length) % gsHits.length;
    $$('.gs-hit').forEach((b, i) => b.classList.toggle('on', i === gsIndex));
  }
  if (e.key === 'Enter') { e.preventDefault(); pickHit(gsIndex); }
});
$('#gsResults').addEventListener('mousedown', e => { const b = e.target.closest('[data-gs]'); if (b) { e.preventDefault(); pickHit(+b.dataset.gs); } });
$('#globalSearch').addEventListener('blur', () => setTimeout(() => { $('#gsResults').hidden = true; }, 150));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch').focus(); $('#globalSearch').select(); }
});
