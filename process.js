/* global Engine, state, esc, logo, members, stats, saveProjects, showTab, renderProjects, followUpsDue, dealOf, valuation, eur, today, STAGE_COLORS, companyCell */
// Process layer: timeline per mandate, buyer heat score, conflict check, firm dashboard and the weekly client report.

// ---------- Timeline ----------
// Typical sell-side phases in weeks from the project start (6–9 months in total).
const PHASES = [
  ['Preparation (IM, longlist, valuation)', 0, 4],
  ['Teaser & NDAs', 4, 8],
  ['IM & first-round offers (IOI)', 8, 12],
  ['Management meetings & due diligence', 12, 17],
  ['Binding offers (LOI)', 17, 20],
  ['Exclusivity & SPA', 20, 26],
  ['Signing & closing', 26, 28],
];
const addWeeks = (iso, w) => new Date(new Date(iso).getTime() + w * 7 * 86400000).toISOString().slice(0, 10);

function timelineOf(proj) {
  if (!proj.timeline?.length) {
    const start = (proj.start || proj.created || new Date().toISOString()).slice(0, 10);
    proj.timeline = PHASES.map(([name, a, b]) => ({ name, start: addWeeks(start, a), end: addWeeks(start, b), done: false }));
  }
  return proj.timeline;
}
// A phase also counts as done once any buyer has moved past it (e.g. teasers going out = preparation finished).
const PHASE_DONE_WHEN = ['Teaser sent', 'IOI received', 'Management meeting', 'Binding offer', 'Signed', 'Signed', null];
function phaseDone(proj, i) {
  const ph = timelineOf(proj)[i];
  if (ph.done) return true;
  const need = PHASE_DONE_WHEN[i];
  if (!need) return false;
  const max = Math.max(-1, ...members(proj.name).map(m => Engine.reachedIndex(m.p)));
  return max >= Engine.BOARD_STAGES.indexOf(need);
}
function currentPhase(proj) {
  const t = timelineOf(proj), now = today();
  const open = t.filter((ph, i) => !phaseDone(proj, i));
  return open.find(ph => ph.start <= now) || open[0] || t[t.length - 1];
}
const deadline = (proj, i) => timelineOf(proj)[i]?.end;
const daysUntil = iso => Math.round((new Date(iso).getTime() - Date.now()) / 86400000);

