/* global Engine, XLSX, msal */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---------- Storage (IndexedDB, one key per collection) ----------
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('mna-crm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res((this._db = r.result));
      r.onerror = () => rej(r.error);
    });
  },
  async get(k, fallback) {
    const db = await this.open();
    return new Promise(res => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result ?? fallback);
      q.onerror = () => res(fallback);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  },
};

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

const state = {
  companies: [],
  templates: [DEFAULT_TEMPLATE],
  activity: [],
  settings: { clientId: '', tenantId: 'organizations', senderName: '', delaySec: 3 },
  weights: { ...Engine.DEFAULT_WEIGHTS },
  mappingMemory: {},
  campaign: { dealId: null, recipientIds: [] },
  contactChoice: {},
  matches: [],
  selected: new Set(),
  roleFilter: new Set(),
  previewId: null,
};

const save = {
  companies: () => DB.set('companies', state.companies),
  templates: () => DB.set('templates', state.templates),
  activity: () => DB.set('activity', state.activity),
  settings: () => DB.set('settings', state.settings),
  weights: () => DB.set('weights', state.weights),
  mapping: () => DB.set('mappingMemory', state.mappingMemory),
};

function toast(msg, ms = 3000) {
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

// ---------- Tabs ----------
function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'email') renderEmail();
  if (name === 'activity') renderActivity();
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Companies ----------
const contactText = c => (c.contacts || []).map(x => [x.name, x.title, x.email].join(' ')).join(' ');
const projectChips = c => (c.projects || []).filter(p => p.project).map(p => `<span class="chip" title="${esc([p.status, p.last_contact, p.responsible].filter(Boolean).join(' · '))}">${esc(p.project)}${p.status ? ': ' + esc(p.status.slice(0, 24)) : ''}</span>`).join('');

