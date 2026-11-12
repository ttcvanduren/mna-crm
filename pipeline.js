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
    // Industry › sector › sub-sector picked in the deal profile, and a niche picked by hand (else derived from the texts).
    cls_industry: t.cls_industry || '', cls_sector: t.cls_sector || '', cls_subsector: t.cls_subsector || '', niche: t.niche || '',
  };
}
const hasProfile = proj => { const t = proj.target || {}; return !!(t.sector || t.keywords || t.description || t.cls_industry || t.niche); };

// Moves a buyer to a pipeline stage and logs it.
function moveStage(c, projectName, stage, note) {
  let p = c.projects.find(x => x.project === projectName);
  if (!p) { p = { project: projectName, source: 'Added in CRM' }; c.projects.push(p); }
  const order = s => Engine.BOARD_STAGES.indexOf(Engine.boardStage(s));
  if (stage !== 'Passed' && order(stage) > order(p.furthest_stage || p.status)) p.furthest_stage = stage;
  p.status = stage;
  p.last_contact = today();
  // Milestone dates (first time a stage is reached) drive conversion and time-in-stage.
  const key = Engine.DATE_KEYS[Engine.boardStage(stage)];
  if (key) { p.dates ??= {}; p.dates[key] ??= today(); }
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

// Outreach cadence per project (days after the teaser): reminder, phone call, final "closing the list" note.
const DEFAULT_CADENCE = { reminder: 7, call: 12, final: 20, nda: 7 };
const cadenceOf = proj => ({ ...DEFAULT_CADENCE, ...(proj?.cadence || {}) });
const isDate = d => /^\d{4}-\d{2}-\d{2}/.test(d || '');
const ageDays = d => Math.round((Date.now() - new Date(d).getTime()) / 86400000);

// Buyers whose next outreach step is due, with the action to take.
function followUpsDue(name) {
  const cad = cadenceOf(state.projects.find(p => p.name === name));
  const out = [];
  for (const { c, p } of members(name)) {
    const st = Engine.boardStage(p.status);
    const since = p.dates?.teaser || p.last_contact;
    if (st === 'Teaser sent' && isDate(p.last_contact) && ageDays(p.last_contact) >= cad.reminder) out.push({ c, p, action: 'Send reminder', days: ageDays(p.last_contact) });
    else if (st === 'Reminder sent' && !/final/i.test(p.status || '') && isDate(since)) {
      const d = ageDays(since);
      if (d >= cad.final && isDate(p.last_contact) && ageDays(p.last_contact) >= 5) out.push({ c, p, action: 'Final note / close out', days: d });
      else if (d >= cad.call && isDate(p.last_contact) && ageDays(p.last_contact) >= 3 && !p.dates?.call) out.push({ c, p, action: 'Call', days: d });
    } else if (st === 'NDA sent' && isDate(p.last_contact) && ageDays(p.last_contact) >= cad.nda) out.push({ c, p, action: 'Chase NDA', days: ageDays(p.last_contact) });
  }
  return out.sort((a, b) => b.days - a.days);
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
  if (tab === 'valuation') renderValuationTab(proj, el);
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
  const maxEv = Math.max(v.ev[2] || 0, ...offers.map(o => o.p.offer.high || o.p.offer.amount || 0)) * 1.1 || 1;
  const bar = (lo, hi, cls) => `<div class="evbar"><div class="${cls}" style="left:${(lo / maxEv) * 100}%;width:${Math.max(1.5, ((hi - lo) / maxEv) * 100)}%"></div></div>`;
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
          ${[['Industry', (() => { const p = Engine.dealPath(dealOf(proj)); return p ? [p.industry, p.sector, p.subsector, p.niche].filter(Boolean).join(' › ') : ''; })()], ['Sector', [t.sector, t.subsector].filter(Boolean).join(' · ')], ['Country', t.country], ['Revenue', t.revenue != null ? eur(t.revenue) : ''], ['EBITDA', t.ebitda != null ? eur(t.ebitda) : ''], ['Employees', t.employees != null ? Engine.fmt(t.employees) : ''], ['Website', t.website]]
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
      ${due.length ? `<div class="callout" style="margin:12px 0 0"><span>⏰</span><div><b>${due.length} follow-ups due</b> <span class="muted">reminders, calls and NDA chasers according to the cadence</span></div><span class="spacer"></span><button class="btn sm" data-ptab="followups">Show</button></div>` : ''}
    </div>

    <div class="card">
      <h2>Valuation indication</h2>
      ${(() => { if (!state.transactions?.length || !(t.revenue || t.ebitda)) return ''; const vr = valuate(proj); return vr.blend ? `<div class="callout" style="margin-bottom:10px"><span>€</span><div><b>Comparable transactions: ${eur(vr.blend[0])} – ${eur(vr.blend[2])}</b> <span class="muted">(mid ${eur(vr.blend[1])}, ${vr.comps.used.length} deals, scorecard ${vr.sc.adj >= 0 ? '+' : ''}${Math.round(vr.sc.adj * 100)}%)</span></div><span class="spacer"></span><button class="btn sm" data-ptab="valuation">Open</button></div><h3 style="margin-top:4px">Quick multiples check</h3>` : ''; })()}
      ${v.rows.length ? `<table class="compact val"><thead><tr><th>Method</th><th class="num">Metric</th><th class="num">Low</th><th class="num">Mid</th><th class="num">High</th></tr></thead><tbody>
          ${v.rows.map(([k, val, mm], i) => `<tr><td>${k}</td><td class="num">${eur(val)}</td>${mm.map((x, j) => `<td class="num"><input class="mult" data-mult="${k === 'EV / Revenue' ? 'rev' : 'ebitda'}" data-i="${j}" value="${x}">×<div class="muted small">${eur(val * x)}</div></td>`).join('')}</tr>`).join('')}
          <tr class="total"><td colspan="2"><b>Enterprise value</b></td>${v.ev.map(x => `<td class="num"><b>${eur(x)}</b></td>`).join('')}</tr>
        </tbody></table>
        <p class="muted small">Indicative only: multiples are editable starting points (${/software|saas|idp|document|data|platform|tech|cloud/i.test([t.sector, t.subsector, t.keywords].join(' ')) ? 'software' : 'general'} defaults). <button class="link small" data-x="resetMult">Reset</button></p>`
        : '<div class="empty">Add revenue and/or EBITDA to the deal profile to see a valuation range.</div>'}
    </div>

    <div class="card span2">
      <div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">Process timeline</h2><span class="muted small">${esc(currentPhase(proj)?.name || '')}</span><span class="spacer"></span>
        <button class="btn sm" data-x="editTimeline">${state.editTimeline ? 'Done' : 'Edit dates'}</button>
        <button class="btn sm" data-x="report">Weekly client report</button><button class="btn sm" data-x="reportAnon">Report (anonymised)</button></div>
      ${ganttHtml(proj, state.editTimeline)}
    </div>

    <div class="card span2">
      <h2>Offer comparison ${offers.length ? `<span class="muted">(${offers.length})</span>` : ''}</h2>
      ${offers.length ? offerCardsHtml(offers, v, bar) : '<div class="empty">No offers yet. Drag a buyer to <b>IOI received</b> or <b>Binding offer</b> on the pipeline board to record price, structure and conditions.</div>'}
    </div>

    <div class="card span2">
      <h2>Precedent acquisitions by matching buyers</h2>
      ${precedents.length ? `<table class="compact"><thead><tr><th>Date</th><th>Buyer</th><th>Target</th><th>Industry</th><th>Size</th><th>Description</th></tr></thead><tbody>
        ${precedents.map(a => `<tr><td class="small">${esc(a.date || a.year || '')}</td><td><button class="link" data-open="${a.buyer.id}">${esc(a.buyer.name)}</button></td>
          <td><b>${esc(a.target)}</b>${a.target_website ? ` <a class="ext" href="${esc(Engine.cleanUrl(a.target_website))}" target="_blank" rel="noopener">↗</a>` : ''}</td>
          <td class="small">${esc(a.industry || '')}</td><td class="small">${esc([a.deal_value, a.target_revenue && 'rev. ' + a.target_revenue, a.target_employees && a.target_employees + ' FTE'].filter(Boolean).join(' · '))}</td>
          <td class="small muted">${esc(a.description || '')}${a.source_url ? ` <a href="${esc(a.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">Acquisitions appear here once matching buyers have been researched (Export for research → Import research).</div>`}
    </div>
  </div>`;
}

// Offers side by side: price, how much is paid at close, earn-out, rollover, conditions and certainty; the best value per row is highlighted.
function offerTerms(o) {
  const s = String(o.structure || '');
  const pct = re => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const earn = pct(/(\d{1,3})\s*%\s*(?:of the price\s*)?(?:as\s*)?(?:an?\s*)?earn[- ]?outs?/i), roll = pct(/(\d{1,3})\s*%\s*(?:equity\s*)?(?:roll[- ]?over|re-?invest\w*|rollover)/i);
  let cash = pct(/(\d{1,3})\s*%\s*(?:cash|upfront|at clos\w*|on completion)/i);
  if (cash == null && (earn != null || roll != null)) cash = Math.max(0, 100 - (earn || 0) - (roll || 0));
  return { cash, earn, roll };
}
function offerCardsHtml(offers, v, bar) {
  const rows = offers.map(({ c, p }) => ({ c, o: p.offer, t: offerTerms(p.offer) }));
  const best = (f, hi = true) => { const xs = rows.map(f).filter(x => x != null); return xs.length > 1 ? (hi ? Math.max(...xs) : Math.min(...xs)) : null; };
  const bPrice = best(r => r.o.amount), bCash = best(r => r.t.cash), bEarn = best(r => r.t.earn, false), bCert = best(r => r.o.certainty);
  const line = (label, val, isBest) => `<div class="oc-line ${isBest ? 'best' : ''}"><span>${label}</span><b>${val ?? '<span class="muted">–</span>'}</b></div>`;
  return `${v.ev[1] ? `<p class="muted small" style="margin:-6px 0 12px">Valuation indication ${eur(v.ev[0])} – ${eur(v.ev[2])} (mid ${eur(v.ev[1])}). Best value per line is highlighted.</p>` : ''}
    <div class="offer-cards">${rows.map(({ c, o, t }) => {
      const lo = o.low ?? o.amount, hi = o.high ?? o.amount, vs = v.ev[1] && o.amount ? Math.round((o.amount / v.ev[1] - 1) * 100) : null;
      return `<div class="offer-card">
        <div class="oc-head">${logo(c)}<div style="min-width:0"><button class="link co-name" data-open="${c.id}">${esc(c.name)}</button><div class="muted small">${esc([o.type, o.date].filter(Boolean).join(' · '))}</div></div></div>
        <div class="oc-price ${o.amount != null && o.amount === bPrice ? 'best' : ''}">${o.high ? `${eur(lo)}–${eur(hi)}` : eur(o.amount)}${vs != null ? `<span class="${vs >= 0 ? 'ok' : 'err'}">${vs >= 0 ? '+' : ''}${vs}% vs mid</span>` : ''}</div>
        ${lo != null && v.ev[1] ? bar(lo, hi, 'off') : ''}
        ${line('Cash at close', t.cash != null ? t.cash + '%' : null, t.cash != null && t.cash === bCash)}
        ${line('Earn-out', t.earn != null ? t.earn + '%' : null, t.earn != null && t.earn === bEarn)}
        ${line('Rollover', t.roll != null ? t.roll + '%' : null, false)}
        ${line('Financing', o.financing ? esc(o.financing) : null, false)}
        ${line('Certainty', o.certainty ? `<span class="dots">${'●'.repeat(o.certainty)}<span class="muted">${'●'.repeat(5 - o.certainty)}</span></span>` : null, o.certainty && o.certainty === bCert)}
        ${o.conditions ? `<div class="oc-cond"><span class="muted small">Conditions</span><div class="small">${esc(o.conditions)}</div></div>` : ''}
        ${o.structure ? `<div class="muted small" style="margin-top:6px">${esc(o.structure)}</div>` : ''}
      </div>`; }).join('')}</div>`;
}

// ---------- Pipeline board ----------
const board = { tier: '', q: '', view: 'board', active: true };
const COL_LIMIT = 60;
function boardHtml(proj) {
  const q = board.q.toLowerCase();
  const all = members(proj.name).filter(({ c, p }) => (!board.tier || String(p.tier) === board.tier) && (!q || c.name.toLowerCase().includes(q)));
  const tiers = [...new Set(members(proj.name).map(m => m.p.tier).filter(Boolean))].sort();
  const daysSince = d => /^\d{4}-\d{2}-\d{2}/.test(d || '') ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 86400000)) : null;
  const head = `<div class="filters">
      <div class="seg-tabs"><button data-pview="board" class="${board.view !== 'table' ? 'on' : ''}">Board</button><button data-pview="table" class="${board.view === 'table' ? 'on' : ''}">Deal progress</button></div>
      <input type="search" id="boardSearch" placeholder="Find a buyer…" value="${esc(board.q)}">
      <select id="boardTier"><option value="">All tiers</option>${tiers.map(t => `<option ${String(t) === board.tier ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      ${board.view === 'table' ? `<label class="check"><input type="checkbox" id="boardActive" ${board.active ? 'checked' : ''}> Show active only</label>` : '<span class="muted small">Drag cards between columns. Moving to <b>Offer</b> asks for the offer amount.</span>'}
    </div>`;
  if (board.view === 'table') return head + progressHtml(all.filter(m => !board.active || !['Not approached', 'Passed'].includes(Engine.boardStage(m.p.status))), daysSince);
  return `${head}
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
            <div class="kmeta">${d != null ? `<span class="${d > 14 && st !== 'Passed' && st !== 'Not approached' ? 'err' : 'muted'}">${d}d ago</span>` : '<span></span>'}${heatChip(c, p)}
              ${p.offer?.amount ? `<b class="ok">${eur(p.offer.amount)} ${esc(p.offer.type || '')}</b>` : ''}${Engine.hasEmail(c) ? '<span title="Has email">✉</span>' : ''}</div>
          </div>`;
        }).join('')}${cards.length > COL_LIMIT ? `<div class="muted small" style="padding:6px">+ ${cards.length - COL_LIMIT} more (use the filters or the Buyers tab)</div>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
}

// Deal progress (OffDeal-style table): stage, last activity with time, best contact, offer and why they fit.
const BOARD_ORDER = st => Engine.BOARD_STAGES.indexOf(Engine.boardStage(st));
function lastActivity(p) {
  const first = String(p.log || '').split('\n').find(Boolean) || '';
  const m = first.match(/^(\d{4}-\d{2}-\d{2})\s*[–-]\s*(.+)$/);
  if (m) return { date: m[1], text: m[2] };
  return p.last_contact ? { date: p.last_contact, text: p.status || 'Contacted' } : null;
}
function progressHtml(list, daysSince) {
  const rows = [...list].sort((a, b) => BOARD_ORDER(b.p.status) - BOARD_ORDER(a.p.status) || String(lastActivity(b.p)?.date || '').localeCompare(String(lastActivity(a.p)?.date || '')));
  if (!rows.length) return '<div class="empty">No buyers to show. Untick <b>Show active only</b> or add buyers with Find buyers.</div>';
  return `<div class="table-wrap"><table class="data progress"><thead><tr><th>Buyer</th><th>Stage</th><th>Last activity</th><th>Best contact</th><th class="num">Offer</th><th>Relevant experience</th></tr></thead><tbody>
    ${rows.slice(0, 400).map(({ c, p }) => {
      const st = Engine.boardStage(p.status), la = lastActivity(p), d = la ? daysSince(la.date) : null, pc = Engine.bestContacts(c)[0];
      const stale = d != null && d > 14 && !['Passed', 'Not approached'].includes(st);
      return `<tr data-open-row="${c.id}">
        <td><div class="co">${logo(c)}<div style="min-width:0"><div class="co-name">${esc(c.name)}</div><div class="co-sub">${p.tier ? `<span class="tier t${esc(p.tier)}">T${esc(p.tier)}</span> ` : ''}${esc(buyerKind(c))}${c.country ? ' · ' + esc(c.country) : ''}</div></div></div></td>
        <td><span class="stage-pill" style="--c:${STAGE_COLORS[Engine.stageGroup(st)]}"><i></i>${esc(st)}</span>${p.status && p.status.replace(/^\d+[.)]\s*/, '').toLowerCase() !== st.toLowerCase() ? `<div class="muted small">${esc(p.status)}</div>` : ''}</td>
        <td>${la ? `<div class="small">${esc(la.text.slice(0, 60))}</div><div class="small ${stale ? 'err' : 'muted'}">${d === 0 ? 'today' : d === 1 ? 'yesterday' : d != null ? `${d} days ago` : esc(la.date)}</div>` : '<span class="muted small">No activity yet</span>'}</td>
        <td class="small">${pc ? `${esc(pc.name || pc.email)}${pc.title ? `<div class="muted">${esc(pc.title.slice(0, 40))}</div>` : ''}` : '<span class="muted">no contact</span>'}</td>
        <td class="num">${p.offer?.amount ? `<b>${p.offer.high ? `${eur(p.offer.low)}–${eur(p.offer.high)}` : eur(p.offer.amount)}</b><div class="muted small">${esc(p.offer.type || '')}</div>` : ''}</td>
        <td class="wrap small muted">${esc(String(p.rationale || c.short_description || '').replace(/^Match \d+: /, '').slice(0, 180))}</td>
      </tr>`; }).join('')}
  </tbody></table></div>`;
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
  if (stage === 'IOI received' || stage === 'Binding offer') return openOfferDialog(c, state.projectView, stage);
  if (stage === 'Passed') return openPassDialog(c, state.projectView);
  moveStage(c, state.projectView, stage);
  renderProjects();
});

// ---------- Offer and pass dialogs ----------
function openOfferDialog(c, projectName, stage) {
  const p = c.projects.find(x => x.project === projectName) || {};
  const o = p.offer || {};
  const dlg = $('#stageDialog');
  dlg._ctx = { kind: 'offer', id: c.id, projectName, stage };
  $('#stageForm').innerHTML = `<h2>${esc(stage === 'Binding offer' ? 'Binding offer' : 'Indicative offer (IOI)')} from ${esc(c.name)}</h2>
    <div class="form-grid">
      <label>Type <select name="type">${['IOI', 'Revised IOI', 'LOI', 'Binding offer'].map(t => `<option ${t === (o.type || (stage === 'Binding offer' ? 'LOI' : 'IOI')) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Date <input type="date" name="date" value="${o.date || today()}"></label>
      <label>EV low (EUR m) <input name="low" value="${o.low ?? o.amount ?? ''}" placeholder="e.g. 22"></label>
      <label>EV high (EUR m) <input name="high" value="${o.high ?? ''}" placeholder="e.g. 26 (leave empty for a point offer)"></label>
      <label>Structure <input name="structure" value="${esc(o.structure || '')}" placeholder="e.g. 80% cash at close, 20% earn-out, 10% rollover"></label>
      <label>Financing <input name="financing" value="${esc(o.financing || '')}" placeholder="e.g. balance sheet / committed debt"></label>
      <label class="full">Key conditions <input name="conditions" value="${esc(o.conditions || '')}" placeholder="e.g. confirmatory DD 6 weeks, management retention"></label>
      <label>Certainty (1 = low, 5 = high) <select name="certainty">${[1, 2, 3, 4, 5].map(n => `<option ${n === (o.certainty || 3) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <div class="toolbar"><span class="spacer"></span><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="save">Save offer</button></div>`;
  dlg.showModal();
}
function openPassDialog(c, projectName) {
  const dlg = $('#stageDialog');
  dlg._ctx = { kind: 'pass', id: c.id, projectName };
  $('#stageForm').innerHTML = `<h2>${esc(c.name)} passed</h2>
    <div class="form-grid">
      <label>Reason <select name="code">${Engine.PASS_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label>Declined by <select name="by"><option>Buyer</option><option>Seller / client</option></select></label>
      <label class="full">Feedback (optional) <input name="note" placeholder="What did they say?"></label>
    </div>
    <div class="toolbar"><span class="spacer"></span><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="save">Mark as passed</button></div>`;
  dlg.showModal();
}
$('#stageDialog').addEventListener('close', () => {
  const dlg = $('#stageDialog'), ctx = dlg._ctx;
  if (dlg.returnValue !== 'save' || !ctx) return ctx?.kind === 'apollo' ? null : renderProjects();
  if (ctx.kind === 'apollo') return revealPicked(ctx, new FormData($('#stageForm')).getAll('pick'));
  const d = Object.fromEntries(new FormData($('#stageForm')));
  const c = byId(ctx.id);
  if (ctx.kind === 'offer') {
    const low = Engine.parseNumber(d.low), high = Engine.parseNumber(d.high);
    const amount = low != null && high != null ? (low + high) / 2 : low ?? high;
    const p = moveStage(c, ctx.projectName, ctx.stage, `${d.type} ${high ? `${eur(low)}–${eur(high)}` : eur(amount)}${d.structure ? ', ' + d.structure : ''}`);
    p.offer_history ??= [];
    if (p.offer) p.offer_history.push(p.offer);
    p.offer = { type: d.type, date: d.date, low, high, amount, structure: d.structure, financing: d.financing, conditions: d.conditions, certainty: Number(d.certainty) };
  } else {
    const reason = d.code + (d.note ? `: ${d.note}` : '');
    const p = moveStage(c, ctx.projectName, 'Passed', reason);
    Object.assign(p, { pass_reason: reason, pass_code: d.code, passed_by: d.by });
  }
  touch(c);
  renderProjects();
});

// ---------- Find buyers ----------
const find = { limit: FIND_LIMIT, picked: new Set(), type: '' };
function findMatches(proj) {
  const inProject = new Set(members(proj.name).map(m => m.c.id));
  return Engine.match(dealOf(proj), state.companies.filter(c => !inProject.has(c.id)), state.weights);
}
const findFiltered = (proj, all = findMatches(proj)) => find.type ? all.filter(m => buyerKind(m.company) === find.type) : all;
function findHtml(proj) {
  if (!hasProfile(proj)) return `<div class="empty">First describe the company you're selling: sector, keywords and description.<br><br><button class="btn primary" data-x="editProfile">Add deal profile</button></div>`;
  const every = findMatches(proj), all = findFiltered(proj, every);
  const list = all.slice(0, find.limit);
  const deal = dealOf(proj);
  return `<div class="callout"><span>✦</span><div><b>${all.length.toLocaleString()} potential buyers</b> in your database that aren't on this project yet, ranked on
      niche, relevant acquisitions, keywords, M&A appetite, geography, size and how they behaved in earlier projects.</div></div>
    <div class="filters">
      ${kindPills(every, find.type, 'data-fkind')}
      <span class="spacer"></span>
      <label class="row-label small">Show top <input type="number" id="findLimit" value="${find.limit}" min="10" max="1000" style="width:72px"></label>
      <button class="link small" data-x="weights">Adjust weights</button>
      <button class="btn" data-x="pickTop">Select top 50</button>
      <button class="btn primary" data-x="addPicked">Add ${find.picked.size || 'selected'} to ${esc(proj.name)}</button>
    </div>
    <div class="table-wrap"><table class="data buyer-list"><thead><tr><th class="cb"></th>${BUYER_HEAD}</tr></thead><tbody>
      ${list.map(m => buyerRow(m, deal, { pick: 'data-fpick', picked: find.picked, extraWhy: conflictChip(m.company, proj.name) })).join('') || '<tr><td colspan="6"><div class="empty">No candidates. Add keywords to the deal profile or import more lists.</div></td></tr>'}
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
  const cad = cadenceOf(proj);
  const n = k => `<input type="number" data-cad="${k}" value="${cad[k]}" min="1" style="width:52px">`;
  return `<div class="card" style="margin-bottom:12px"><div class="cadence">
      <b>Cadence</b><span>Teaser</span><span>→ reminder after ${n('reminder')} d</span><span>→ call at ${n('call')} d</span><span>→ final note at ${n('final')} d</span><span class="muted">·</span><span>chase NDA after ${n('nda')} d</span>
    </div></div>
    <div class="filters">
      <span class="muted small">${due.length} actions due</span><span class="spacer"></span>
      <button class="btn" data-x="fuMarked">Mark selected as done</button>
      <button class="btn primary" data-x="fuEmail">✉ Email selected</button>
    </div>
    ${due.length ? `<div class="table-wrap"><table class="data" id="fuTable"><thead><tr><th class="cb"><input type="checkbox" id="fuAll"></th><th>Next action</th><th>Company</th><th>Tier</th><th>Stage</th><th>Last contact</th><th>Waiting</th><th>Best contact</th></tr></thead><tbody>
      ${due.map(({ c, p, action, days }) => { const pc = Engine.bestContacts(c)[0];
        return `<tr data-open-row="${c.id}"><td class="cb"><input type="checkbox" data-fu="${c.id}" data-action="${esc(action)}"></td>
        <td><span class="chip ${action === 'Call' ? 'purple' : action === 'Chase NDA' ? 'green' : action.startsWith('Final') ? 'red' : 'blue'}">${action === 'Call' ? '☎ ' : '✉ '}${esc(action)}</span></td>
        <td>${companyCell(c)}</td><td>${p.tier ? `<span class="tier t${esc(p.tier)}">T${esc(p.tier)}</span>` : ''}</td><td>${stageChip(p.status)}</td><td class="small">${esc(p.last_contact)}</td>
        <td><b class="${days > 21 ? 'err' : ''}">${days} days</b></td><td class="small">${pc ? `${esc(pc.name || pc.email)}${pc.role_tag ? ` <span class="tag k">${esc(pc.role_tag)}</span>` : ''}${pc.phone ? `<div class="muted">☎ ${esc(pc.phone)}</div>` : ''}` : '<span class="muted">no email</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty">🎉 No follow-ups due. Everyone was contacted recently, or hasn\'t been approached yet.</div>'}`;
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
  const fk = e.target.closest('[data-fkind]');
  if (fk) { find.type = fk.dataset.fkind; return renderProjects(); }
  const pv = e.target.closest('[data-pview]');
  if (pv) { board.view = pv.dataset.pview; return renderProjects(); }
  if (x === 'pickTop') { findFiltered(proj).slice(0, 50).forEach(m => find.picked.add(m.company.id)); return renderProjects(); }
  if (x === 'addPicked') { if (!find.picked.size) return toast('Tick the buyers to add first.'); addToProject(proj, [...find.picked]); return renderProjects(); }
  if (x === 'fuMarked') {
    const picked = $$('[data-fu]:checked');
    if (!picked.length) return toast('Select buyers first.');
    for (const cb of picked) {
      const c = byId(cb.dataset.fu), p = c.projects.find(q => q.project === proj.name), a = cb.dataset.action;
      if (a === 'Call') { p.dates ??= {}; p.dates.call = today(); p.last_contact = today(); p.log = `${today()} – Called${p.log ? '\n' + p.log : ''}`; touch(c); }
      else if (a === 'Chase NDA') { p.last_contact = today(); p.log = `${today()} – NDA chased${p.log ? '\n' + p.log : ''}`; touch(c); }
      else if (a.startsWith('Final')) moveStage(c, proj.name, 'Final reminder sent');
      else moveStage(c, proj.name, nextOutreachStage(p.status) || 'Reminder sent');
    }
    return renderProjects();
  }
  if (x === 'editTimeline') { state.editTimeline = !state.editTimeline; return renderProjects(); }
  if (x === 'report' || x === 'reportAnon') return openReport(proj, x === 'reportAnon');
  if (x === 'fuEmail') { const ids = fuPicked(); if (!ids.length) return toast('Select buyers first.'); return emailFromProject(proj.name, ids); }
  if (e.target.dataset.fpick) { e.target.checked ? find.picked.add(e.target.dataset.fpick) : find.picked.delete(e.target.dataset.fpick); const b = $('[data-x=addPicked]'); if (b) b.textContent = `Add ${find.picked.size || 'selected'} to ${proj.name}`; return; }
  if (e.target.id === 'fuAll') { $$('[data-fu]').forEach(cb => (cb.checked = e.target.checked)); return; }
  const ob = e.target.closest('button[data-open]');
  if (ob) return openDrawer(ob.dataset.open, 'projects');
  if (e.target.closest('input,a,button,select')) return;
  const open = e.target.closest('[data-open],[data-open-row],[data-card]');
  if (open) openDrawer(open.dataset.open || open.dataset.openRow || open.dataset.card, 'projects');
});
$('#projectsView').addEventListener('change', e => {
  const proj = state.projects.find(p => p.name === state.projectView);
  if (!proj) return;
  const t = e.target;
  if (t.dataset.phaseDone !== undefined) { timelineOf(proj)[+t.dataset.phaseDone].done = t.checked; saveProjects(); return renderProjects(); }
  if (t.dataset.phase !== undefined) { timelineOf(proj)[+t.dataset.phase][t.dataset.k] = t.value; saveProjects(); return renderProjects(); }
  if (t.dataset.cad) { proj.cadence = { ...cadenceOf(proj), [t.dataset.cad]: Number(t.value) || DEFAULT_CADENCE[t.dataset.cad] }; saveProjects(); return renderProjects(); }
  if (t.dataset.mult) {
    proj.multiples ??= JSON.parse(JSON.stringify(valuation(proj).m));
    proj.multiples[t.dataset.mult][+t.dataset.i] = Number(String(t.value).replace(',', '.')) || 0;
    saveProjects();
    return renderProjects();
  }
  if (t.id === 'findLimit') { find.limit = Math.max(10, Number(t.value) || FIND_LIMIT); return renderProjects(); }
  if (t.id === 'boardTier') { board.tier = t.value; return renderProjects(); }
  if (t.id === 'boardActive') { board.active = t.checked; return renderProjects(); }
});
let boardTimer;
$('#projectsView').addEventListener('input', e => {
  if (e.target.id !== 'boardSearch') return;
  board.q = e.target.value;
  clearTimeout(boardTimer);
  boardTimer = setTimeout(() => { renderProjects(); const s = $('#boardSearch'); s.focus(); s.setSelectionRange(board.q.length, board.q.length); }, 200);
});
