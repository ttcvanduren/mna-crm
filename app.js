/* global Engine, XLSX, msal */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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
  campaign: { dealId: null, recipientIds: [] },
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
};

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const byId = id => state.companies.find(c => c.id === id);

// ---------- Tabs ----------
function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'email') renderEmail();
  if (name === 'activity') renderActivity();
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- Companies ----------
function renderCompanies() {
  const q = $('#search').value.toLowerCase().trim();
  const role = $('#filterRole').value;
  const list = state.companies.filter(c =>
    (!role || c.role === role) &&
    (!q || [c.name, c.sector, c.subsector, c.country, c.email, c.contact_name, c.keywords].join(' ').toLowerCase().includes(q)));
  const shown = list.slice(0, 1000);
  $('#companyCount').textContent = `${list.length} of ${state.companies.length} companies` + (list.length > shown.length ? ' (first 1000 shown)' : '');
  $('#companyTable tbody').innerHTML = shown.map(c => `
    <tr>
      <td><button class="link" data-edit="${c.id}">${esc(c.name)}</button></td>
      <td>${esc(c.role)}</td><td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${Engine.fmt(c.revenue)}</td><td class="num">${Engine.fmt(c.ebitda)}</td>
      <td>${esc(c.contact_name)}</td><td>${esc(c.email)}</td>
      <td><span class="status ${esc(c.status)}">${esc(c.status)}</span></td>
      <td><button class="link" data-match="${c.id}">Find matches</button></td>
    </tr>`).join('') || `<tr><td colspan="10" class="muted">No companies yet. Upload a CSV or Excel file, or download the template to see the columns.</td></tr>`;

  const roles = [...new Set(state.companies.map(c => c.role).filter(Boolean))].sort();
  const cur = $('#filterRole').value;
  $('#filterRole').innerHTML = '<option value="">All roles</option>' + roles.map(r => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('');
  $('#companyList').innerHTML = state.companies.map(c => `<option value="${esc(c.name)}">`).join('');
}

$('#search').addEventListener('input', renderCompanies);
$('#filterRole').addEventListener('change', renderCompanies);
$('#companyTable').addEventListener('click', e => {
  const edit = e.target.dataset.edit, m = e.target.dataset.match;
  if (edit) openEdit(edit);
  if (m) { setDeal(m); showTab('match'); }
});

$('#upload').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    importRows(rows);
  } catch (err) {
    console.error(err);
    toast('Could not read that file: ' + err.message, 6000);
  }
});

function importRows(rows) {
  const keyOf = c => `${(c.name || '').toLowerCase()}|${(c.email || '').toLowerCase()}`;
  const existing = new Map(state.companies.map(c => [keyOf(c), c]));
  let added = 0, updated = 0, skipped = 0;
  for (const row of rows) {
    const c = Engine.rowToCompany(row);
    if (!c.name) { skipped++; continue; }
    const prev = existing.get(keyOf(c));
    if (prev) {
      for (const [k, v] of Object.entries(c)) if (v !== '' && v != null && !(k === 'status' && v === 'New')) prev[k] = v;
      updated++;
    } else {
      c.id = uid();
      c.created = new Date().toISOString();
      state.companies.push(c);
      existing.set(keyOf(c), c);
      added++;
    }
  }
  save.companies();
  renderCompanies();
  const unmapped = rows.length ? Object.keys(rows[0]).filter(h => !Engine.fieldFor(h) && !/^(first|last|sur|voor|achter)/i.test(h)) : [];
  toast(`Imported: ${added} new, ${updated} updated, ${skipped} skipped (no name).` + (unmapped.length ? ` Ignored columns: ${unmapped.join(', ')}` : ''), 8000);
}

