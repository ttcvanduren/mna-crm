/* global Engine, state, byId, esc, logo, money, openDrawer, saveProjects, touch, toast, showTab, members, stats, stackBar, companyCell, stageChip, STAGE_COLORS, renderProjects, openProjectDialog, syncCampaign, renderEmail */
// Deal workflow inside a project: deal profile, valuation, buyer matching, pipeline board, follow-ups and offers.
const today = () => new Date().toISOString().slice(0, 10);
const FIND_LIMIT = 150;

// The company being sold, in the shape the match engine and email templates expect.
function dealOf(proj) {
  const t = proj.target || {};
  return {
    id: 'deal:' + proj.id, project: proj.name, role: 'Target', currency: 'EUR',
    name: t.codename || proj.name, website: t.website, sector: t.sector, subsector: t.subsector, country: t.country,
    revenue: t.revenue, ebitda: t.ebitda, employees: t.employees, description: t.description, keywords: t.keywords,
  };
}
const hasProfile = proj => { const t = proj.target || {}; return !!(t.sector || t.keywords || t.description); };

// Moves a buyer to a pipeline stage and logs it.
function moveStage(c, projectName, stage, note) {
  let p = c.projects.find(x => x.project === projectName);
  if (!p) { p = { project: projectName, source: 'Added in CRM' }; c.projects.push(p); }
  const order = s => Engine.BOARD_STAGES.indexOf(Engine.boardStage(s));
  if (stage !== 'Passed' && order(stage) > order(p.furthest_stage || p.status)) p.furthest_stage = stage;
  p.status = stage;
  p.last_contact = today();
  p.log = `${today()} – ${stage}${note ? ': ' + note : ''}${p.log ? '\n' + p.log : ''}`;
  touch(c);
  return p;
}

// Next outreach step after an email has been sent.
function nextOutreachStage(status) {
  const b = Engine.boardStage(status);
  if (b === 'Not approached') return 'Teaser sent';
  if (b === 'Teaser sent') return 'Reminder sent';
  if (b === 'Reminder sent') return /2nd|second/i.test(status || '') ? 'Final reminder sent' : '2nd reminder sent';
  return null; // further stages are moved by hand
}

function followUpsDue(name) {
  const days = Number(state.settings.followUpDays) || 7;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return members(name)
    .filter(({ p }) => ['Teaser sent', 'Reminder sent'].includes(Engine.boardStage(p.status)) && !/final/i.test(p.status || '') && /^\d{4}-\d{2}-\d{2}/.test(p.last_contact || '') && p.last_contact <= cutoff)
    .sort((a, b) => a.p.last_contact.localeCompare(b.p.last_contact));
}

// Hands the selected buyers to the Email tab with this project as the deal.
function emailFromProject(name, ids) {
  const list = ids.map(byId).filter(c => c && Engine.hasEmail(c));
  if (!list.length) return toast('Select buyers that have an email address.');
  state.campaign = { dealId: null, project: name, recipientIds: list.map(c => c.id) };
  state.selected = new Set(list.map(c => c.id));
  showTab('email');
  toast(`${list.length} buyers ready to email for ${name}. Sending moves each buyer to the next stage.`, 6000);
}

function renderProjectTab(proj, tab) {
  const el = $('#projectBody');
  if (tab === 'overview') el.innerHTML = overviewHtml(proj);
  if (tab === 'board') el.innerHTML = boardHtml(proj);
  if (tab === 'find') el.innerHTML = findHtml(proj);
  if (tab === 'followups') el.innerHTML = followupsHtml(proj);
}

