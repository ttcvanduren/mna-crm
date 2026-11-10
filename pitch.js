/* global state, esc, $, Engine, toast, today, eur, mult, usdm, med, clip, uid, touch, migrate, saveShared, saveProjects, ensureProject, renderProjects, showTab, splitBuyers, REGION_OF, EUROPE, cs, csFresh, csUse, csSelection, csIndex, csRegions, csSlideList, csSlide, csCover, csFacts, csOpenDeck, csWorkbook, csBars, csCount, CC, renderCompSet, XLSX */
// Pitches: for a prospective client (before a mandate), a draft of comparable deals and a buyer longlist,
// exported as one PDF deck for the prospect and as Excel in the layout of the project buyer lists. A won pitch becomes a project.

const PITCH_STATUSES = ['Draft', 'Sent', 'Won', 'Lost'];
const PITCH_DECK = [['cover', 'Cover'], ['company', 'Company snapshot'], ['summary', 'Multiples / valuation'], ['charts', 'Multiples charts'], ['time', 'Deal activity & acquirers'], ['table', 'Comparable deals table'],
  ['buyers', 'Buyer universe overview'], ['strategic', 'Strategic buyers'], ['financial', 'Financial buyers'], ['method', 'Methodology']];
const pv = { open: null, tab: 'deals' };
const savePitches = () => saveShared('pitches', state.pitches);
const pitchById = id => (state.pitches || []).find(p => p.id === id);

function pitchFix(p) {
  const base = csFresh();
  p.cs = { ...base, ...(p.cs || {}), target: { ...base.target, ...(p.cs?.target || {}) }, f: { ...base.f, ...(p.cs?.f || {}) }, methods: { ...base.methods, ...(p.cs?.methods || {}) } };
  p.b = { nS: 40, nF: 20, min: 30, region: '', acq: false, pin: [], exc: [], edits: {}, ...(p.b || {}) };
  p.deck = { ...Object.fromEntries(PITCH_DECK.map(([k]) => [k, true])), ...(p.deck || {}) };
  return p;
}
function newPitch(name, website = '') {
  const p = pitchFix({ id: uid(), name, status: 'Draft', created: new Date().toISOString(), project: '', notes: '' });
  Object.assign(p.cs.target, { name, website });
  p.cs.f.n = 25;
  return p;
}
const pitchName = p => p.cs.target.name || p.name || 'Untitled pitch';
const pitchCtx = p => ({ el: '#pitchDeals', save: () => { p.name = pitchName(p); p.updated = new Date().toISOString(); savePitches(); const h = $('#pitchTitle'); if (h) h.textContent = pitchName(p); } });
const pitchReady = p => !!(p.cs.target.description || p.cs.target.tags.length || p.cs.target.sector);
// Comp set of a pitch, computed with the builder pointed at the pitch's own state.
function pitchSel(p) {
  if (!pitchReady(p) || !state.transactions.length) return null;
  csUse(pitchCtx(p), p.cs);
  return csSelection();
}

