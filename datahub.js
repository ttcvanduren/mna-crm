/* global state, $, esc, Engine, Store, Enricher, ago, showTab, sourceCounts, importTransactionFiles, touch, flush, toast */
// Data & sources: one page for everything that comes into the CRM (lists, transactions, research, connectors),
// where each record came from, and backups. Import buttons elsewhere relay to the inputs on this page.

// What kind of source a company's source label is.
function sourceKind(s) {
  if (/s&p|capital iq|transactions/i.test(s)) return 'Transactions';
  if (/^pitch /i.test(s)) return 'Pitch';
  if (/claude|research|apollo/i.test(s)) return 'Research';
  if (/added in crm|manual/i.test(s)) return 'Added by hand';
  return 'Company list';
}
// "20261026 - Project Lakeside - Buyers list - v5.xlsx › Buyer list - Strategics" -> file + sheet.
const sourceFile = s => String(s).split(' › ')[0].trim();

function renderData() {
  if (!$('#tab-data')?.classList.contains('active')) return;
  const cs = state.companies, n = cs.length;
  const pct = x => (n ? `${Math.round((x / n) * 100)}%` : '–');
  const strategic = cs.filter(c => c.role !== 'Investor').length, financial = n - strategic;
  const researched = cs.filter(c => c.enrichment), withNiche = cs.filter(c => c.niche).length;
  const withEmail = cs.filter(c => Engine.hasEmail(c)).length, withDeals = cs.filter(c => (c.acquisitions || []).length).length;
  const tx = state.transactions || [], txSources = typeof sourceCounts === 'function' ? sourceCounts() : [];
  const kpi = (k, v, sub = '') => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="muted small">${sub}</div></div>`;
  $('#dataOverview').innerHTML = `<div class="kpis">
      ${kpi('Companies', n.toLocaleString(), `${strategic.toLocaleString()} strategic · ${financial.toLocaleString()} financial`)}
      ${kpi('Researched by Claude', researched.length.toLocaleString(), `${pct(researched.length)} of companies`)}
      ${kpi('Industry / niche', withNiche.toLocaleString(), `${pct(withNiche)} classified`)}
      ${kpi('With deal history', withDeals.toLocaleString(), `${withEmail.toLocaleString()} with an email contact`)}
      ${kpi('Transactions', tx.length.toLocaleString(), `${txSources.length} source file${txSources.length === 1 ? '' : 's'}`)}
      ${kpi('Stored in', `<span style="font-size:17px">${Store.mode === 'cloud' ? 'Team database' : 'This browser'}</span>`, `${(state.projects || []).length} projects · ${(state.pitches || []).length} pitches`)}
    </div>`;

  const last = researched.map(c => c.enrichment.at).filter(Boolean).sort().pop();
  $('#dataResearch').innerHTML = researched.length ? `${researched.length.toLocaleString()} companies researched · last import ${last ? ago(last) : '–'} · ${cs.filter(c => !c.enrichment && (c.projects || []).length).length.toLocaleString()} companies in projects not researched yet` : 'No research imported yet.';

  // Company sources, grouped by file; transaction sources from the transaction records.
  const bySrc = new Map();
  for (const c of cs) for (const s of new Set((c.sources || []).map(sourceFile))) bySrc.set(s, (bySrc.get(s) || 0) + 1);
  const rows = [...bySrc].map(([s, k]) => ({ s, kind: sourceKind(s), k })).sort((a, b) => a.kind.localeCompare(b.kind) || b.k - a.k);
  // Research updates existing companies rather than adding a source label, so it gets its own row.
  if (researched.length) rows.push({ s: 'Claude research (profiles, people, deals, niche)', kind: 'Research', k: researched.length });
  const kinds = ['Company list', 'Transactions', 'Research', 'Pitch', 'Added by hand'];
  const none = cs.filter(c => !(c.sources || []).length).length;
  $('#dataSources').innerHTML = `<div class="src-grid">
      <div><h3 class="small muted">Companies by source</h3>
        <table class="compact"><thead><tr><th>Source</th><th>Type</th><th class="num">Companies</th></tr></thead><tbody>
        ${kinds.flatMap(kd => rows.filter(r => r.kind === kd).map(r => `<tr><td>${esc(r.s)}</td><td><span class="chip ${kd === 'Company list' ? 'blue' : kd === 'Transactions' ? 'purple' : kd === 'Research' ? 'green' : ''}">${kd}</span></td><td class="num">${r.k.toLocaleString()}</td></tr>`)).join('')}
        ${none ? `<tr class="muted"><td>No source recorded</td><td></td><td class="num">${none.toLocaleString()}</td></tr>` : ''}
        </tbody></table><p class="muted small">A company found in several files is counted once per file; duplicates across files are merged into one company.</p></div>
      <div><h3 class="small muted">Transactions by source file</h3>
        ${txSources.length ? `<table class="compact"><thead><tr><th>File</th><th class="num">Deals</th><th></th></tr></thead><tbody>
          ${txSources.map(([s, k]) => `<tr><td>${esc(s)}</td><td class="num">${k.toLocaleString()}</td><td><button class="link small" data-csrc-del="${esc(s)}">remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No transactions imported yet.</p>'}
        <p class="muted small">Removing a file deletes only the deals that came from that file alone.</p></div>
    </div>`;
}

// Import buttons on other pages pass their files to the one real input here, so every import runs the same way.
document.addEventListener('change', e => {
  const id = e.target.dataset?.relay;
  if (!id || !e.target.files?.length) return;
  const target = document.getElementById(id), dt = new DataTransfer();
  [...e.target.files].forEach(f => dt.items.add(f));
  e.target.value = '';
  target.files = dt.files;
  target.dispatchEvent(new Event('change', { bubbles: true }));
});
document.addEventListener('change', e => {
  if (e.target.id !== 'txUploadData') return;
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) importTransactionFiles(files).then(() => renderData());
});
// Fill in from own data: facts in the Capital IQ descriptions and owners from the deal history (no web, no cost).
document.addEventListener('click', async e => {
  if (e.target.id !== 'fillOwnData') return;
  const btn = e.target;
  btn.disabled = true;
  try {
    const changed = new Set();
    for (const c of state.companies) if (Enricher.derive(c)) changed.add(c);
    const own = Enricher.ownersFromDeals(state.companies, state.transactions || []);
    own.changed.forEach(c => changed.add(c));
    if (changed.size) { touch(...changed); await flush(); }
    toast(`Filled in ${changed.size.toLocaleString()} companies from your own data: ${own.sponsors.toLocaleString()} PE owners and ${own.parents.toLocaleString()} parents from the deal history.`, 8000);
    renderData();
  } catch (err) { toast('Could not fill in: ' + err.message, 7000); } finally { btn.disabled = false; }
});

// Links like "Import & sources →" go to another page.
document.addEventListener('click', e => {
  const to = e.target.closest('[data-goto]')?.dataset.goto;
  if (to) showTab(to);
});