// ---------- Overview: deal profile, valuation, offers, precedents ----------
function defaultMultiples(t) {
  const tech = /software|saas|idp|document|data|platform|tech|cloud|ai\b|digital|it /i.test([t.sector, t.subsector, t.keywords].join(' '));
  return tech ? { rev: [1.5, 3, 5], ebitda: [8, 12, 16] } : { rev: [0.5, 1, 1.5], ebitda: [5, 7, 9] };
}
function valuation(proj) {
  const t = proj.target || {};
  const m = proj.multiples || defaultMultiples(t);
  const rows = [];
  if (t.revenue != null) rows.push(['EV / Revenue', t.revenue, m.rev]);
  if (t.ebitda != null) rows.push(['EV / EBITDA', t.ebitda, m.ebitda]);
  const ev = i => rows.length ? rows.reduce((a, [, v, mm]) => a + v * mm[i], 0) / rows.length : null;
  return { m, rows, ev: [ev(0), ev(1), ev(2)] };
}
const eur = v => v == null ? '–' : `€${Engine.fmt(Math.round(v * 10) / 10)}m`;

function overviewHtml(proj) {
  const t = proj.target || {};
  const s = stats(proj.name);
  const v = valuation(proj);
  const offers = members(proj.name).filter(m => m.p.offer).sort((a, b) => (b.p.offer.amount || 0) - (a.p.offer.amount || 0));
  const due = followUpsDue(proj.name);
  const deal = dealOf(proj);
  const precedents = hasProfile(proj) ? Engine.match(deal, state.companies.filter(c => c.acquisitions?.length), state.weights).slice(0, 25)
    .flatMap(m => m.company.acquisitions.slice(0, 3).map(a => ({ buyer: m.company, ...a }))).slice(0, 15) : [];

  return `<div class="overview-grid">
    <div class="card">
      <div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">Deal profile</h2><span class="spacer"></span><button class="btn sm" data-x="editProfile">Edit</button></div>
      ${hasProfile(proj) ? `<p class="lead">${esc(t.codename || proj.name)}</p>
        ${t.description ? `<p class="prose">${esc(t.description)}</p>` : ''}
        <div class="facts">
          ${[['Sector', [t.sector, t.subsector].filter(Boolean).join(' · ')], ['Country', t.country], ['Revenue', t.revenue != null ? eur(t.revenue) : ''], ['EBITDA', t.ebitda != null ? eur(t.ebitda) : ''], ['Employees', t.employees != null ? Engine.fmt(t.employees) : ''], ['Website', t.website]]
            .filter(([, x]) => x).map(([k, x]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(x)}</div></div>`).join('')}
        </div>${t.keywords ? `<div class="chips" style="margin-top:8px">${t.keywords.split(/[;,]/).map(k => k.trim()).filter(Boolean).map(k => `<span class="chip">#${esc(k)}</span>`).join('')}</div>` : ''}`
        : `<div class="empty">Describe the company you're selling (sector, keywords, revenue…) so <b>Find buyers</b> can rank the database.<br><br><button class="btn primary" data-x="editProfile">Add deal profile</button></div>`}
    </div>

    <div class="card">
      <h2>Process</h2>
      <div class="pc-nums"><div><b>${s.total}</b><span>buyers</span></div><div><b>${s.total - s.groups['Not approached']}</b><span>contacted</span></div>
        <div><b style="color:${STAGE_COLORS.Engaged}">${s.groups.Engaged}</b><span>engaged</span></div><div><b style="color:${STAGE_COLORS.Passed}">${s.groups.Passed}</b><span>passed</span></div></div>
      ${s.total ? stackBar(s.groups, s.total) : ''}
      <div class="stage-list">${Engine.BOARD_STAGES.map(st => { const n = members(proj.name).filter(m => Engine.boardStage(m.p.status) === st).length; return `<div><span>${st}</span><b>${n}</b></div>`; }).join('')}</div>
      ${due.length ? `<div class="callout" style="margin:12px 0 0"><span>⏰</span><div><b>${due.length} follow-ups due</b> <span class="muted">teaser/reminder sent more than ${Number(state.settings.followUpDays) || 7} days ago</span></div><span class="spacer"></span><button class="btn sm" data-ptab="followups">Show</button></div>` : ''}
    </div>

    <div class="card">
      <h2>Valuation indication</h2>
      ${v.rows.length ? `<table class="compact val"><thead><tr><th>Method</th><th class="num">Metric</th><th class="num">Low</th><th class="num">Mid</th><th class="num">High</th></tr></thead><tbody>
          ${v.rows.map(([k, val, mm], i) => `<tr><td>${k}</td><td class="num">${eur(val)}</td>${mm.map((x, j) => `<td class="num"><input class="mult" data-mult="${k === 'EV / Revenue' ? 'rev' : 'ebitda'}" data-i="${j}" value="${x}">×<div class="muted small">${eur(val * x)}</div></td>`).join('')}</tr>`).join('')}
          <tr class="total"><td colspan="2"><b>Enterprise value</b></td>${v.ev.map(x => `<td class="num"><b>${eur(x)}</b></td>`).join('')}</tr>
        </tbody></table>
        <p class="muted small">Indicative only: multiples are editable starting points (${/software|saas|idp|document|data|platform|tech|cloud/i.test([t.sector, t.subsector, t.keywords].join(' ')) ? 'software' : 'general'} defaults). <button class="link small" data-x="resetMult">Reset</button></p>`
        : '<div class="empty">Add revenue and/or EBITDA to the deal profile to see a valuation range.</div>'}
    </div>

    <div class="card">
      <h2>Offers ${offers.length ? `<span class="muted">(${offers.length})</span>` : ''}</h2>
      ${offers.length ? `<table class="compact"><thead><tr><th>Buyer</th><th>Type</th><th class="num">EV</th><th class="num">vs mid</th><th>Date</th></tr></thead><tbody>
        ${offers.map(({ c, p }) => `<tr data-open="${c.id}" style="cursor:pointer"><td>${esc(c.name)}</td><td>${esc(p.offer.type || '')}</td><td class="num"><b>${eur(p.offer.amount)}</b></td>
          <td class="num ${v.ev[1] && p.offer.amount >= v.ev[1] ? 'ok' : 'err'}">${v.ev[1] && p.offer.amount ? Math.round((p.offer.amount / v.ev[1] - 1) * 100) + '%' : ''}</td><td class="small">${esc(p.offer.date || '')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No offers yet. Move a buyer to <b>Offer</b> on the pipeline board to record one.</div>'}
    </div>

    <div class="card span2">
      <h2>Precedent acquisitions by matching buyers</h2>
      ${precedents.length ? `<table class="compact"><thead><tr><th>Year</th><th>Buyer</th><th>Target</th><th>Description</th></tr></thead><tbody>
        ${precedents.map(a => `<tr><td>${esc(a.year || '')}</td><td><button class="link" data-open="${a.buyer.id}">${esc(a.buyer.name)}</button></td><td><b>${esc(a.target)}</b></td><td class="small muted">${esc(a.description || '')}${a.source_url ? ` <a href="${esc(a.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">Acquisitions appear here once matching buyers have been researched (Export for research → Import research).</div>`}
    </div>
  </div>`;
}

// ---------- Pipeline board ----------
const board = { tier: '', q: '' };
const COL_LIMIT = 60;
function boardHtml(proj) {
  const q = board.q.toLowerCase();
  const all = members(proj.name).filter(({ c, p }) => (!board.tier || String(p.tier) === board.tier) && (!q || c.name.toLowerCase().includes(q)));
  const tiers = [...new Set(members(proj.name).map(m => m.p.tier).filter(Boolean))].sort();
  const daysSince = d => /^\d{4}-\d{2}-\d{2}/.test(d || '') ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 86400000)) : null;
  return `<div class="filters">
      <input type="search" id="boardSearch" placeholder="Find a buyer on the board…" value="${esc(board.q)}">
      <select id="boardTier"><option value="">All tiers</option>${tiers.map(t => `<option ${String(t) === board.tier ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <span class="muted small">Drag cards between columns. Moving to <b>Offer</b> asks for the offer amount.</span>
    </div>
    <div class="board">${Engine.BOARD_STAGES.map(st => {
      const cards = all.filter(m => Engine.boardStage(m.p.status) === st).sort((a, b) => String(a.p.tier || 9).localeCompare(String(b.p.tier || 9)));
      const color = STAGE_COLORS[Engine.stageGroup(st)];
      return `<div class="col" data-col="${st}">
        <div class="col-head" style="border-color:${color}"><span>${st}</span><b>${cards.length}</b></div>
        <div class="col-body">${cards.slice(0, COL_LIMIT).map(({ c, p }) => {
          const d = daysSince(p.last_contact);
          return `<div class="kcard" draggable="true" data-card="${c.id}">
            <div class="co">${logo(c)}<div style="min-width:0"><div class="co-name">${esc(c.name)}</div>
            <div class="co-sub">${p.tier ? `<span class="tier t${esc(p.tier)}">T${esc(p.tier)}</span> ` : ''}${esc(p.status && p.status !== st ? p.status : '')}</div></div></div>
            <div class="kmeta">${d != null ? `<span class="${d > 14 && st !== 'Passed' && st !== 'Not approached' ? 'err' : 'muted'}">${d}d ago</span>` : '<span></span>'}
              ${p.offer?.amount ? `<b class="ok">${eur(p.offer.amount)} ${esc(p.offer.type || '')}</b>` : ''}${Engine.hasEmail(c) ? '<span title="Has email">✉</span>' : ''}</div>
          </div>`;
        }).join('')}${cards.length > COL_LIMIT ? `<div class="muted small" style="padding:6px">+ ${cards.length - COL_LIMIT} more (use the filters or the Buyers tab)</div>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
}

let dragId = null;
$('#projectsView').addEventListener('dragstart', e => { const c = e.target.closest('[data-card]'); if (c) { dragId = c.dataset.card; e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); } });
$('#projectsView').addEventListener('dragend', e => { e.target.closest?.('[data-card]')?.classList.remove('dragging'); $$('.col.over').forEach(x => x.classList.remove('over')); });
$('#projectsView').addEventListener('dragover', e => { const col = e.target.closest('[data-col]'); if (col && dragId) { e.preventDefault(); $$('.col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); } });
$('#projectsView').addEventListener('drop', e => {
  const col = e.target.closest('[data-col]');
  if (!col || !dragId) return;
  e.preventDefault();
  const c = byId(dragId), stage = col.dataset.col;
  dragId = null;
  if (!c) return;
  if (Engine.boardStage(c.projects.find(x => x.project === state.projectView)?.status) === stage) return renderProjects();
  let note = '';
  if (stage === 'Offer') {
    const amount = Engine.parseNumber(prompt(`Offer from ${c.name}: enterprise value in EUR m (e.g. 24.5)`, '') || '');
    const type = (prompt('Offer type: IOI (indicative), LOI or Firm', 'IOI') || 'IOI').trim();
    const p = moveStage(c, state.projectView, stage, amount ? `${type} ${eur(amount)}` : type);
    p.offer = { amount, type, date: today() };
  } else if (stage === 'Passed') {
    note = prompt(`Why did ${c.name} pass? (optional)`, '') || '';
    const p = moveStage(c, state.projectView, stage, note);
    if (note) p.pass_reason = note;
  } else moveStage(c, state.projectView, stage);
  renderProjects();
});

// ---------- Find buyers ----------
const find = { limit: FIND_LIMIT, picked: new Set(), type: '' };
function findMatches(proj) {
  const inProject = new Set(members(proj.name).map(m => m.c.id));
  return Engine.match(dealOf(proj), state.companies.filter(c => !inProject.has(c.id)), state.weights)
    .filter(m => !find.type || (find.type === 'Strategic' ? m.company.role !== 'Investor' : m.company.role === 'Investor'));
}
function findHtml(proj) {
  if (!hasProfile(proj)) return `<div class="empty">First describe the company you're selling: sector, keywords and description.<br><br><button class="btn primary" data-x="editProfile">Add deal profile</button></div>`;
  const all = findMatches(proj);
  const list = all.slice(0, find.limit);
  const tierOf = s => (s >= 65 ? '1' : s >= 45 ? '2' : '3');
  return `<div class="callout"><span>✦</span><div><b>${all.length} candidate buyers</b> in your database that aren't on this project yet, ranked on
      sector, keywords, M&A appetite, geography, size and how they behaved in earlier projects.</div></div>
    <div class="filters">
      <select id="findType"><option value="">Strategics + financial</option><option ${find.type === 'Strategic' ? 'selected' : ''}>Strategic</option><option value="Investor" ${find.type === 'Investor' ? 'selected' : ''}>Financial (PE / investors)</option></select>
      <label class="row-label">Show top <input type="number" id="findLimit" value="${find.limit}" min="10" max="1000" style="width:80px"></label>
      <button class="link small" data-x="weights">Adjust weights</button>
      <span class="spacer"></span>
      <button class="btn" data-x="pickTop">Select top 50</button>
      <button class="btn primary" data-x="addPicked">Add ${find.picked.size || 'selected'} to ${esc(proj.name)}</button>
    </div>
    <div class="table-wrap"><table class="data"><thead><tr><th class="cb"></th><th>Score</th><th>Company</th><th>Type</th><th>Country</th><th class="num">Employees</th><th>Why</th></tr></thead><tbody>
      ${list.map(({ company: c, score, reasons }) => `<tr data-open-row="${c.id}">
        <td class="cb"><input type="checkbox" data-fpick="${c.id}" ${find.picked.has(c.id) ? 'checked' : ''}></td>
        <td><span class="score" style="background:${score >= 65 ? '#067647' : score >= 45 ? '#1d4ed8' : '#98a2b3'}">${score}</span> <span class="tier t${tierOf(score)}">T${tierOf(score)}</span></td>
        <td>${companyCell(c)}</td>
        <td>${c.role === 'Investor' ? '<span class="chip role-Investor">Financial</span>' : '<span class="chip role-Buyer">Strategic</span>'}</td>
        <td>${esc(c.country || '')}</td><td class="num">${c.employees != null ? Engine.fmt(c.employees) : ''}</td>
        <td class="wrap">${reasons.map(r => `<span class="chip ${/^Engaged/.test(r) ? 'green' : /^Passed/.test(r) ? 'red' : /acqui|add-on/i.test(r) ? 'purple' : ''}">${esc(r)}</span>`).join('')}</td>
      </tr>`).join('') || '<tr><td colspan="7"><div class="empty">No candidates. Add keywords to the deal profile or import more lists.</div></td></tr>'}
    </tbody></table></div>`;
}
function addToProject(proj, ids) {
  const scores = new Map(findMatches(proj).map(m => [m.company.id, m]));
  let n = 0;
  for (const id of ids) {
    const c = byId(id), m = scores.get(id);
    if (!c || c.projects.some(p => p.project === proj.name)) continue;
    c.projects.push({ project: proj.name, status: 'Not approached', tier: m ? (m.score >= 65 ? '1' : m.score >= 45 ? '2' : '3') : '', rationale: m ? `Match ${m.score}: ${m.reasons.join('; ')}` : '', source: 'Find buyers' });
    touch(c);
    n++;
  }
  find.picked.clear();
  toast(`${n} buyers added to ${proj.name}.`, 5000);
}

// ---------- Follow-ups ----------
function followupsHtml(proj) {
  const due = followUpsDue(proj.name);
  return `<div class="filters">
      <label class="row-label">Remind after <input type="number" id="fuDays" value="${Number(state.settings.followUpDays) || 7}" min="1" style="width:60px"> days without reply</label>
      <span class="spacer"></span>
      <button class="btn" data-x="fuMarked">Mark selected as reminded</button>
      <button class="btn primary" data-x="fuEmail">✉ Email reminder to selected</button>
    </div>
    ${due.length ? `<div class="table-wrap"><table class="data" id="fuTable"><thead><tr><th class="cb"><input type="checkbox" id="fuAll"></th><th>Company</th><th>Tier</th><th>Stage</th><th>Last contact</th><th>Waiting</th><th>Contact</th></tr></thead><tbody>
      ${due.map(({ c, p }) => { const pc = Engine.primaryContact(c); const d = Math.round((Date.now() - new Date(p.last_contact).getTime()) / 86400000);
        return `<tr data-open-row="${c.id}"><td class="cb"><input type="checkbox" data-fu="${c.id}"></td><td>${companyCell(c)}</td>
        <td>${p.tier ? `<span class="tier t${esc(p.tier)}">T${esc(p.tier)}</span>` : ''}</td><td>${stageChip(p.status)}</td><td class="small">${esc(p.last_contact)}</td>
        <td><b class="${d > 21 ? 'err' : ''}">${d} days</b></td><td class="small">${pc ? esc(pc.name || pc.email) : '<span class="muted">no email</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">🎉 No follow-ups due. Everyone contacted recently, or not yet approached.</div>'}`;
}
const fuPicked = () => $$('[data-fu]:checked').map(x => x.dataset.fu);

// ---------- Events ----------
$('#projectsView').addEventListener('click', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  if (!proj) return;
  const x = e.target.closest('[data-x]')?.dataset.x;
  if (x === 'editProfile') return openProjectDialog(proj.name);
  if (x === 'resetMult') { delete proj.multiples; saveProjects(); return renderProjects(); }
  if (x === 'weights') return showTab('match');
  if (x === 'pickTop') { findMatches(proj).slice(0, 50).forEach(m => find.picked.add(m.company.id)); return renderProjects(); }
  if (x === 'addPicked') { if (!find.picked.size) return toast('Tick the buyers to add first.'); addToProject(proj, [...find.picked]); return renderProjects(); }
  if (x === 'fuMarked') { const ids = fuPicked(); if (!ids.length) return toast('Select buyers first.'); ids.forEach(id => { const c = byId(id); moveStage(c, proj.name, nextOutreachStage(c.projects.find(p => p.project === proj.name).status) || 'Reminder sent'); }); return renderProjects(); }
  if (x === 'fuEmail') { const ids = fuPicked(); if (!ids.length) return toast('Select buyers first.'); return emailFromProject(proj.name, ids); }
  if (e.target.dataset.fpick) { e.target.checked ? find.picked.add(e.target.dataset.fpick) : find.picked.delete(e.target.dataset.fpick); const b = $('[data-x=addPicked]'); if (b) b.textContent = `Add ${find.picked.size || 'selected'} to ${proj.name}`; return; }
  if (e.target.id === 'fuAll') { $$('[data-fu]').forEach(cb => (cb.checked = e.target.checked)); return; }
  if (e.target.closest('input,a,button,select')) return;
  const open = e.target.closest('[data-open],[data-open-row],[data-card]');
  if (open) openDrawer(open.dataset.open || open.dataset.openRow || open.dataset.card, 'projects');
});
$('#projectsView').addEventListener('change', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  if (!proj) return;
  const t = e.target;
  if (t.dataset.mult) {
    proj.multiples ??= JSON.parse(JSON.stringify(valuation(proj).m));
    proj.multiples[t.dataset.mult][+t.dataset.i] = Number(String(t.value).replace(',', '.')) || 0;
    saveProjects();
    return renderProjects();
  }
  if (t.id === 'findType') { find.type = t.value; return renderProjects(); }
  if (t.id === 'findLimit') { find.limit = Math.max(10, Number(t.value) || FIND_LIMIT); return renderProjects(); }
  if (t.id === 'boardTier') { board.tier = t.value; return renderProjects(); }
  if (t.id === 'fuDays') { state.settings.followUpDays = Number(t.value) || 7; localStorage.setItem('crm.settings', JSON.stringify(state.settings)); return renderProjects(); }
});
let boardTimer;
$('#projectsView').addEventListener('input', e => {
  if (e.target.id !== 'boardSearch') return;
  board.q = e.target.value;
  clearTimeout(boardTimer);
  boardTimer = setTimeout(() => { renderProjects(); const s = $('#boardSearch'); s.focus(); s.setSelectionRange(board.q.length, board.q.length); }, 200);
});