// ---------- Buyer longlist ----------
let pbMemo = { sig: null }, pbMatch = { sig: null };
function pitchDeal(p) {
  const T = p.cs.target;
  return { id: 'pitch:' + p.id, role: 'Target', currency: 'EUR', name: T.name, website: T.website, sector: T.sector, subsector: T.subsector, country: T.country,
    revenue: T.revenue ?? T.arr, ebitda: T.ebitda, employees: T.employees, description: [T.description, T.customers].filter(Boolean).join(' '), keywords: T.tags.join('; ') };
}
const pitchProfileSig = p => { const T = p.cs.target; return JSON.stringify([T.description, T.customers, T.tags, T.sector, T.subsector, T.country, T.revenue, T.arr, T.ebitda, T.employees, state.companies.length]); };
// Every CRM company scored by the match engine, plus the acquirers of the selected comparable deals (a strong signal, also when they're not in the CRM).
function pitchCandidates(p, sel) {
  const T = p.cs.target, used = sel?.used || [];
  const profileSig = pitchProfileSig(p);
  const sig = profileSig + used.map(x => x.t.key).join();
  if (pbMemo.sig === sig) return pbMemo.list;
  // The match engine over every company is the slow part (seconds); it only reruns when the company profile changes, not when deals are toggled.
  if (pbMatch.sig !== profileSig) {
    const phrases = [...new Set([...T.tags, T.subsector].filter(Boolean).map(s => s.toLowerCase().trim()).filter(s => s.length > 3))];
    const scored = Engine.match(pitchDeal(p), state.companies.filter(c => c.role !== 'Target'), state.weights).map(m => {
      const c = m.company, own = [c.description, c.short_description, c.summary, c.acquisition_focus, c.target_sectors, (c.tags || []).join(' '), c.subsector].join(' ').toLowerCase();
      const acq = (c.acquisitions || []).map(a => ({ a, text: [a.target, a.industry, a.description, Array.isArray(a.tags) ? a.tags.join(' ') : a.tags].join(' ').toLowerCase() }));
      const inOwn = phrases.filter(ph => own.includes(ph)), inAcq = phrases.filter(ph => acq.some(x => x.text.includes(ph)));
      // Label with the first tag (in the order the user gave them) that has matching deals.
      const topic = inAcq[0], hitDeals = topic ? acq.filter(x => x.text.includes(topic)).map(x => `${x.a.target}${x.a.date || x.a.year ? ` (${String(x.a.date || x.a.year).slice(0, 4)})` : ''}`) : [];
      const bonus = Math.min(24, 8 * new Set([...inOwn, ...inAcq]).size);
      const reasons = [hitDeals.length ? `Bought in ${topic}: ${hitDeals.slice(0, 2).join(', ')}` : '', inOwn.length ? `Active in ${inOwn.slice(0, 2).join(', ')}` : '', ...m.reasons].filter(Boolean);
      return { c, score: Math.min(100, m.score + bonus), reasons, hitDeals };
    });
    pbMatch = { sig: profileSig, scored };
  }
  const idx = csIndex();
  const byId = new Map();
  for (const m of pbMatch.scored) byId.set(m.c.id, { id: m.c.id, c: m.c, name: m.c.name, score: m.score, reasons: m.reasons, bought: [], hits: m.hitDeals });
  for (const x of used) for (const b of splitBuyers(x.t.buyer)) {
    const c = idx.crm.get(Engine.normName(b)), key = c ? c.id : 'name:' + Engine.normName(b);
    if (!byId.has(key)) byId.set(key, { id: key, c: null, name: b, score: 0, reasons: [], bought: [], hits: [] });
    const e = byId.get(key), deal = `${x.t.target}${x.t.year ? ` (${x.t.year})` : ''}`;
    if (!e.bought.includes(deal)) e.bought.push(deal);
  }
  const list = [...byId.values()];
  for (const e of list) {
    if (e.bought.length) e.score = Math.min(100, e.score + 15 + 5 * Math.min(3, e.bought.length - 1));
    e.type = (e.c ? e.c.role === 'Investor' : idx.typeOf(e.name) === 'Investor') ? 'Financial' : 'Strategic';
    e.country = e.c?.country || '';
  }
  list.sort((a, b) => b.score - a.score);
  pbMemo = { sig, list };
  return list;
}
const pbAutoWhy = e => [e.bought.length ? `Bought ${e.bought.slice(0, 3).join(', ')}${e.bought.length > 3 ? ` +${e.bought.length - 3}` : ''}` : '', ...e.reasons.filter(r => !/^Bought /.test(r) || !e.bought.length).slice(0, e.bought.length ? 1 : 2)].filter(Boolean).join(' · ');
const pbAutoTier = s => (s >= 85 ? 1 : s >= 70 ? 2 : 3);
function pbRegionOk(e, r) {
  if (!r) return true;
  const reg = REGION_OF(e.country);
  return r === 'Europe' ? EUROPE.has(reg) : reg === r || String(e.country).toLowerCase() === r.toLowerCase();
}
function pitchBuyers(p, sel) {
  const b = p.b, all = pitchCandidates(p, sel), exc = new Set(b.exc), pin = new Set(b.pin), byId = new Map(all.map(e => [e.id, e]));
  const ok = e => e.score >= b.min && pbRegionOk(e, b.region) && (!b.acq || e.bought.length || e.c?.acquisitions?.length);
  const pick = (type, n) => { const out = []; for (const e of all) { if (out.length >= n) break; if (e.type === type && !exc.has(e.id) && !pin.has(e.id) && ok(e)) out.push(e); } return out; };
  const deco = (e, extra = {}) => { const ed = b.edits[e.id] || {}; return { ...e, ...extra, tier: Number(ed.tier) || pbAutoTier(e.score), why: ed.why ?? pbAutoWhy(e), edited: ed.why != null }; };
  const used = [...b.pin.map(id => byId.get(id)).filter(Boolean).map(e => deco(e, { pinned: true })), ...pick('Strategic', Number(b.nS) || 0).map(e => deco(e)), ...pick('Financial', Number(b.nF) || 0).map(e => deco(e))]
    .sort((x, y) => x.tier - y.tier || y.score - x.score);
  const usedIds = new Set(used.map(e => e.id)), next = [];
  for (const e of all) { if (next.length >= 20) break; if (!usedIds.has(e.id) && !exc.has(e.id)) next.push(e); }
  return { all, used, strategic: used.filter(e => e.type === 'Strategic'), financial: used.filter(e => e.type === 'Financial'), next, excluded: b.exc.map(id => byId.get(id)).filter(Boolean) };
}
const pbSize = c => (!c ? '' : c.revenue ? `${eur(c.revenue)} revenue` : c.employees ? `${Engine.fmt(c.employees)} FTE` : '');