function renderCompanies() {
  const q = $('#search').value.toLowerCase().trim();
  const role = $('#filterRole').value;
  const project = $('#filterProject').value;
  const list = state.companies.filter(c =>
    (!role || c.role === role) &&
    (!project || c.projects.some(p => p.project === project)) &&
    (!q || [c.name, c.website, c.sector, c.subsector, c.country, c.ownership, c.keywords, contactText(c)].join(' ').toLowerCase().includes(q)));
  const shown = list.slice(0, 1000);
  $('#companyCount').textContent = `${list.length} of ${state.companies.length} companies` + (list.length > shown.length ? ' (first 1000 shown)' : '');
  $('#companyTable tbody').innerHTML = shown.map(c => {
    const pc = Engine.primaryContact(c) || c.contacts[0];
    const more = c.contacts.length > 1 ? ` <span class="muted">+${c.contacts.length - 1}</span>` : '';
    return `<tr>
      <td><button class="link" data-edit="${c.id}">${esc(c.name)}</button></td>
      <td>${esc(c.role)}</td><td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${Engine.fmt(c.revenue)}</td>
      <td>${pc ? `${esc(pc.name)} <span class="muted small">${esc(pc.email || '')}</span>${more}` : '<span class="muted">–</span>'}</td>
      <td class="wrap">${projectChips(c)}</td>
      <td><button class="link" data-match="${c.id}">Find matches</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">No companies yet. Click "Import Excel / CSV" to add your buyer lists.</td></tr>`;

  const fill = (sel, values, all) => {
    const cur = $(sel).value;
    $(sel).innerHTML = `<option value="">${all}</option>` + values.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  };
  fill('#filterRole', [...new Set(state.companies.map(c => c.role).filter(Boolean))].sort(), 'All roles');
  fill('#filterProject', [...new Set(state.companies.flatMap(c => c.projects.map(p => p.project)).filter(Boolean))].sort(), 'All projects');
  $('#companyList').innerHTML = state.companies.map(c => `<option value="${esc(c.name)}">`).join('');
}

$('#search').addEventListener('input', renderCompanies);
$('#filterRole').addEventListener('change', renderCompanies);
$('#filterProject').addEventListener('change', renderCompanies);
$('#companyTable').addEventListener('click', e => {
  const edit = e.target.dataset.edit, m = e.target.dataset.match;
  if (edit) openEdit(edit);
  if (m) { setDeal(m); showTab('match'); }
});

$('#findDuplicates').addEventListener('click', () => {
  const groups = [], seen = new Set();
  for (const c of state.companies) {
    if (seen.has(c.id)) continue;
    const dups = Engine.findDuplicates(c, state.companies).exact.filter(d => !seen.has(d.id));
    if (dups.length) { groups.push([c, ...dups]); [c, ...dups].forEach(x => seen.add(x.id)); }
  }
  if (!groups.length) return toast('No duplicates found.');
  const preview = groups.slice(0, 15).map(g => '• ' + g.map(c => c.name).join('  =  ')).join('\n');
  if (!confirm(`Found ${groups.length} duplicate group(s):\n\n${preview}${groups.length > 15 ? '\n…' : ''}\n\nMerge them? Contacts and project history are combined.`)) return;
  const remove = new Set();
  for (const [keep, ...rest] of groups) rest.forEach(r => { Engine.mergeCompanies(keep, r); remove.add(r.id); });
  state.companies = state.companies.filter(c => !remove.has(c.id));
  save.companies();
  renderCompanies();
  toast(`Merged ${remove.size} duplicate(s).`);
});

$('#downloadTemplate').addEventListener('click', () => {
  const headers = ['Company', 'Website', 'Role', 'Sector', 'Sub-sector', 'Country', 'Revenue (EUR m)', 'EBITDA (EUR m)', 'Employees', 'Ownership', 'Description', 'Keywords',
    'Looking for sectors', 'Looking for countries', 'Min revenue', 'Max revenue', 'Contact name', 'Function', 'E-mail', 'Contact name 2', 'Function 2', 'E-mail 2', 'Status', 'Date of last contact', 'Log'];
  const ex = [
    ['Example Packaging BV', 'example-packaging.nl', 'Target', 'Packaging', 'Flexible packaging', 'Netherlands', 25, 4, 120, 'Founder', 'Producer of sustainable flexible packaging for food brands', 'packaging; sustainable; food', '', '', '', '', 'Jan de Vries', 'CEO', 'jan@example.com'],
    ['Example Industrial Group', 'example-industrial.de', 'Buyer', 'Packaging', '', 'Germany', 400, 50, 2000, 'Private', 'Industrial packaging group pursuing a buy-and-build strategy', '', 'Packaging; Labels', 'Netherlands; Belgium; Germany', 10, 100, 'Anna Schmidt', 'Head of M&A', 'anna@example.com', 'Max Müller', 'CFO', 'max@example.com', 'Teaser sent', '2026-10-01'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...ex]), 'Companies');
  XLSX.writeFile(wb, 'crm-template.xlsx');
});

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

function prepSheet(file, sh, resetMapping) {
  sh.headers = (sh.rows[sh.headerRow] || []).map(norm);
  if (resetMapping || !sh.targets) sh.targets = Engine.mapHeaders(sh.headers, state.mappingMemory);
  const source = `${file.name} › ${sh.name}`;
  const firstByName = new Map();
  sh.parsed = sh.rows.slice(sh.headerRow + 1).map((row, i) => {
    const p = Engine.parseRow(row, sh.headers, sh.targets, { unit: sh.unit, role: sh.role, project: sh.project || file.project, source });
    if (!p.company.name) return null;
    const dup = Engine.findDuplicates(p.company, state.companies);
    const n = Engine.normName(p.company.name);
    const sameRow = firstByName.get(n);
    if (!sameRow) firstByName.set(n, sh.r0 + sh.headerRow + i + 2);
    return { ...p, i, excelRow: sh.r0 + sh.headerRow + i + 2, text: row.join(' ').toLowerCase(), exact: dup.exact[0], possible: dup.possible.slice(0, 3), sameRow };
  }).filter(Boolean);
  if (!sh.selected || resetMapping) sh.selected = new Set(sh.parsed.map(p => p.i));
  sh.choices ??= {};
}

$('#upload').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  imp = { files: [], fi: 0, si: 0, stage: 'sheets', search: '' };
  for (const f of files) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
      const file = { name: f.name, project: Engine.guessProject(f.name), sheets: [] };
      for (const n of wb.SheetNames) {
        const sh = readSheet(wb.Sheets[n], n);
        if (!sh) continue;
        sh.headerRow = Engine.detectHeaderRow(sh.rows);
        sh.unit = Engine.detectUnit(sh.rows, sh.headerRow);
        sh.role = Engine.guessRoleFromSheet(n);
        sh.project = state.mappingMemory['sheet:' + Engine.headerKey(n)] || '';
        prepSheet(file, sh, true);
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

function renderImport() {
  const file = curFile();
  const head = `<div class="muted small">File ${imp.fi + 1} of ${imp.files.length}</div>`;
  if (imp.stage === 'sheets') {
    $('#importBody').innerHTML = `${head}<h2>${esc(file.name)}</h2>
      <label style="max-width:360px">Project name <input id="impProject" value="${esc(file.project)}"></label>
      <p class="muted small">Pick the sheets to import. Each sheet can have its own layout; you check the columns on the next screen.</p>
      <table class="compact"><thead><tr><th></th><th>Sheet</th><th class="num">Companies</th><th>Default role</th></tr></thead><tbody>
      ${file.sheets.map((s, k) => `<tr>
        <td><input type="checkbox" data-inc="${k}" ${s.include ? 'checked' : ''}></td>
        <td>${esc(s.name)}</td><td class="num">${s.parsed.length}</td>
        <td><select data-role="${k}">${['', 'Buyer', 'Investor', 'Target', 'Advisor'].map(r => `<option ${r === s.role ? 'selected' : ''} value="${r}">${r || '—'}</option>`).join('')}</select></td>
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

  $('#importBody').innerHTML = `${head}
    <h2>${esc(file.name)} › ${esc(sh.name)} <span class="muted small">(sheet ${imp.si + 1} of ${sheets.length})</span></h2>
    <div class="toolbar">
      <label class="row">Header row <input type="number" id="impHeader" min="1" value="${sh.r0 + sh.headerRow + 1}" style="width:70px"></label>
      <label class="row">Amounts in <select id="impUnit"><option value="m" ${sh.unit === 'm' ? 'selected' : ''}>EUR millions</option><option value="k" ${sh.unit === 'k' ? 'selected' : ''}>EUR thousands</option></select></label>
      <label class="row">Default role <select id="impRole">${['', 'Buyer', 'Investor', 'Target', 'Advisor'].map(r => `<option ${r === sh.role ? 'selected' : ''} value="${r}">${r || '—'}</option>`).join('')}</select></label>
      <label class="row">Project for this sheet <input id="impProject2" value="${esc(sh.project || file.project)}" style="width:160px"></label>
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
      <table class="compact"><thead><tr><th></th><th>Row</th><th>Company</th><th>Role</th><th>Country</th><th class="num">Rev (m)</th><th>Contacts</th><th>Status</th><th>Duplicate?</th></tr></thead><tbody>
      ${visible.map(p => `<tr class="${sh.selected.has(p.i) ? '' : 'unsel'}">
        <td><input type="checkbox" data-row="${p.i}" ${sh.selected.has(p.i) ? 'checked' : ''}></td>
        <td class="muted">${p.excelRow}</td><td>${esc(p.company.name)}</td><td>${esc(p.company.role)}</td><td>${esc(p.company.country)}</td>
        <td class="num">${Engine.fmt(p.company.revenue)}</td>
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
  imp = null;
  renderCompanies();
  runMatch();
}

function importSheet() {
  const file = curFile(), sh = curSheet();
  let added = 0, merged = 0;
  for (const p of sh.parsed) {
    if (!sh.selected.has(p.i)) continue;
    const ch = sh.choices[p.i] || 'auto';
    let target = null;
    if (ch === 'auto') target = Engine.findDuplicates(p.company, state.companies).exact[0] || null;
    else if (ch !== 'new') target = byId(ch);
    if (target) { Engine.mergeInto(target, p); merged++; }
    else { const c = newCompany(p.company.name); Engine.mergeInto(c, p); state.companies.push(c); added++; }
  }
  imp.totals = { added: (imp.totals?.added || 0) + added, merged: (imp.totals?.merged || 0) + merged };
  save.companies();
  toast(`${sh.name}: ${added} new, ${merged} merged.`);
  // Later sheets should see the companies just imported as duplicates.
  includedSheets().slice(imp.si + 1).forEach(s => prepSheet(file, s, false));
  nextAfterSheet();
}

$('#importBody').addEventListener('click', e => {
  const act = e.target.dataset.act;
  if (!act) return;
  const file = curFile(), sh = imp.stage === 'sheet' ? curSheet() : null;
  if (act === 'cancel') { $('#importDialog').close(); imp = null; renderCompanies(); return; }
  if (act === 'skipfile') { imp.si = includedSheets().length; nextAfterSheet(); return; }
  if (act === 'tosheets') {
    file.project = norm($('#impProject').value) || file.project;
    if (!includedSheets().length) return toast('Select at least one sheet.');
    file.sheets.forEach(s => prepSheet(file, s, false));
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
    return;
  }
  const sh = curSheet();
  if (t.dataset.row) { t.checked ? sh.selected.add(+t.dataset.row) : sh.selected.delete(+t.dataset.row); return renderImport(); }
  if (t.dataset.choice) { sh.choices[t.dataset.choice] = t.value; return renderImport(); }
  if (t.dataset.map) {
    const i = +t.dataset.map;
    sh.targets[i] = t.value;
    if (sh.headers[i]) { state.mappingMemory[Engine.headerKey(sh.headers[i])] = t.value; save.mapping(); }
  }
  if (t.id === 'impHeader') { sh.headerRow = Math.max(0, +t.value - 1 - sh.r0); prepSheet(file, sh, true); return renderImport(); }
  if (t.id === 'impUnit') sh.unit = t.value;
  if (t.id === 'impRole') sh.role = t.value;
  if (t.id === 'impProject2') {
    sh.project = norm(t.value);
    state.mappingMemory['sheet:' + Engine.headerKey(sh.name)] = sh.project;
    save.mapping();
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
function openEdit(id) {
  const c = id ? byId(id) : newCompany('');
  const dlg = $('#editDialog');
  dlg.dataset.id = id || '';
  dlg._contacts = (c.contacts || []).map(x => ({ ...x }));
  $('#editTitle').textContent = id ? c.name : 'New company';
  const fieldHtml = f => {
    const v = c[f.key] ?? '';
    let input;
    if (f.key === 'role') input = `<select name="${f.key}">${['', 'Target', 'Buyer', 'Investor', 'Advisor'].map(r => `<option ${r === v ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
    else if (f.long) input = `<textarea name="${f.key}" rows="3">${esc(v)}</textarea>`;
    else input = `<input name="${f.key}" value="${esc(v)}" ${f.key === 'name' ? 'required' : ''}>`;
    return `<label class="${f.long ? 'full' : ''}">${esc(f.label)}${f.money ? ' (EUR m)' : ''}${input}</label>`;
  };
  const statusSel = `<label>CRM status<select name="status">${Engine.STATUSES.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`;
  const projects = (c.projects || []).map(p => `<div class="proj">
      <b>${esc(p.project || 'Project')}</b> ${p.status ? `<span class="chip">${esc(p.status)}</span>` : ''}
      <span class="muted small">${esc([p.last_contact && 'Last contact ' + p.last_contact, p.responsible && 'Resp. ' + p.responsible, p.tier && 'Tier ' + p.tier].filter(Boolean).join(' · '))}</span>
      ${p.log ? `<div class="small">${esc(p.log)}</div>` : ''}
      ${p.remarks ? `<div class="small muted">${esc(p.remarks)}</div>` : ''}
      ${Object.keys(p.extra || {}).length ? `<details class="small"><summary>More info</summary>${Object.entries(p.extra).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</details>` : ''}
      <div class="muted small">${esc(p.source || '')}</div></div>`).join('') || '<div class="muted small">No project history yet.</div>';

  $('#editFields').innerHTML = `
    <div class="form-grid">${Engine.COMPANY_FIELDS.map(fieldHtml).join('')}${statusSel}</div>
    <h3>Contacts</h3><div id="editContacts"></div>
    <button type="button" class="btn" id="addContact">+ Add contact</button>
    <h3>Projects</h3>${projects}
    ${id ? `<h3>Merge</h3><div class="toolbar">
      <input list="companyList" id="mergeWith" placeholder="Another company with the same identity…" style="flex:1">
      <button type="button" class="btn" id="mergeBtn">Merge into this company</button></div>
      <div class="toolbar"><button type="button" class="btn danger" id="deleteCompany">Delete company</button>
      <span class="muted small">Sources: ${esc(c.sources.join('; ')) || '—'}</span></div>` : ''}`;
  renderEditContacts();
  $('#addContact').addEventListener('click', () => { readEditContacts(); dlg._contacts.push({}); renderEditContacts(); });
  $('#deleteCompany')?.addEventListener('click', () => {
    if (!confirm(`Delete ${c.name}?`)) return;
    state.companies = state.companies.filter(x => x.id !== id);
    save.companies();
    dlg.close('cancel');
    renderCompanies();
  });
  $('#mergeBtn')?.addEventListener('click', () => {
    const name = $('#mergeWith').value.trim().toLowerCase();
    const other = state.companies.find(x => x.id !== id && x.name.toLowerCase() === name);
    if (!other) return toast('Pick an existing company from the list.');
    if (!confirm(`Merge "${other.name}" into "${c.name}"? "${other.name}" will be removed; its contacts and projects move here.`)) return;
    Engine.mergeCompanies(c, other);
    state.companies = state.companies.filter(x => x.id !== other.id);
    save.companies();
    dlg.close('cancel');
    renderCompanies();
    openEdit(id);
  });
  dlg.showModal();
}
function renderEditContacts() {
  const list = $('#editDialog')._contacts;
  $('#editContacts').innerHTML = list.map((ct, i) => `<div class="contact-row">
    ${['name', 'title', 'email', 'phone'].map(k => `<input data-ci="${i}" data-ck="${k}" placeholder="${k === 'title' ? 'function' : k}" value="${esc(ct[k] || '')}">`).join('')}
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
  const contacts = dlg._contacts.filter(x => x.name || x.email).map(x => ({ ...x, email: (x.email || '').toLowerCase() }));
  let c = dlg.dataset.id ? byId(dlg.dataset.id) : null;
  if (!c) { c = newCompany(data.name); state.companies.push(c); }
  Object.assign(c, data, { contacts });
  migrate(c);
  save.companies();
  renderCompanies();
  if (state.campaign.dealId) runMatch();
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
  save.weights();
  runMatch();
});
$('#resetWeights').addEventListener('click', () => { state.weights = { ...Engine.DEFAULT_WEIGHTS }; save.weights(); renderWeights(); runMatch(); });

function setDeal(id) {
  const deal = byId(id);
  if (!deal) return;
  state.campaign.dealId = id;
  $('#matchFor').value = deal.name;
  $('#matchForInfo').innerHTML = [deal.role, deal.sector, deal.subsector, deal.country, deal.revenue != null ? `€${Engine.fmt(deal.revenue)}m revenue` : ''].filter(Boolean).map(esc).join(' · ');
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
    return `<span class="chip ${on ? '' : 'off'}" data-role="${esc(r)}">${esc(r || 'No role')}</span>`;
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
  if (!deal) { $('#matchTable tbody').innerHTML = '<tr><td colspan="9" class="muted">Choose a company on the left to find matches.</td></tr>'; syncCampaign(); return; }
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
      <td><input type="checkbox" data-sel="${c.id}" ${state.selected.has(c.id) ? 'checked' : ''}></td>
      <td><span class="score" style="background:${scoreColor(score)}">${score}</span></td>
      <td><button class="link" data-edit="${c.id}">${esc(c.name)}</button>${done.has(c.id) ? ' <span class="chip">emailed</span>' : ''}</td>
      <td>${esc(c.role)}</td><td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${Engine.fmt(c.revenue)}</td><td>${esc(pc?.email || '')}${n > 1 ? ` <span class="muted">+${n - 1}</span>` : ''}</td>
      <td class="wrap">${reasons.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">No matches. Try lowering the minimum score or changing the role filter.</td></tr>';
  syncCampaign();
}
const scoreColor = s => (s >= 70 ? '#1a7f37' : s >= 45 ? '#2f81f7' : s >= 25 ? '#9a6700' : '#8c959f');

$('#matchTable').addEventListener('change', e => {
  const id = e.target.dataset.sel;
  if (!id) return;
  e.target.checked ? state.selected.add(id) : state.selected.delete(id);
  syncCampaign();
});
$('#matchTable').addEventListener('click', e => { if (e.target.dataset.edit) openEdit(e.target.dataset.edit); });
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
function sendsFor(c) {
  const withEmail = c.contacts.map((x, i) => ({ x, i })).filter(o => o.x.email);
  const ch = state.contactChoice[c.id] ?? 'primary';
  if (ch === 'all') return withEmail.map(o => o.x);
  if (ch === 'primary') return withEmail.slice(0, 1).map(o => o.x);
  return c.contacts[+ch]?.email ? [c.contacts[+ch]] : withEmail.slice(0, 1).map(o => o.x);
}
const allSends = () => state.campaign.recipientIds.map(byId).flatMap(c => sendsFor(c).map(contact => ({ company: c, contact })));

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
  save.templates();
  toast('Template saved.');
});
$('#saveTemplateAs').addEventListener('click', () => {
  const name = prompt('Template name?');
  if (!name) return;
  const t = { id: uid(), name, subject: $('#subject').value, body: $('#body').value };
  state.templates.push(t);
  save.templates();
  renderTemplates(t.id);
});
$('#deleteTemplate').addEventListener('click', () => {
  if (state.templates.length <= 1) return toast('Keep at least one template.');
  const t = currentTemplate();
  if (!confirm(`Delete template "${t.name}"?`)) return;
  state.templates = state.templates.filter(x => x !== t);
  save.templates();
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

function renderEmail() {
  const deal = byId(state.campaign.dealId);
  const ids = state.campaign.recipientIds;
  $('#campaignInfo').innerHTML = deal ? `Deal: <b>${esc(deal.name)}</b>` : 'No deal chosen. Pick a company in the Match engine first.';
  $('#recipientCount').textContent = `(${ids.length} companies · ${allSends().length} emails)`;
  if (!ids.includes(state.previewId)) state.previewId = ids[0] || null;
  $('#recipients').innerHTML = ids.map(id => {
    const c = byId(id);
    const withEmail = c.contacts.map((x, i) => ({ x, i })).filter(o => o.x.email);
    const ch = String(state.contactChoice[c.id] ?? 'primary');
    const sel = withEmail.length > 1 ? `<select data-cc="${id}">
        <option value="primary" ${ch === 'primary' ? 'selected' : ''}>${esc(withEmail[0].x.name || withEmail[0].x.email)}</option>
        ${withEmail.slice(1).map(o => `<option value="${o.i}" ${ch === String(o.i) ? 'selected' : ''}>${esc(o.x.name || o.x.email)}</option>`).join('')}
        <option value="all" ${ch === 'all' ? 'selected' : ''}>All ${withEmail.length} contacts</option></select>`
      : `<span class="muted small">${esc(withEmail[0].x.name || '')} ${esc(withEmail[0].x.email)}</span>`;
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
  if (rm) { state.selected.delete(rm); syncCampaign(); renderEmail(); return; }
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
  const deal = byId(state.campaign.dealId), c = byId(state.previewId);
  const contact = c && sendsFor(c)[0];
  if (!deal || !contact) { $('#preview').textContent = ''; return; }
  const m = compose(deal, c, contact);
  $('#preview').innerHTML = `<b>To:</b> ${contact.name ? `${esc(contact.name)} &lt;${esc(contact.email)}&gt;` : esc(contact.email)}\n<b>Subject:</b> ${esc(m.subject)}\n\n${esc(m.body)}`;
}

$('#sendBtn').addEventListener('click', async () => {
  const deal = byId(state.campaign.dealId);
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
      }
    } catch (err) {
      result = 'Error: ' + err.message;
      state.sendStatus[c.id + '|' + contact.email] = '✗';
      fail++;
    }
    state.activity.unshift({ id: uid(), date: new Date().toISOString(), dealId: deal.id, dealName: deal.name, companyId: c.id, companyName: c.name, contactName: contact.name || '', email: contact.email, subject: m.subject, result, ok: result === 'Sent' });
    renderEmail();
    if (i < sends.length - 1) await sleep((Number(state.settings.delaySec) || 3) * 1000);
  }
  save.activity();
  save.companies();
  renderCompanies();
  $('#sendProgress').innerHTML = `<span class="ok">${ok} done</span>${fail ? `, <span class="err">${fail} failed</span>` : ''}.` + (mode === 'draft' ? ' Open Outlook → Drafts to review and send.' : '');
  $('#sendBtn').disabled = false;
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  $('#account').textContent = a ? `Signed in: ${a.username}` : 'Not signed in to Outlook';
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
    <td class="${a.result.startsWith('Error') ? 'err' : 'ok'}">${esc(a.result)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No emails yet.</td></tr>';
}
$('#activitySearch').addEventListener('input', renderActivity);
$('#exportActivity').addEventListener('click', () => downloadSheet(state.activity.map(({ id, dealId, companyId, ok, ...rest }) => rest), 'activity.xlsx'));

// ---------- Settings & backup ----------
function renderSettings() {
  for (const k of ['clientId', 'tenantId', 'senderName', 'delaySec']) $('#' + k).value = state.settings[k] ?? '';
}
$('#saveSettings').addEventListener('click', () => {
  for (const k of ['clientId', 'tenantId', 'senderName', 'delaySec']) state.settings[k] = $('#' + k).value.trim();
  save.settings();
  renderAccount();
  toast('Settings saved.');
});
$('#signIn').addEventListener('click', async () => { try { await signIn(); toast('Signed in.'); } catch (e) { toast(e.message, 6000); } });
$('#signOut').addEventListener('click', async () => { try { const app = getMsal(); await app.logoutPopup({ account: app.getActiveAccount() }); } catch (e) { toast(e.message); } renderAccount(); });
$('#backup').addEventListener('click', () => {
  const data = { version: 2, exported: new Date().toISOString(), companies: state.companies, templates: state.templates, activity: state.activity, weights: state.weights, mappingMemory: state.mappingMemory };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
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
    if (!confirm(`Replace current data with backup (${d.companies.length} companies)?`)) return;
    Object.assign(state, {
      companies: d.companies.map(migrate), templates: d.templates?.length ? d.templates : [DEFAULT_TEMPLATE], activity: d.activity || [],
      weights: d.weights || { ...Engine.DEFAULT_WEIGHTS }, mappingMemory: d.mappingMemory || {},
    });
    await Promise.all([save.companies(), save.templates(), save.activity(), save.weights(), save.mapping()]);
    renderAll();
    toast('Backup restored.');
  } catch (err) { toast('Restore failed: ' + err.message, 6000); }
});
$('#exportAll').addEventListener('click', () => downloadSheet(state.companies.map(flatten), `crm-companies-${new Date().toISOString().slice(0, 10)}.xlsx`));
$('#wipe').addEventListener('click', () => {
  if (!confirm('Delete ALL companies from this browser? Download a backup first if unsure.')) return;
  state.companies = [];
  state.campaign = { dealId: null, recipientIds: [] };
  state.selected.clear();
  save.companies();
  renderAll();
});

// ---------- Helpers ----------
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// One row per company for Excel exports.
function flatten(c) {
  const row = Object.fromEntries(Engine.COMPANY_FIELDS.map(f => [f.label, c[f.key] ?? '']));
  c.contacts.forEach((x, i) => {
    const n = i ? ` ${i + 1}` : '';
    Object.assign(row, { [`Contact name${n}`]: x.name || '', [`Function${n}`]: x.title || '', [`E-mail${n}`]: x.email || '', [`Phone${n}`]: x.phone || '' });
  });
  row.Projects = c.projects.map(p => [p.project, p.status].filter(Boolean).join(': ')).join(' | ');
  row.Sources = c.sources.join('; ');
  return row;
}
function downloadSheet(rows, filename) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(wb, filename);
}

function renderAll() {
  renderCompanies();
  renderWeights();
  renderSettings();
  renderTemplates(state.templates[0].id);
  runMatch();
  renderAccount();
}

(async function init() {
  state.companies = (await DB.get('companies', [])).map(migrate);
  state.templates = await DB.get('templates', [DEFAULT_TEMPLATE]);
  state.activity = await DB.get('activity', []);
  state.settings = { ...state.settings, ...(await DB.get('settings', {})) };
  state.weights = { ...Engine.DEFAULT_WEIGHTS, ...(await DB.get('weights', {})) };
  state.mappingMemory = await DB.get('mappingMemory', {});
  renderAll();
})();