$('#downloadTemplate').addEventListener('click', () => {
  const headers = Engine.FIELDS.map(f => f.key);
  const ex = [
    { name: 'Example Packaging BV', role: 'Target', sector: 'Packaging', subsector: 'Flexible packaging', country: 'Netherlands', revenue: 25, ebitda: 4, employees: 120, description: 'Producer of sustainable flexible packaging for food brands', keywords: 'packaging; sustainable; food', contact_name: 'Jan de Vries', contact_title: 'CEO', email: 'jan@example.com', status: 'New' },
    { name: 'Example Industrial Group', role: 'Buyer', sector: 'Packaging', country: 'Germany', revenue: 400, description: 'Industrial packaging group pursuing a buy-and-build strategy', target_sectors: 'Packaging; Labels', target_countries: 'Netherlands; Belgium; Germany', min_revenue: 10, max_revenue: 100, contact_name: 'Anna Schmidt', contact_title: 'Head of M&A', email: 'anna@example.com', status: 'New' },
  ];
  const ws = XLSX.utils.json_to_sheet(ex, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Companies');
  XLSX.writeFile(wb, 'crm-template.xlsx');
});

// ---------- Edit dialog ----------
function openEdit(id) {
  const c = id ? byId(id) : { status: 'New' };
  $('#editTitle').textContent = id ? c.name : 'New company';
  $('#editFields').innerHTML = Engine.FIELDS.map(f => {
    const v = c[f.key] ?? '';
    let input;
    if (f.key === 'role') input = `<select name="role">${['', 'Target', 'Buyer', 'Investor', 'Advisor'].map(r => `<option ${r === v ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
    else if (f.key === 'status') input = `<select name="status">${Engine.STATUSES.map(s => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
    else if (f.long) input = `<textarea name="${f.key}" rows="3">${esc(v)}</textarea>`;
    else input = `<input name="${f.key}" value="${esc(v)}" ${f.num ? 'inputmode="decimal"' : ''} ${f.key === 'name' ? 'required' : ''}>`;
    return `<label class="${f.full || f.long ? 'full' : ''}">${esc(f.label)}${input}</label>`;
  }).join('') + (id ? `<div class="full toolbar"><button type="button" class="btn danger" id="deleteCompany">Delete company</button></div>` : '');
  const dlg = $('#editDialog');
  dlg.dataset.id = id || '';
  $('#deleteCompany')?.addEventListener('click', () => {
    if (!confirm(`Delete ${c.name}?`)) return;
    state.companies = state.companies.filter(x => x.id !== id);
    save.companies();
    dlg.close('cancel');
    renderCompanies();
  });
  dlg.showModal();
}
$('#addCompany').addEventListener('click', () => openEdit(null));
$('#editDialog').addEventListener('close', () => {
  const dlg = $('#editDialog');
  if (dlg.returnValue !== 'save') return;
  const data = Object.fromEntries(new FormData($('#editForm')));
  for (const f of Engine.FIELDS) if (f.num) data[f.key] = Engine.parseNumber(data[f.key]);
  data.email = (data.email || '').toLowerCase().trim();
  if (dlg.dataset.id) Object.assign(byId(dlg.dataset.id), data);
  else state.companies.push({ ...data, id: uid(), created: new Date().toISOString() });
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
  if (!deal) { $('#matchTable tbody').innerHTML = '<tr><td colspan="9" class="muted">Choose a company on the left to find matches.</td></tr>'; return; }
  const onlyEmail = $('#onlyWithEmail').checked, hide = $('#hideContacted').checked;
  const min = Number($('#minScore').value) || 0;
  const done = contactedFor(deal.id);
  state.matches = Engine.match(deal, state.companies, state.weights).filter(m =>
    m.score >= min &&
    (!state.roleFilter.size || state.roleFilter.has(m.company.role || '')) &&
    (!onlyEmail || m.company.email) &&
    (!hide || !done.has(m.company.id)));
  $('#matchCount').textContent = `(${state.matches.length})`;
  $('#matchTable tbody').innerHTML = state.matches.slice(0, 500).map(({ company: c, score, reasons }) => `
    <tr>
      <td><input type="checkbox" data-sel="${c.id}" ${state.selected.has(c.id) ? 'checked' : ''}></td>
      <td><span class="score" style="background:${scoreColor(score)}">${score}</span></td>
      <td><button class="link" data-edit="${c.id}">${esc(c.name)}</button>${done.has(c.id) ? ' <span class="chip">emailed</span>' : ''}</td>
      <td>${esc(c.role)}</td><td>${esc(c.sector)}</td><td>${esc(c.country)}</td>
      <td class="num">${Engine.fmt(c.revenue)}</td><td>${esc(c.email)}</td>
      <td class="wrap">${reasons.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">No matches. Try lowering the minimum score or changing the role filter.</td></tr>';
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
  const rows = state.matches.map(m => ({ score: m.score, ...pick(m.company), reasons: m.reasons.join(' | ') }));
  downloadSheet(rows, `matches-${slug(deal.name)}.xlsx`);
});

function syncCampaign() {
  state.campaign.recipientIds = state.matches.map(m => m.company.id).filter(id => state.selected.has(id) && byId(id)?.email);
}

// ---------- Email ----------
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
  const t = currentTemplate();
  Object.assign(t, { subject: $('#subject').value, body: $('#body').value });
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
function sendMode() { return $('input[name=sendMode]:checked').value; }
function updateSendLabel() {
  const n = state.campaign.recipientIds.length;
  $('#sendBtn').textContent = sendMode() === 'send' ? `Send ${n} email${n === 1 ? '' : 's'}` : `Create ${n} Outlook draft${n === 1 ? '' : 's'}`;
  $('#sendBtn').disabled = !n;
}

function renderEmail() {
  const deal = byId(state.campaign.dealId);
  const ids = state.campaign.recipientIds;
  $('#campaignInfo').innerHTML = deal ? `Deal: <b>${esc(deal.name)}</b>` : 'No deal chosen. Pick a company in the Match engine first.';
  $('#recipientCount').textContent = `(${ids.length})`;
  if (!ids.includes(state.previewId)) state.previewId = ids[0] || null;
  $('#recipients').innerHTML = ids.map(id => {
    const c = byId(id);
    const st = state.sendStatus?.[id] || '';
    return `<div class="recipient ${id === state.previewId ? 'active' : ''}" data-rid="${id}">
      <span>${esc(c.name)}</span><span class="muted small">${esc(c.email)}</span>
      <span class="r-status ${st.startsWith('✓') ? 'ok' : st.startsWith('✗') ? 'err' : ''}">${esc(st)}</span>
      <button class="link small" data-remove="${id}">remove</button></div>`;
  }).join('') || '<div class="muted small" style="padding:10px">No recipients selected.</div>';
  updateSendLabel();
  renderPreview();
}
$('#recipients').addEventListener('click', e => {
  const rm = e.target.dataset.remove;
  if (rm) { state.selected.delete(rm); syncCampaign(); renderEmail(); return; }
  const row = e.target.closest('[data-rid]');
  if (row) { state.previewId = row.dataset.rid; renderEmail(); }
});

function compose(deal, c) {
  const extra = { sender_name: state.settings.senderName || '' };
  return { subject: Engine.render($('#subject').value, deal, c, extra), body: Engine.render($('#body').value, deal, c, extra) };
}
function renderPreview() {
  const deal = byId(state.campaign.dealId), c = byId(state.previewId);
  if (!deal || !c) { $('#preview').textContent = ''; return; }
  const m = compose(deal, c);
  $('#preview').innerHTML = `<b>To:</b> ${esc(c.email)}\n<b>Subject:</b> ${esc(m.subject)}\n\n${esc(m.body)}`;
}

$('#sendBtn').addEventListener('click', async () => {
  const deal = byId(state.campaign.dealId);
  const ids = [...state.campaign.recipientIds];
  if (!deal || !ids.length) return;
  const mode = sendMode();
  const verb = mode === 'send' ? 'SEND' : 'create drafts for';
  if (!confirm(`This will ${verb} ${ids.length} email(s) from your Outlook account for "${deal.name}". Continue?`)) return;
  let token;
  try { token = await getToken(); } catch (err) { return toast('Microsoft sign-in failed: ' + err.message, 8000); }

  $('#sendBtn').disabled = true;
  state.sendStatus = {};
  const cc = $('#cc').value.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i++) {
    const c = byId(ids[i]);
    const m = compose(deal, c);
    $('#sendProgress').textContent = `${i + 1} / ${ids.length}: ${c.name}…`;
    let result;
    try {
      await graphMail(token, mode, c.email, cc, m.subject, m.body);
      result = mode === 'send' ? 'Sent' : 'Draft created';
      state.sendStatus[c.id] = '✓ ' + result;
      ok++;
      if (mode === 'send') {
        if (!c.status || c.status === 'New') c.status = 'Contacted';
        c.last_contacted = new Date().toISOString();
      }
    } catch (err) {
      result = 'Error: ' + err.message;
      state.sendStatus[c.id] = '✗ ' + err.message;
      fail++;
    }
    state.activity.unshift({ id: uid(), date: new Date().toISOString(), dealId: deal.id, dealName: deal.name, companyId: c.id, companyName: c.name, email: c.email, subject: m.subject, result, ok: result === 'Sent' });
    renderEmail();
    if (i < ids.length - 1) await sleep((Number(state.settings.delaySec) || 3) * 1000);
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
  const list = state.activity.filter(a => !q || [a.dealName, a.companyName, a.email, a.subject, a.result].join(' ').toLowerCase().includes(q));
  $('#activityTable tbody').innerHTML = list.slice(0, 1000).map(a => `
    <tr><td>${new Date(a.date).toLocaleString()}</td><td>${esc(a.dealName)}</td><td>${esc(a.companyName)}</td><td>${esc(a.email)}</td><td>${esc(a.subject)}</td>
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
  const data = { version: 1, exported: new Date().toISOString(), companies: state.companies, templates: state.templates, activity: state.activity, weights: state.weights };
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
    Object.assign(state, { companies: d.companies, templates: d.templates?.length ? d.templates : [DEFAULT_TEMPLATE], activity: d.activity || [], weights: d.weights || { ...Engine.DEFAULT_WEIGHTS } });
    await Promise.all([save.companies(), save.templates(), save.activity(), save.weights()]);
    renderAll();
    toast('Backup restored.');
  } catch (err) { toast('Restore failed: ' + err.message, 6000); }
});
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
const pick = c => Object.fromEntries(Engine.FIELDS.map(f => [f.key, c[f.key] ?? '']));
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
  state.companies = await DB.get('companies', []);
  state.templates = await DB.get('templates', [DEFAULT_TEMPLATE]);
  state.activity = await DB.get('activity', []);
  state.settings = { ...state.settings, ...(await DB.get('settings', {})) };
  state.weights = { ...Engine.DEFAULT_WEIGHTS, ...(await DB.get('weights', {})) };
  renderAll();
})();