function ganttHtml(proj, editing) {
  const t = timelineOf(proj);
  const min = new Date(t[0].start).getTime(), max = new Date(t[t.length - 1].end).getTime();
  const pos = iso => Math.max(0, Math.min(100, ((new Date(iso).getTime() - min) / (max - min)) * 100));
  const now = today(), cur = currentPhase(proj);
  const todayLeft = pos(now);
  return `<div class="gantt">
    ${t.map((ph, i) => {
      const done = phaseDone(proj, i);
      const late = !done && ph.end < now;
      return `<div class="g-row ${ph === cur ? 'cur' : ''}">
        <div class="g-label"><input type="checkbox" data-phase-done="${i}" ${done ? 'checked' : ''} title="Mark phase done"> ${esc(ph.name)}</div>
        <div class="g-track">${now >= t[0].start && now <= t[t.length - 1].end ? `<div class="g-today" style="left:${todayLeft}%"></div>` : ''}
          <div class="g-bar ${done ? 'done' : late ? 'late' : ph === cur ? 'now' : ''}" style="left:${pos(ph.start)}%;width:${Math.max(2, pos(ph.end) - pos(ph.start))}%"></div></div>
        <div class="g-dates small muted">${editing ? `<input type="date" data-phase="${i}" data-k="start" value="${ph.start}"> – <input type="date" data-phase="${i}" data-k="end" value="${ph.end}">` : `${ph.start.slice(5)} → ${ph.end.slice(5)}${late ? ' <span class="err">overdue</span>' : ''}`}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ---------- Buyer heat score ----------
// Rules-based engagement score: how far the buyer got, how recently we heard from them, and signals along the way.
function heat(c, p) {
  if (!p || Engine.boardStage(p.status) === 'Passed') return { score: 0, drivers: ['Passed'] };
  const drivers = [];
  let s = (Engine.reachedIndex(p) / (Engine.BOARD_STAGES.length - 2)) * 60;
  if (Engine.reachedIndex(p) > 2) drivers.push(Engine.BOARD_STAGES[Engine.reachedIndex(p)]);
  const d = /^\d{4}-\d{2}-\d{2}/.test(p.last_contact || '') ? (Date.now() - new Date(p.last_contact).getTime()) / 86400000 : null;
  if (d != null && Engine.reachedIndex(p) > 0) { const r = d <= 7 ? 25 : d <= 14 ? 15 : d <= 30 ? 8 : 0; s += r; if (r >= 15) drivers.push(`contact ${Math.round(d)}d ago`); }
  const dt = p.dates || {};
  if (dt.nda_signed && dt.teaser && (new Date(dt.nda_signed) - new Date(dt.teaser)) / 86400000 <= 10) { s += 8; drivers.push('fast NDA'); }
  if (dt.meeting) { s += 5; drivers.push('met management'); }
  if (p.offer?.amount) { s += 7; drivers.push(`offer ${eur(p.offer.amount)}`); }
  return { score: Math.round(Math.min(100, s)), drivers: drivers.slice(0, 3) };
}
const heatChip = (c, p) => {
  const h = heat(c, p);
  if (!h.score) return '';
  const cls = h.score >= 60 ? 'red' : h.score >= 35 ? 'amber' : '';
  return `<span class="chip heat ${cls}" title="Engagement ${h.score}/100${h.drivers.length ? ': ' + h.drivers.join(', ') : ''}">🔥 ${h.score}</span>`;
};

// ---------- Conflict check ----------
// Other live mandates where this buyer is actively engaged.
function liveElsewhere(c, projectName) {
  const live = new Set(state.projects.filter(p => p.status === 'Active').map(p => p.name));
  return (c.projects || []).filter(p => p.project !== projectName && live.has(p.project) && Engine.stageGroup(p.status) === 'Engaged').map(p => p.project);
}
const conflictChip = (c, projectName) => { const l = liveElsewhere(c, projectName); return l.length ? `<span class="chip amber" title="Actively engaged in another live mandate">⚠ live in ${esc(l.join(', '))}</span>` : ''; };

// ---------- Next best actions ----------
function projectActions(proj) {
  const out = [];
  const add = (urgency, text, tab, extra = {}) => out.push({ urgency, text, tab, project: proj.name, ...extra });
  const fu = followUpsDue(proj.name);
  const byAction = {};
  fu.forEach(f => (byAction[f.action] = (byAction[f.action] || 0) + 1));
  for (const [a, n] of Object.entries(byAction)) add(a === 'Chase NDA' ? 2 : 3, `${a}: ${n} buyer${n === 1 ? '' : 's'}`, 'followups');
  const m = members(proj.name);
  const ioiDue = deadline(proj, 2);
  if (ioiDue && daysUntil(ioiDue) >= 0 && daysUntil(ioiDue) <= 10) {
    const waiting = m.filter(({ p }) => ['IM sent'].includes(Engine.boardStage(p.status))).length;
    if (waiting) add(1, `IOI deadline in ${daysUntil(ioiDue)} days: ${waiting} buyer${waiting === 1 ? '' : 's'} with the IM have not bid yet`, 'buyers');
  }
  const t1 = m.filter(({ p }) => String(p.tier) === '1' && Engine.boardStage(p.status) === 'Not approached').length;
  if (t1) add(4, `${t1} tier-1 buyer${t1 === 1 ? '' : 's'} not approached yet`, 'buyers');
  const ph = currentPhase(proj);
  if (ph && !phaseDone(proj, timelineOf(proj).indexOf(ph)) && ph.end < today()) add(2, `Phase "${ph.name}" is overdue (planned end ${ph.end})`, 'overview');
  if (!proj.target?.sector && !proj.target?.keywords) add(5, 'Add a deal profile so Find buyers and valuation work', 'overview');
  return out;
}

// ---------- Dashboard ----------
function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function funnelCounts(pairs) {
  const reach = i => pairs.filter(({ p }) => Engine.reachedIndex(p) >= i).length;
  const ix = s => Engine.BOARD_STAGES.indexOf(s);
  return { contacted: reach(ix('Teaser sent')), nda: reach(ix('NDA signed')), im: reach(ix('IM sent')), ioi: reach(ix('IOI received')), binding: reach(ix('Binding offer')), signed: reach(ix('Signed')) };
}
const PASS_BUCKETS = [[/price|valuation|expensive|multiple/i, 'Price / valuation'], [/fit|strategic|priority|focus|not core/i, 'Strategic fit / priority'], [/size|small|large|ticket/i, 'Size'], [/timing|time|later|budget/i, 'Timing'], [/overlap|already|own product|capabilit/i, 'Overlap / existing capability'], [/competitor|conflict/i, 'Competitor / conflict'], [/response|no reply/i, 'No response'], [/partner/i, 'Prefers partnership']];
const passBucket = r => (PASS_BUCKETS.find(([re]) => re.test(r || '')) || [null, r ? 'Other' : 'No reason given'])[1];

function renderDashboard() {
  const active = state.projects.filter(p => p.status === 'Active');
  const pairs = state.companies.flatMap(c => c.projects.filter(p => active.some(a => a.name === p.project)).map(p => ({ c, p })));
  const f = funnelCounts(pairs);
  const actions = active.flatMap(projectActions).sort((a, b) => a.urgency - b.urgency);
  const inProcess = pairs.filter(({ p }) => Engine.stageGroup(p.status) === 'Engaged').length;
  const passed = pairs.filter(({ p }) => Engine.stageGroup(p.status) === 'Passed');
  const reasons = {};
  passed.forEach(({ p }) => { const k = passBucket(p.pass_reason); reasons[k] = (reasons[k] || 0) + 1; });
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const byType = ['Strategic', 'Financial'].map(t => {
    const ps = pairs.filter(({ c }) => (t === 'Financial') === (c.role === 'Investor'));
    const ff = funnelCounts(ps);
    return { t, n: ps.length, contacted: ff.contacted, nda: ff.nda, ioi: ff.ioi };
  });
  // Deals done by buyers on active mandates in the last two years: a signal of who is buying now.
  const cutoff = String(new Date().getFullYear() - 2);
  const buyers = [...new Set(pairs.map(x => x.c))];
  const recentDeals = buyers.flatMap(c => (c.acquisitions || []).map(a => ({ c, a, d: String(a.date || a.year || '') })))
    .filter(x => x.d >= cutoff).sort((x, y) => y.d.localeCompare(x.d)).slice(0, 15);
  const tile = (k, v, sub) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  const step = (label, n, base, bench) => `<div class="fstep"><div class="fbar" style="width:${Math.max(4, pct(n, f.contacted || 1))}%"></div><span><b>${n}</b> ${label}</span><span class="muted small">${base != null ? pct(n, base) + '% of previous' : ''}${bench ? ` · typical ${bench}` : ''}</span></div>`;

  $('#dashboardView').innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><div class="muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${active.length} active mandates</div></div>
      <div class="actions"><button class="btn" data-go="projects">All projects</button></div></div>
    <div class="kpis">
      ${tile('Active mandates', active.length)}
      ${tile('Buyers contacted', f.contacted, `${pairs.length} on longlists`)}
      ${tile('In process', inProcess, 'NDA or further')}
      ${tile('NDAs signed', f.nda, `${pct(f.nda, f.contacted)}% of contacted`)}
      ${tile('IOIs received', f.ioi)}
      ${tile('Actions open', actions.length, actions.filter(a => a.urgency <= 2).length + ' urgent')}
    </div>

    <div class="dash-grid">
      <div class="card">
        <h2>Next best actions</h2>
        ${actions.length ? `<div class="actions-list">${actions.slice(0, 14).map(a => `<button class="action u${a.urgency}" data-goproj="${esc(a.project)}" data-gotab="${a.tab}">
          <span class="dot"></span><span class="txt">${esc(a.text)}</span><span class="chip">${esc(a.project)}</span></button>`).join('')}</div>` : '<div class="empty">Nothing urgent. 🎉</div>'}
      </div>
      <div class="card">
        <h2>Mandates</h2>
        ${active.map(p => {
          const s = stats(p.name), ph = currentPhase(p), t = timelineOf(p);
          const total = (new Date(t[t.length - 1].end) - new Date(t[0].start)) / 86400000, done = (Date.now() - new Date(t[0].start)) / 86400000;
          const best = members(p.name).filter(m => m.p.offer?.amount).sort((a, b) => b.p.offer.amount - a.p.offer.amount)[0];
          const quiet = s.last && (Date.now() - new Date(s.last).getTime()) / 86400000 > 14;
          return `<div class="mandate" data-goproj="${esc(p.name)}" data-gotab="overview">
            <div class="m-head"><b>${esc(p.name)}</b> <span class="muted small">${esc(p.client || '')}</span><span class="spacer"></span>${quiet ? '<span class="chip amber">quiet >14d</span>' : ''}${ph && !phaseDone(p, t.indexOf(ph)) && ph.end < today() ? '<span class="chip red">phase overdue</span>' : ''}</div>
            <div class="small">${esc(ph?.name || '')} · week ${Math.max(1, Math.ceil(done / 7))} of ${Math.ceil(total / 7)}</div>
            <div class="bar"><div style="width:${Math.max(0, Math.min(100, (done / total) * 100))}%;background:var(--accent)"></div></div>
            <div class="small muted">${s.total} buyers · ${s.groups.Engaged} engaged · ${s.groups.Passed} passed${best ? ` · best offer <b class="ok">${eur(best.p.offer.amount)}</b>` : ''}</div>
          </div>`;
        }).join('') || '<div class="empty">No active mandates.</div>'}
      </div>
      <div class="card">
        <h2>Conversion (active mandates)</h2>
        <div class="ffunnel">
          ${step('contacted', f.contacted, null)}
          ${step('NDA signed', f.nda, f.contacted, '30–60%')}
          ${step('received the IM', f.im, f.nda)}
          ${step('submitted an IOI', f.ioi, f.im, '15–35% of NDAs')}
          ${step('binding offer', f.binding, f.ioi, '2–4 LOIs')}
          ${step('signed', f.signed, f.binding)}
        </div>
        <h3>By buyer type</h3>
        <table class="compact"><thead><tr><th></th><th class="num">Longlist</th><th class="num">Contacted</th><th class="num">NDA rate</th><th class="num">IOI</th></tr></thead><tbody>
          ${byType.map(r => `<tr><td>${r.t}</td><td class="num">${r.n}</td><td class="num">${r.contacted}</td><td class="num">${pct(r.nda, r.contacted)}%</td><td class="num">${r.ioi}</td></tr>`).join('')}
        </tbody></table>
        <p class="muted small">Benchmarks from advisor sources: of 100 approached buyers ~30 sign an NDA and 5–15 submit an IOI.</p>
      </div>
      <div class="card">
        <h2>Why buyers pass <span class="muted">(${passed.length})</span></h2>
        ${reasonRows.length ? reasonRows.map(([k, n]) => `<div class="hbar"><span>${esc(k)}</span><div><div style="width:${pct(n, reasonRows[0][1])}%"></div></div><b>${n}</b></div>`).join('') : '<div class="empty">No passes recorded.</div>'}
        <p class="muted small">Record a reason when you drag a buyer to <b>Passed</b>; it's used to down-rank similar buyers in Find buyers.</p>
      </div>
      <div class="card span2">
        <h2>Recent acquisitions by your buyers <span class="muted">(since ${cutoff})</span></h2>
        ${recentDeals.length ? `<table class="compact"><thead><tr><th>Date</th><th>Buyer</th><th>Bought</th><th>Industry</th><th>Size</th><th>Our projects</th></tr></thead><tbody>
          ${recentDeals.map(({ c, a, d }) => `<tr><td class="small">${esc(d)}</td><td><button class="link" data-opendeal="${c.id}">${esc(c.name)}</button></td>
            <td><b>${esc(a.target)}</b>${a.target_website ? ` <a class="ext" href="${esc(Engine.cleanUrl(a.target_website))}" target="_blank" rel="noopener">↗</a>` : ''}${a.source_url ? ` <a class="small" href="${esc(a.source_url)}" target="_blank" rel="noopener">source</a>` : ''}</td>
            <td class="small">${esc(a.industry || '')}</td><td class="small">${esc([a.deal_value, a.target_revenue && 'rev. ' + a.target_revenue, a.target_employees && a.target_employees + ' FTE'].filter(Boolean).join(' · '))}</td>
            <td>${c.projects.filter(p => active.some(x => x.name === p.project)).map(p => `<span class="chip">${esc(p.project)}</span>`).join('')}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No recent acquisitions recorded yet. Import an acquisitions research file (✦ Import research) to fill this.</div>'}
      </div>
    </div>`;
}
$('#dashboardView').addEventListener('click', e => {
  if (e.target.dataset.opendeal) return openDrawer(e.target.dataset.opendeal, 'acquisitions');
  const g = e.target.closest('[data-goproj]');
  if (g) { state.projectView = g.dataset.goproj; state.projectTab = g.dataset.gotab || 'overview'; return showTab('projects'); }
  if (e.target.dataset.go) showTab(e.target.dataset.go);
});

// ---------- Weekly client report ----------
function openReport(proj, anonymise) {
  const m = members(proj.name);
  const s = stats(proj.name), f = funnelCounts(m), ph = currentPhase(proj);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const alias = new Map();
  const nameOf = c => anonymise ? (alias.get(c.id) || (alias.set(c.id, `${c.role === 'Investor' ? 'Financial investor' : 'Strategic buyer'} ${String.fromCharCode(65 + (alias.size % 26))}${alias.size >= 26 ? Math.floor(alias.size / 26) : ''}`), alias.get(c.id))) : c.name;
  const engaged = m.filter(({ p }) => Engine.stageGroup(p.status) === 'Engaged').sort((a, b) => Engine.reachedIndex(b.p) - Engine.reachedIndex(a.p));
  const recent = m.flatMap(({ c, p }) => String(p.log || '').split('\n').filter(l => l.slice(0, 10) >= weekAgo).map(l => ({ c, l })));
  const passedWeek = m.filter(({ p }) => Engine.boardStage(p.status) === 'Passed' && (p.dates?.passed || '') >= weekAgo);
  const offers = m.filter(({ p }) => p.offer?.amount || p.offer?.low);
  const v = valuation(proj);
  const actions = projectActions(proj).sort((a, b) => a.urgency - b.urgency);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(proj.name)} – status report ${today()}</title>
  <style>body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#14181f;max-width:860px;margin:32px auto;padding:0 24px;font-size:13px;line-height:1.5}
  h1{font-size:22px;margin:0}h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#475467;border-bottom:1px solid #e6e8ec;padding-bottom:4px;margin-top:26px}
  table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eef0f3;vertical-align:top}th{font-size:11px;color:#667085;text-transform:uppercase}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:14px}.kpi{border:1px solid #e6e8ec;border-radius:8px;padding:10px}.kpi b{font-size:20px;display:block}
  .muted{color:#667085}.num{text-align:right}.noprint{margin:16px 0}@media print{.noprint{display:none}body{margin:0}}</style></head><body>
  <div class="noprint"><button onclick="print()">Print / save as PDF</button></div>
  <div class="muted">33 Equity · Weekly status report · ${today()}</div>
  <h1>Project ${esc(proj.name)}${proj.client ? ` – ${esc(proj.client)}` : ''}</h1>
  <div class="muted">Current phase: <b>${esc(ph?.name || '')}</b>${ph ? ` (planned ${ph.start} → ${ph.end})` : ''}</div>
  <div class="kpis"><div class="kpi"><b>${s.total}</b>parties on longlist</div><div class="kpi"><b>${f.contacted}</b>contacted</div><div class="kpi"><b>${f.nda}</b>NDAs signed</div><div class="kpi"><b>${f.ioi}</b>indicative offers</div><div class="kpi"><b>${s.groups.Passed}</b>declined</div></div>
  <h2>Parties in process</h2>${engaged.length ? `<table><tr><th>Party</th><th>Type</th><th>Stage</th><th>Last contact</th><th>Notes</th></tr>${engaged.map(({ c, p }) => `<tr><td><b>${esc(nameOf(c))}</b></td><td>${c.role === 'Investor' ? 'Financial' : 'Strategic'}</td><td>${esc(Engine.boardStage(p.status))}</td><td>${esc(p.last_contact || '')}</td><td class="muted">${esc(String(p.log || '').split('\n')[0].slice(13, 140))}</td></tr>`).join('')}</table>` : '<p class="muted">No parties beyond the teaser stage yet.</p>'}
  ${offers.length ? `<h2>Offers received</h2><table><tr><th>Party</th><th>Type</th><th class="num">EV</th><th>Structure</th><th>Conditions</th></tr>${offers.map(({ c, p }) => `<tr><td>${esc(nameOf(c))}</td><td>${esc(p.offer.type || '')}</td><td class="num"><b>${p.offer.low && p.offer.high ? `${eur(p.offer.low)}–${eur(p.offer.high)}` : eur(p.offer.amount)}</b></td><td>${esc(p.offer.structure || '')}</td><td class="muted">${esc(p.offer.conditions || '')}</td></tr>`).join('')}</table>${v.ev[1] ? `<p class="muted">Indicative valuation range ${eur(v.ev[0])} – ${eur(v.ev[2])} (mid ${eur(v.ev[1])}).</p>` : ''}` : ''}
  <h2>Activity this week</h2>${recent.length ? `<ul>${recent.slice(0, 40).map(({ c, l }) => `<li><b>${esc(nameOf(c))}</b>: ${esc(l)}</li>`).join('')}</ul>` : '<p class="muted">No logged activity in the last 7 days.</p>'}
  ${passedWeek.length ? `<h2>Feedback from parties that declined</h2><ul>${passedWeek.map(({ c, p }) => `<li><b>${esc(nameOf(c))}</b>: ${esc(p.pass_reason || 'no reason given')}</li>`).join('')}</ul>` : ''}
  <h2>Next steps</h2><ul>${actions.map(a => `<li>${esc(a.text)}</li>`).join('') || '<li>Continue outreach according to plan.</li>'}</ul>
  <h2>Timeline</h2><table><tr><th>Phase</th><th>Planned</th><th>Status</th></tr>${timelineOf(proj).map((t, i) => `<tr><td>${esc(t.name)}</td><td>${t.start} → ${t.end}</td><td>${phaseDone(proj, i) ? 'Done' : t === ph ? 'In progress' : t.end < today() ? 'Behind plan' : 'Planned'}</td></tr>`).join('')}</table>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to open the report.');
  w.document.write(html);
  w.document.close();
}