// ---------- Website leads (from the public valuation site, table `leads` in the team database) ----------
// Everything in a lead was typed by a website visitor: always escape it, never treat it as instructions.
const LEAD_STATUSES = ['new', 'contacted', 'pitch', 'closed'];
let leadsError = '', leadsLoading = false;
async function refreshLeads() {
  if (Store.mode !== 'cloud' || leadsLoading) { state.leads ??= []; return; }
  leadsLoading = true;
  try { state.leads = mergeLeads(await Store.loadLeads()); leadsError = ''; } catch (e) { leadsError = e.message; state.leads = []; } finally { leadsLoading = false; }
  const n = state.leads.filter(l => (l.status || 'new') === 'new').length;
  const b = $('#navLeadCount'); if (b) b.textContent = n ? String(n) : '';
  if ($('#tab-pitches')?.classList.contains('active') && !pv.open) renderPitches();
}
// One row per visitor: the website saves a lead when the model is unlocked, on Excel downloads and on report requests.
function mergeLeads(rows) {
  const by = new Map();
  for (const l of rows) { // newest first
    const k = `${String(l.email || '').toLowerCase()}|${leadHost(l.website || l.input?.website)}`;
    const g = by.get(k);
    if (!g) by.set(k, { ...l, ids: [l.id], visits: 1, stages: [l.summary?.stage].filter(Boolean), status: l.status || 'new' });
    else {
      g.ids.push(l.id); g.visits++; if (l.summary?.stage) g.stages.push(l.summary.stage);
      if ((g.status || 'new') === 'new' && l.status && l.status !== 'new') g.status = l.status; // keep a status set on an older row
      if (!g.input?.model && l.input?.model) g.input = l.input; // newest row without a model: use the latest one that has it
    }
  }
  return [...by.values()];
}
const leadNum = x => (x === '' || x == null || isNaN(+x) ? null : +x);
const leadHost = w => String(w || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const leadName = l => { const h = leadHost(l.website || l.input?.website); return h ? h.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : (l.name || 'Website lead'); };
const pitchOfLead = id => (state.pitches || []).find(p => p.lead?.id === id);
const leadPct = x => (x == null ? '–' : `${Math.round(x * 1000) / 10}%`);

function leadsHtml() {
  if (Store.mode !== 'cloud') return '';
  if (state.leads == null) { refreshLeads(); return '<div class="card leads-card"><h2>Website leads</h2><p class="muted small">Loading…</p></div>'; }
  const L = state.leads;
  return `<div class="card leads-card"><div class="toolbar" style="margin-bottom:6px"><h2 style="margin:0">Website leads <span class="muted small">(${L.length})</span></h2><span class="spacer"></span>
      <a class="small" href="https://testvaluationz.netlify.app" target="_blank" rel="noopener">Open the website ↗</a><button class="btn sm" data-leads-refresh>↻ Refresh</button></div>
    ${leadsError ? `<p class="err small">Could not load leads: ${esc(leadsError)}. Run the latest supabase/public-site.sql (team access to leads).</p>` : ''}
    ${L.length ? `<div class="table-wrap"><table class="data leads"><thead><tr><th>Received</th><th>Company</th><th>Contact</th><th class="num">Revenue</th><th class="num">EBITDA</th><th>Growth · recurring</th><th class="num">Indicative EV</th><th class="num">DCF</th><th>Model</th><th>Status</th><th></th></tr></thead><tbody>
      ${L.map(l => { const i = l.input || {}, s = l.summary || {}, m = i.model, pit = pitchOfLead(l.id);
        return `<tr class="${(l.status || 'new') === 'new' ? 'lead-new' : ''}"><td class="small">${esc(String(l.created_at).slice(0, 10))}</td>
          <td><b>${esc(leadName(l))}</b><div class="co-sub">${esc(leadHost(l.website || i.website))} · ${esc(s.niche || i.niche || '')}</div></td>
          <td><b>${esc(l.name || '')}</b>${l.visits > 1 ? ` <span class="chip" title="${esc(l.stages.join(', '))}">${l.visits}× on site</span>` : ''}<div class="co-sub"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></div></td>
          <td class="num">${leadNum(i.revenue) != null ? eur(leadNum(i.revenue)) : '–'}</td><td class="num">${leadNum(i.ebitda) != null ? eur(leadNum(i.ebitda)) : '–'}</td>
          <td class="small">${leadNum(i.growth) != null ? esc(i.growth) + '%' : '–'} · ${leadNum(i.recurring) != null ? esc(i.recurring) + '%' : '–'}</td>
          <td class="num">${s.valuation?.mid != null ? eur(s.valuation.mid) : '–'}</td><td class="num">${m?.dcf?.ev != null ? eur(m.dcf.ev) : '–'}</td>
          <td class="small">${m?.quality ? `${m.quality.score}/${m.quality.max}` : '–'}${m?.imported ? ' · <span class="chip">P&amp;L uploaded</span>' : ''}</td>
          <td><select data-lead-status="${esc(l.id)}">${LEAD_STATUSES.map(st => `<option ${st === (l.status || 'new') ? 'selected' : ''}>${st}</option>`).join('')}</select></td>
          <td><button class="btn sm ${pit ? '' : 'primary'}" data-lead-pitch="${esc(l.id)}">${pit ? 'Open pitch' : 'Create pitch'}</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted small">No leads yet. They appear here when a visitor asks for the full report on the valuation website.</p>'}</div>`;
}

function leadToPitch(l) {
  const ex = pitchOfLead(l.id);
  if (ex) { Object.assign(pv, { open: ex.id, tab: 'deals' }); return renderPitches(); }
  const i = l.input || {}, niche = l.summary?.niche || i.niche || '';
  const p = newPitch(leadName(l), leadHost(l.website || i.website));
  Object.assign(p.cs.target, { country: i.country || '', revenue: leadNum(i.revenue), ebitda: leadNum(i.ebitda), growth: leadNum(i.growth), sector: niche, tags: niche ? [niche] : [] });
  if (leadNum(i.recurring) != null && leadNum(i.revenue) != null) p.cs.target.arr = +(leadNum(i.revenue) * leadNum(i.recurring) / 100).toFixed(2);
  p.lead = { id: l.id, name: l.name, email: l.email, created: l.created_at, input: i, summary: l.summary };
  p.notes = `Website lead (${String(l.created_at).slice(0, 10)}): ${l.name || ''} <${l.email}>.`;
  state.pitches.push(p); savePitches();
  if ((l.status || 'new') === 'new') Promise.all((l.ids || [l.id]).map(id => Store.updateLead(id, { status: 'pitch' }))).then(() => { l.status = 'pitch'; refreshLeadCount(); }).catch(e => toast('Could not update the lead: ' + e.message));
  Object.assign(pv, { open: p.id, tab: 'deals' });
  toast(`Pitch created for ${pitchName(p)}.`);
  renderPitches();
}
function refreshLeadCount() { const n = (state.leads || []).filter(l => (l.status || 'new') === 'new').length; const b = $('#navLeadCount'); if (b) b.textContent = n ? String(n) : ''; }

// The visitor's own figures and model, shown at the top of the pitch.
function leadCardHtml(p) {
  const L = p.lead, i = L.input || {}, s = L.summary || {}, m = i.model;
  const hist = (m?.history || []).filter(h => leadNum(h.revenue) != null);
  const cell = x => (leadNum(x) != null ? eur(leadNum(x)) : '–');
  return `<div class="card lead-card"><div class="toolbar" style="margin-bottom:8px"><h2 style="margin:0">From the website</h2><span class="chip blue">lead ${esc(String(L.created).slice(0, 10))}</span><span class="spacer"></span>
      <span><b>${esc(L.name || '')}</b> · <a href="mailto:${esc(L.email)}">${esc(L.email)}</a>${i.lang ? ` · <span class="muted small">language ${esc(i.lang)}</span>` : ''}</span></div>
    <div class="lead-grid">
      <div><h3>What they entered</h3><table class="compact">
        ${[['Country', esc(i.country || '–')], ['Niche', esc(s.niche || i.niche || '–')], ['Revenue', cell(i.revenue)], ['EBITDA', cell(i.ebitda)], ['Growth', leadNum(i.growth) != null ? esc(i.growth) + '%' : '–'], ['Recurring revenue', leadNum(i.recurring) != null ? esc(i.recurring) + '%' : '–'], ['Potential buyers shown', s.buyers ?? '–']].map(([k, v]) => `<tr><td class="muted">${k}</td><td><b>${v}</b></td></tr>`).join('')}
      </table></div>
      <div><h3>What the website told them</h3><table class="compact">
        <tr><td class="muted">Multiples range</td><td><b>${s.valuation ? `${eur(s.valuation.low)} – ${eur(s.valuation.high)} (mid ${eur(s.valuation.mid)})` : '–'}</b></td></tr>
        ${m ? `<tr><td class="muted">DCF</td><td><b>${eur(m.dcf.ev)}</b> <span class="muted small">WACC ${leadPct(m.dcf.wacc)}, g ${leadPct(m.dcf.g)}, range ${eur(m.dcf.range?.[0])}–${eur(m.dcf.range?.[1])}</span></td></tr>
        <tr><td class="muted">PE buyer (LBO)</td><td>${m.lbo ? `<b>${m.lbo.atIrr.map(x => `${eur(x.ev)} @ ${Math.round(x.irr * 100)}%`).join(' · ')}</b> <span class="muted small">${esc(m.lbo.leverage)}× leverage, exit ${esc(m.lbo.exitMult)}×</span>` : '<span class="muted">n/a (no positive EBITDA)</span>'}</td></tr>
        <tr><td class="muted">Model detail</td><td><b>${m.quality?.score ?? '–'}/${m.quality?.max ?? 10}</b>${m.imported ? ` · uploaded <b>${esc(m.imported.file)}</b> (sheet ${esc(m.imported.sheet)}, ${esc(m.imported.unit)})` : ''}</td></tr>
        ${Object.entries(m.risks || {}).filter(([, v]) => v).length ? `<tr><td class="muted">Risks ticked</td><td>${Object.entries(m.risks).filter(([, v]) => v).map(([k]) => `<span class="chip amber">${esc(k)}</span>`).join(' ')}</td></tr>` : ''}` : '<tr><td colspan="2" class="muted small">The visitor did not open the DCF / LBO model.</td></tr>'}
      </table></div>
    </div>
    ${hist.length || m?.forecast ? `<h3>Their figures (EUR m)</h3><div class="table-wrap"><table class="compact"><thead><tr><th></th>${hist.map(h => `<th class="num">${esc(h.year)}A</th>`).join('')}${(m?.forecast || []).map(f => `<th class="num">${esc(f.year)}F</th>`).join('')}</tr></thead><tbody>
      <tr><td>Revenue</td>${hist.map(h => `<td class="num">${cell(h.revenue)}</td>`).join('')}${(m?.forecast || []).map(f => `<td class="num">${cell(f.revenue)}</td>`).join('')}</tr>
      <tr><td>EBITDA</td>${hist.map(h => `<td class="num">${cell(h.ebitda)}</td>`).join('')}${(m?.forecast || []).map(f => `<td class="num">${cell(f.ebitda)}</td>`).join('')}</tr>
      ${hist.some(h => leadNum(h.recurring) != null) ? `<tr><td>Recurring</td>${hist.map(h => `<td class="num">${cell(h.recurring)}</td>`).join('')}${(m?.forecast || []).map(() => '<td></td>').join('')}</tr>` : ''}
      <tr><td>Free cash flow</td>${hist.map(() => '<td></td>').join('')}${(m?.forecast || []).map(f => `<td class="num">${cell(f.fcf)}</td>`).join('')}</tr>
    </tbody></table></div>` : ''}</div>`;
}

// ---------- Page ----------
function renderPitches() {
  const el = $('#pitchView');
  if (!el) return;
  state.pitches ??= [];
  const p = pv.open && pitchById(pv.open);
  if (!p) { pv.open = null; return renderPitchList(el); }
  pitchFix(p);
  // First ranking of all companies takes a few seconds: show that it's working, then render.
  if (pv.tab !== 'deals' && pitchReady(p) && pbMatch.sig !== pitchProfileSig(p)) {
    el.innerHTML = `<div class="empty">Ranking ${state.companies.length.toLocaleString()} companies as possible buyers for ${esc(pitchName(p))}…</div>`;
    return setTimeout(() => { pitchCandidates(p, pitchSel(p)); renderPitches(); }, 30);
  }
  const sel = pv.tab === 'buyers' || pv.tab === 'deck' ? pitchSel(p) : null;
  el.innerHTML = `<div class="page-head"><div><button class="link small" data-px="list">← All pitches</button><h1 id="pitchTitle">${esc(pitchName(p))}</h1>
      <div class="muted">${esc([p.cs.target.website, csFacts(p.cs.target)].filter(Boolean).join(' · ') || 'Prospective client')}</div></div>
      <div class="actions"><select data-pf="status">${PITCH_STATUSES.map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn" data-px="xlsx">Excel</button><button class="btn primary" data-px="pdf">PDF deck</button>
        ${p.project ? `<button class="btn" data-px="openproj">Project ${esc(p.project)} →</button>` : '<button class="btn" data-px="convert" title="Create a project with this profile and buyer list">Start project</button>'}
        <button class="btn danger" data-px="delete">Delete</button></div></div>
    <div class="seg-tabs pitch-tabs">${[['deals', '1. Company & comparable deals'], ['buyers', '2. Possible buyers'], ['deck', '3. Deck & notes']].map(([k, l]) => `<button class="${pv.tab === k ? 'on' : ''}" data-ptab="${k}">${l}</button>`).join('')}</div>
    <div id="pitchBody">${pv.tab === 'deals' ? `${p.lead ? leadCardHtml(p) : ''}<div id="pitchDeals"></div>` : pv.tab === 'buyers' ? pitchBuyersHtml(p, sel) : pitchDeckHtml(p, sel)}</div>`;
  if (pv.tab === 'deals') {
    if (!state.transactions.length) $('#pitchDeals').innerHTML = '<div class="empty">No transactions in the database yet. Import them under Data &amp; sources.</div>';
    else { csUse(pitchCtx(p), p.cs); renderCompSet(); }
  }
}

function renderPitchList(el) {
  const list = [...state.pitches].sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  el.innerHTML = `<div class="page-head"><div><h1>Pitches</h1><div class="muted">Comparable deals and possible buyers for prospective clients, before the mandate starts</div></div>
      <div class="actions"><button class="btn primary" data-px="new">New pitch</button></div></div>
    ${leadsHtml()}
    ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Prospect</th><th>Status</th><th class="num">Comparable deals</th><th class="num">Strategic buyers</th><th class="num">Financial buyers</th><th>Updated</th><th>Project</th></tr></thead><tbody>
      ${list.map(p => `<tr class="tx-row" data-popen="${p.id}"><td><b>${esc(pitchName(pitchFix(p)))}</b><div class="co-sub">${esc(p.cs.target.website || '')}</div></td><td><span class="chip ${p.status === 'Won' ? 'green' : p.status === 'Lost' ? 'red' : p.status === 'Sent' ? 'blue' : ''}">${esc(p.status)}</span></td>
        <td class="num">${p.stats?.deals ?? '–'}</td><td class="num">${p.stats?.strategic ?? '–'}</td><td class="num">${p.stats?.financial ?? '–'}</td><td class="small">${esc(String(p.updated || p.created).slice(0, 10))}</td><td class="small">${esc(p.project || '')}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="card narrow"><h2>Make your first pitch</h2><p>For a company you're talking to (for example Process Science), build in a few minutes:</p>
      <ol class="small"><li><b>Company & comparable deals:</b> enter the website (Claude reads it) or a description and tags; the closest transactions are selected, and you add or remove deals.</li>
      <li><b>Possible buyers:</b> strategic and financial buyers from your CRM and the acquirers of those deals, with why they fit; add, remove, set tiers and edit the rationale.</li>
      <li><b>Deck & notes:</b> one PDF deck for the prospect, and Excel with the comparables and the buyer list in your project layout. When you win the mandate, <b>Start project</b> turns it into a project with the buyer list.</li></ol>
      <button class="btn primary" data-px="new">New pitch</button></div>`}`;
}

function pitchBuyersHtml(p, sel) {
  if (!pitchReady(p)) return '<div class="empty">First describe the company on tab 1 (website, description or tags).</div>';
  const B = pitchBuyers(p, sel), b = p.b;
  p.stats = { deals: sel?.used.length ?? 0, strategic: B.strategic.length, financial: B.financial.length };
  const inp = (k, w = 50) => `<input data-pbf="${k}" value="${esc(b[k] ?? '')}" style="width:${w}px">`;
  const table = (rows, title) => `<h2 style="margin:16px 0 6px">${title} <span class="muted small">(${rows.length})</span></h2>
    <div class="table-wrap"><table class="data pb-table"><thead><tr><th>In</th><th>Tier</th><th>Company</th><th>Country</th><th>Size</th><th class="num">Fit</th><th style="width:45%">Why they fit <span class="muted small">(edit; shown in the deck)</span></th></tr></thead><tbody>
      ${rows.map(e => `<tr><td><input type="checkbox" checked data-pb-inc="${esc(e.id)}"></td>
        <td><select data-pb-tier="${esc(e.id)}">${[1, 2, 3].map(t => `<option ${t === e.tier ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><b>${esc(e.name)}</b>${e.c ? ` <button class="chip blue" data-open="${e.c.id}">CRM</button>` : ' <span class="chip">not in CRM</span>'}${e.pinned ? ' <span class="chip">added</span>' : ''}<div class="co-sub">${esc(clip(e.c?.short_description || e.c?.description || '', 110) || '')}</div></td>
        <td class="small">${esc(e.country)}</td><td class="small">${esc(pbSize(e.c))}</td><td class="num"><span class="chip">${e.score}</span></td>
        <td><textarea rows="2" data-pb-why="${esc(e.id)}" class="pb-why ${e.edited ? 'edited' : ''}">${esc(e.why)}</textarea></td></tr>`).join('') || '<tr><td colspan="7" class="muted">None selected. Raise the number or lower the minimum fit above.</td></tr>'}
    </tbody></table></div>`;
  const mini = (rows, attr, label) => rows.length ? `<div class="table-wrap"><table class="data"><tbody>${rows.map(e => `<tr class="muted"><td><button class="btn sm" ${attr}="${esc(e.id)}">${label}</button></td><td><b>${esc(e.name)}</b> <span class="chip">${e.type}</span></td><td class="small">${esc(e.country)}</td><td class="num"><span class="chip">${e.score}</span></td><td class="small">${esc(pbAutoWhy(e))}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="card"><div class="cs-filters">
      <label class="row-label small">Strategic ${inp('nS')}</label><label class="row-label small">Financial ${inp('nF')}</label><label class="row-label small">Minimum fit ${inp('min')}</label>
      <label class="row-label small">Buyer region <select data-pbf="region"><option value="">All</option>${csRegions().map(r => `<option ${r === b.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-pbf="acq" ${b.acq ? 'checked' : ''}> Only buyers with acquisitions</label>
      <span class="spacer"></span><div class="pb-search"><input id="pbSearch" placeholder="Add any company from the CRM…" autocomplete="off"><div id="pbSuggest"></div></div></div>
    <p class="muted small">Ranked by the match engine (sector, keywords, size, geography, acquisition history) on ${state.companies.length.toLocaleString()} companies${sel?.used.length ? `; acquirers of the ${sel.used.length} comparable deals get a bonus and are added even when they aren't in the CRM yet` : ''}. Untick to remove, set the tier, and edit the rationale: edits are kept.</p></div>
    ${table(B.strategic, 'Strategic buyers')}${table(B.financial, 'Financial buyers')}
    ${B.next.length ? `<h2 style="margin:18px 0 6px">Next best candidates</h2>${mini(B.next, 'data-pb-pin', '+ add')}` : ''}
    ${B.excluded.length ? `<h2 style="margin:18px 0 6px">Removed</h2>${mini(B.excluded, 'data-pb-restore', 'restore')}` : ''}`;
}

function pitchDeckHtml(p, sel) {
  const B = pitchReady(p) ? pitchBuyers(p, sel) : null;
  return `<div class="cs-grid"><div class="card"><h2>Our view <span class="muted small">(on the company slide)</span></h2>
      <textarea data-pf="notes" rows="7" style="width:100%" placeholder="e.g. Strong buyer interest in process mining: 14 deals since 2023, mostly by BPM and automation vendors. We see three buyer groups…">${esc(p.notes || '')}</textarea>
      <h2 style="margin-top:14px">Slides in the PDF</h2><div class="cs-filters">${PITCH_DECK.map(([k, l]) => `<label class="check"><input type="checkbox" data-pdeck="${k}" ${p.deck[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="muted small">A valuation range appears only when you enter revenue, ARR or EBITDA on tab 1; otherwise the deck shows the multiples of the comparable deals. Contact details are never in the PDF, only in the Excel.</p>
      <div class="toolbar"><button class="btn primary" data-px="pdf">Open PDF deck</button><button class="btn" data-px="xlsx">Download Excel</button></div></div>
    <div class="card"><h2>What goes in</h2><ul class="small">
      <li><b>${sel?.used.length ?? 0}</b> comparable deals${sel ? ` · median EV/Revenue ${mult(sel.rev.median)}` : ''}${sel?.blend ? ` · indicative EV ${eur(sel.blend[0])}–${eur(sel.blend[2])}` : ''}</li>
      <li><b>${B?.strategic.length ?? 0}</b> strategic and <b>${B?.financial.length ?? 0}</b> financial buyers (${B ? B.used.filter(e => e.tier === 1).length : 0} tier 1)</li>
      <li>Excel sheets: Summary, Comparables, Buyer list - Strategics, Buyer list - Financial (your project columns: Company, Website, Tier, Category, Employees, Revenue, EBITDA, Ownership, Country, Description, Remarks, contacts, Status…), Excluded, Next candidates, By year.</li></ul></div></div>`;
}

// ---------- Exports ----------
function pitchSlides(p) {
  const sel = pitchSel(p), B = pitchReady(p) ? pitchBuyers(p, sel) : null, T = p.cs.target, d = p.deck, name = pitchName(p);
  const slides = [];
  if (d.cover) slides.push(csCover(name, 'Market view: comparable transactions and potential buyers', [csFacts(T), `Prepared by 33 Equity · ${today()}`]));
  if (d.company) {
    const kp = [['Comparable deals', sel?.used.length ?? '–'], ['Median EV/Revenue', sel ? mult(sel.rev.median) : '–'], ['Strategic buyers', B?.strategic.length ?? '–'], ['Financial buyers', B?.financial.length ?? '–']];
    slides.push(csSlide(name, `<div class="row"><div class="col">${T.description ? `<p class="lead-text">${esc(T.description)}</p>` : ''}
        ${T.customers ? `<p><b>Customers:</b> ${esc(T.customers)}</p>` : ''}${T.tags.length ? `<p class="muted">${T.tags.map(esc).join(' · ')}</p>` : ''}
        ${[T.revenue, T.arr, T.ebitda].some(v => v != null) ? `<p><b>Financials:</b> ${[T.revenue != null && `revenue ${eur(T.revenue)}`, T.arr != null && `ARR ${eur(T.arr)}`, T.ebitda != null && `EBITDA ${eur(T.ebitda)}`, T.growth != null && `growth ${T.growth}%`].filter(Boolean).join(' · ')}</p>` : ''}
        ${sel?.used.length ? `<h3>Recent deals in this space</h3><table class="tx">${[...sel.used].sort((a, b) => String(b.t.date || '').localeCompare(String(a.t.date || ''))).slice(0, 6).map(x => `<tr><td>${esc(String(x.t.date || x.t.year || '').slice(0, 7))}</td><td><b>${esc(x.t.target)}</b> <span class="muted">→ ${esc(splitBuyers(x.t.buyer)[0] || '–')}</span></td></tr>`).join('')}</table>` : ''}</div>
      <div class="col"><div class="kp" style="grid-template-columns:repeat(2,1fr)">${kp.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        ${p.notes ? `<div class="box"><h3>Our view</h3><div class="lead-text">${esc(p.notes).replace(/\n/g, '<br>')}</div></div>` : ''}</div></div>`, esc([T.website, csFacts(T)].filter(Boolean).join(' · '))));
  }
  if (sel) slides.push(...csSlideList(sel, { title: false, summary: d.summary, charts: d.charts, time: d.time, table: d.table, method: false }));
  if (B && d.buyers) {
    const all = [...B.strategic, ...B.financial];
    const deals = e => [...new Set([...e.bought, ...(e.hits || [])])];
    const active = all.filter(e => deals(e).length).sort((a, b) => deals(b).length - deals(a).length || b.score - a.score).slice(0, 8);
    slides.push(csSlide('Buyer universe', `<div class="row"><div class="col">
        <div class="kp">${[['Strategic', B.strategic.length], ['Financial', B.financial.length], ['Tier 1', all.filter(e => e.tier === 1).length], ['Bought in this space', all.filter(e => deals(e).length).length]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
        <h3>Buyers by country</h3>${csBars(csCount(all.map(e => e.country || 'Other')).slice(0, 8), { w: 500, color: CC.green })}</div>
      <div class="col"><h3>Most active acquirers in this space</h3>${active.length ? `<table class="tx">${active.map(e => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(deals(e).slice(0, 3).join(', '))}</td></tr>`).join('')}</table>` : '<p class="muted">–</p>'}
        <h3>Buyer focus</h3>${csBars(csCount(all.map(e => e.c?.subsector || e.c?.sector || (e.type === 'Financial' ? 'Private equity' : 'Other'))).slice(0, 7), { w: 500, color: CC.grey })}</div></div>`,
      `${all.length} potential buyers identified from 33 Equity's database of ${state.companies.length.toLocaleString()} companies and ${state.transactions.length.toLocaleString()} transactions`));
  }
  const buyerSlides = (rows, title) => {
    const per = 12;
    for (let i = 0; i < rows.length; i += per) slides.push(csSlide(`${title}${rows.length > per ? ` (${i / per + 1}/${Math.ceil(rows.length / per)})` : ''}`, `<table class="tx"><tr><th>Tier</th><th>Company</th><th>Country</th><th>Size</th><th>Why they fit</th></tr>
      ${rows.slice(i, i + per).map(e => `<tr><td><span class="tier t${e.tier}">${e.tier}</span></td><td><b>${esc(e.name)}</b><div class="muted">${esc(clip(e.c?.short_description || '', 80) || '')}</div></td><td>${esc(e.country)}</td><td class="n">${esc(pbSize(e.c))}</td><td>${esc(e.why)}</td></tr>`).join('')}</table>`));
  };
  if (B && d.strategic) buyerSlides(B.strategic, 'Strategic buyers');
  if (B && d.financial) buyerSlides(B.financial, 'Financial buyers');
  if (d.method) slides.push(csSlide('Methodology', `<div class="row"><div class="col"><h3>Comparable transactions</h3><ul>
      <li>${sel ? `${sel.m.pool.toLocaleString()} transactions passed the filters; the ${sel.used.length} most similar are shown` : 'No transactions selected'}.</li>
      <li>Similarity: business description and tags (40%), industry (15%), size (20%), recency (15%), geography (10%).</li>
      <li>Sources: S&P Capital IQ and other transaction databases; deal amounts in USD. Some multiples are derived from deal announcements and are approximate.</li></ul></div>
    <div class="col"><h3>Potential buyers</h3><ul><li>Ranked on sector and keyword fit, size, geography and acquisition history, using 33 Equity's buyer database.</li>
      <li>Acquirers of the comparable transactions are included; tiers and rationale reflect our assessment.</li></ul>
      <p class="muted">Indicative only, based on public information; buyer interest is not confirmed until approached.</p></div></div>`));
  return slides;
}

const PB_STRAT_COLS = ['Company', 'Website', 'Tier', 'Category', 'Employees', 'Revenue', 'EBITDA', 'Ownership', 'Country', 'Description', 'Remarks', 'Responsible', 'Contact Name', 'Function', 'E-mail', 'Contact Name 2', 'Function 2', 'E-mail 2', 'Date of last contact', 'Status', 'Log', 'Fit score', 'Relevant acquisitions'];
const PB_FIN_COLS = ['Investor', 'Website', 'Tier', 'General comment', 'Portfolio', 'Contact office', 'Responsible', 'Contact', 'Function', 'E-mail', 'Contact 2', 'Function 2', 'E-mail 2', 'Date of last contact', 'Status', 'Teaser', 'NDA sent', 'IM', 'Log', 'Fit score'];
// Best two contacts: people with an e-mail first.
const pbContacts = c => [...(c?.contacts || [])].sort((a, b) => !!b.email - !!a.email).slice(0, 2);
function pbSheet(rows, cols, title, rowOf) {
  const aoa = [[title], ['In EUR k'], cols, ...rows.map(rowOf)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(h => ({ wch: /Description|Remarks|comment|Portfolio|acquisitions/.test(h) ? 55 : /Company|Investor|Website|E-mail|Contact/.test(h) ? 26 : 12 }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: rows.length + 2, c: cols.length - 1 } }) };
  return ws;
}
function pitchExcel(p) {
  const sel = pitchSel(p), B = pitchReady(p) ? pitchBuyers(p, sel) : { strategic: [], financial: [] }, name = pitchName(p);
  const wb = sel ? csWorkbook(sel) : XLSX.utils.book_new();
  const k = v => (v == null || v === '' ? '' : Math.round(Number(v) * 1000));
  const acqs = e => [...e.bought, ...(e.c?.acquisitions || []).slice(0, 5).map(a => `${a.target}${a.date || a.year ? ` (${String(a.date || a.year).slice(0, 4)})` : ''}`)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 8).join('; ');
  XLSX.utils.book_append_sheet(wb, pbSheet(B.strategic, PB_STRAT_COLS, `${name} – Buyer list - Strategics (pitch ${today()})`, e => { const c = e.c || {}, [p1, p2] = pbContacts(e.c);
    return [e.name, c.website || '', e.tier, c.subsector || c.sector || '', c.employees ?? '', k(c.revenue), k(c.ebitda), c.ownership || '', e.country, c.short_description || clip(c.description || '', 300) || '', e.why, '',
      p1?.name || '', p1?.title || '', p1?.email || '', p2?.name || '', p2?.title || '', p2?.email || '', '', '', '', e.score, acqs(e)]; }), 'Buyer list - Strategics');
  XLSX.utils.book_append_sheet(wb, pbSheet(B.financial, PB_FIN_COLS, `${name} – Buyer list - Financial (pitch ${today()})`, e => { const c = e.c || {}, [p1, p2] = pbContacts(e.c);
    return [e.name, c.website || '', e.tier, e.why, acqs(e), [c.hq_city, c.country].filter(Boolean).join(', '), '', p1?.name || '', p1?.title || '', p1?.email || '', p2?.name || '', p2?.title || '', p2?.email || '', '', '', '', '', '', '', e.score]; }), 'Buyer list - Financial');
  const order = ['Summary', 'Comparables', 'Buyer list - Strategics', 'Buyer list - Financial'];
  wb.SheetNames = [...order.filter(n => wb.SheetNames.includes(n)), ...wb.SheetNames.filter(n => !order.includes(n))];
  XLSX.writeFile(wb, `pitch-${name.replace(/[^\w-]+/g, '-').toLowerCase()}-${today()}.xlsx`);
}

// A won pitch becomes a project: deal profile from the company, buyers on the project list (new companies for acquirers not in the CRM yet).
function pitchToProject(p) {
  const T = p.cs.target, sel = pitchSel(p), B = pitchReady(p) ? pitchBuyers(p, sel) : { used: [] };
  const name = prompt(`Project name for ${pitchName(p)}?\n\nThe ${B.used.length} buyers are added to the project as "Not yet approached".`, '');
  if (!name?.trim()) return;
  const proj = ensureProject(name.trim(), { client: pitchName(p) });
  proj.target = { ...(proj.target || {}), codename: proj.target?.codename || name.trim(), website: T.website, sector: T.sector, subsector: T.subsector, country: T.country,
    revenue: T.revenue ?? undefined, ebitda: T.ebitda ?? undefined, employees: T.employees ?? undefined, description: T.description, keywords: T.tags.join('; ') };
  let added = 0, created = 0;
  for (const e of B.used) {
    let c = e.c;
    if (!c) { c = migrate({ id: uid(), name: e.name, role: e.type === 'Financial' ? 'Investor' : 'Buyer', role_auto: true, created: new Date().toISOString(), sources: [`Pitch ${pitchName(p)}`], contacts: [], projects: [] }); state.companies.push(c); created++; }
    if (c.projects.some(x => x.project === proj.name)) continue;
    c.projects.push({ project: proj.name, status: 'Not yet approached', tier: String(e.tier), source: `Pitch ${pitchName(p)} (${today()})`, remarks: e.why });
    touch(c); added++;
  }
  Object.assign(p, { project: proj.name, status: 'Won' });
  savePitches(); saveProjects();
  toast(`Project ${proj.name} created: ${added} buyers added${created ? ` (${created} new companies)` : ''}.`, 6000);
  renderPitches();
}

// ---------- Events ----------
document.addEventListener('click', e => {
  if (!e.target.closest('#pitchView')) return;
  const a = s => e.target.closest(`[${s}]`)?.getAttribute(s);
  const p = pv.open && pitchById(pv.open);
  const x = a('data-px');
  if (x === 'new') {
    const name = prompt('Prospect name (e.g. Process Science)?');
    if (!name?.trim()) return;
    const site = prompt('Website (optional, e.g. process-science.com)?') || '';
    const np = newPitch(name.trim(), site.trim());
    state.pitches.push(np); savePitches();
    Object.assign(pv, { open: np.id, tab: 'deals' });
    return renderPitches();
  }
  if (x === 'list') { pv.open = null; return renderPitches(); }
  if (e.target.closest('[data-leads-refresh]')) { state.leads = null; return renderPitches(); }
  const lp = a('data-lead-pitch');
  if (lp) { const l = (state.leads || []).find(z => String(z.id) === lp); if (l) leadToPitch(l); return; }
  if (a('data-popen')) { Object.assign(pv, { open: a('data-popen'), tab: 'deals' }); return renderPitches(); }
  if (!p) return;
  if (a('data-ptab')) { pv.tab = a('data-ptab'); return renderPitches(); }
  if (x === 'pdf') return csOpenDeck(pitchSlides(p), pitchName(p), 'market view');
  if (x === 'xlsx') return pitchExcel(p);
  if (x === 'convert') return pitchToProject(p);
  if (x === 'openproj') { state.projectView = p.project; showTab('projects'); return renderProjects(); }
  if (x === 'delete') { if (confirm(`Delete the pitch for ${pitchName(p)}?`)) { state.pitches = state.pitches.filter(q => q.id !== p.id); savePitches(); pv.open = null; renderPitches(); } return; }
  const b = p.b, redraw = () => { p.updated = new Date().toISOString(); savePitches(); renderPitches(); };
  if (a('data-pb-pin')) { const id = a('data-pb-pin'); b.pin = [...new Set([...b.pin, id])]; b.exc = b.exc.filter(i => i !== id); return redraw(); }
  if (a('data-pb-restore')) { const id = a('data-pb-restore'); b.exc = b.exc.filter(i => i !== id); return redraw(); }
});
// Lead status (new / contacted / pitch / closed) is saved straight to the team database.
document.addEventListener('change', e => {
  const id = e.target.dataset?.leadStatus;
  if (!id) return;
  const l = (state.leads || []).find(z => String(z.id) === id), status = e.target.value;
  Promise.all((l?.ids || [id]).map(x => Store.updateLead(x, { status }))).then(() => { if (l) l.status = status; refreshLeadCount(); toast('Lead status saved.'); }).catch(err => toast('Could not save the lead status: ' + err.message));
});
document.addEventListener('change', e => {
  if (!e.target.closest('#pitchView') || e.target.closest('#pitchDeals')) return;
  const p = pv.open && pitchById(pv.open);
  if (!p) return;
  const el = e.target, d = el.dataset, b = p.b;
  const save = (rerender = true) => { p.updated = new Date().toISOString(); savePitches(); if (rerender) renderPitches(); };
  if (d.pf) { p[d.pf] = el.value; return save(d.pf === 'status'); }
  if (d.pdeck) { p.deck[d.pdeck] = el.checked; return save(false); }
  if (d.pbf) { b[d.pbf] = el.type === 'checkbox' ? el.checked : /^(nS|nF|min)$/.test(d.pbf) ? Number(el.value) || 0 : el.value; return save(); }
  if (d.pbInc) { const id = d.pbInc; b.exc = [...new Set([...b.exc, id])]; b.pin = b.pin.filter(i => i !== id); return save(); }
  if (d.pbTier) { b.edits[d.pbTier] = { ...b.edits[d.pbTier], tier: Number(el.value) }; return save(); }
  if (d.pbWhy) { b.edits[d.pbWhy] = { ...b.edits[d.pbWhy], why: el.value }; el.classList.add('edited'); return save(false); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'pbSearch') return;
  const q = Engine.normName(e.target.value), box = $('#pbSuggest');
  if (!q || q.length < 2) { box.innerHTML = ''; return; }
  const hits = state.companies.filter(c => c.role !== 'Target' && Engine.normName(c.name).includes(q)).slice(0, 8);
  box.innerHTML = hits.map(c => `<button class="pb-hit" data-pb-pin="${c.id}"><b>${esc(c.name)}</b> <span class="muted small">${esc([c.role === 'Investor' ? 'Financial' : 'Strategic', c.country].filter(Boolean).join(' · '))}</span></button>`).join('') || '<div class="muted small">No match</div>';
});
