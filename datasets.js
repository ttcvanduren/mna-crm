/* global state, Engine, Taxonomy, RevEst, XLSX, MASTER_COLS, TX_LABELS, employeesOf */
// Datasets: the whole database as one Excel workbook that is usable without the CRM — companies with classification,
// buyer / target scores and revenue estimates, a target list, a buyer list, people, the buyers' deal histories and the
// transaction database. Data & sources → "Download datasets", and the offline round pipeline (.claude/round.js) writes
// the same workbook to datasets/ after every research round.
const Datasets = (() => {
  const r2 = v => (v == null || v === '' || isNaN(v) ? '' : Math.round(v * 100) / 100);
  const pct = v => (v == null ? '' : Math.round(v * 100));
  const day = s => String(s || '').slice(0, 10);

  function companyRow(c) {
    const p = Taxonomy.pathOfCompany(c) || {}, s = c.role === 'Investor' ? null : Engine.sideOf(c), e = c.revenue > 0 ? null : RevEst.cached(c);
    const ap = Engine.acquisitionProfile(c), bb = c.buy_box || {};
    return {
      ID: c.id, Company: c.name, Type: c.role === 'Buyer' ? 'Strategic' : c.role === 'Investor' ? 'Financial' : c.role || '',
      'Buyer / target': c.role === 'Investor' ? 'Investor' : s.label, 'Buyer score': s ? pct(s.buyer) : 100, 'Target score': s ? pct(s.target) : 0,
      Website: c.website || '', LinkedIn: c.linkedin_url || '', Country: c.country || '', City: c.hq_city || '', Founded: c.founded || '',
      Ownership: c.ownership || '', 'PE / VC owner': c.sponsor_name || '', 'Owner since': c.sponsor_since || '', Parent: c.parent_name || '', 'Investor type': c.investor_type || '',
      Industry: p.industry || '', Sector: p.sector || '', 'Sub-sector': p.subsector || '', Niche: c.niche || '', 'Source label': c.sector || '',
      Employees: employeesOf(c) ?? '', 'Revenue (stated, m)': c.revenue ?? '', Currency: c.revenue != null ? c.currency || 'EUR' : '', 'EBITDA (m)': c.ebitda ?? '', 'Financials year': c.financials_year || '',
      'Revenue estimate (EUR m)': r2(e?.mid), 'Estimate P25': r2(e?.p25), 'Estimate P75': r2(e?.p75), 'Estimate grade': e?.grade || '',
      'Indicative EV (EUR m)': r2(e?.ev), 'EV low': r2(e?.ev_low), 'EV high': r2(e?.ev_high),
      'Deals on record': ap.n, 'Deals last 36m': ap.last36, 'Last deal year': ap.last || '', 'Top niches bought': ap.niches.slice(0, 3).map(x => x[0]).join('; '),
      'Acquisition focus': c.acquisition_focus || '', 'Target sectors': c.target_sectors || '', 'Target countries': c.target_countries || '',
      'Buy box EV min': bb.ev_min ?? '', 'Buy box EV max': bb.ev_max ?? '', 'Fund AUM (m)': c.fund?.aum ?? '',
      Contacts: c.contacts.length, 'With email': c.contacts.filter(x => x.email).length, Mandates: (c.projects || []).map(x => [x.project, x.status].filter(Boolean).join(': ')).join(' | '),
      'Research level': c.research?.level ?? (c.enrichment ? 2 : ''), 'Researched on': day(c.research?.at || c.enrichment?.at),
      'Short description': c.short_description || '', Description: String(c.summary || c.description || '').slice(0, 400), Sources: (c.sources || []).join('; ').slice(0, 300),
    };
  }

  function sheets() {
    const cs = state.companies;
    const rows = cs.map(c => ({ c, r: companyRow(c) }));
    const targets = rows.filter(x => x.c.role === 'Target' || x.r['Buyer / target'] === 'Likely target')
      .sort((a, b) => b.r['Target score'] - a.r['Target score'] || (+b.r['Revenue estimate (EUR m)'] || +b.r['Revenue (stated, m)'] || 0) - (+a.r['Revenue estimate (EUR m)'] || +a.r['Revenue (stated, m)'] || 0));
    const buyers = rows.filter(x => x.c.role === 'Investor' || x.r['Buyer score'] >= 60)
      .sort((a, b) => b.r['Deals last 36m'] - a.r['Deals last 36m'] || b.r['Deals on record'] - a.r['Deals on record']);
    const people = cs.flatMap(c => c.contacts.map(x => ({ 'Company ID': c.id, Company: c.name, Type: c.role || '', Country: c.country || '', Name: x.name || '', Title: x.title || '', Role: x.role_tag || '', Email: x.email || '', 'Email status': x.email_status || '', LinkedIn: x.linkedin || '', Phone: x.phone || '', Source: x.source === 'Claude' ? 'Claude research' : x.source || 'your lists', 'Source URL': x.source_url || '' })));
    const deals = cs.flatMap(c => (c.acquisitions || []).map(a => ({ 'Buyer ID': c.id, Buyer: c.name, 'Buyer type': c.role || '', Target: a.target || '', Date: a.date || a.year || '', Niche: Taxonomy.ofDeal(a)?.niche || '', Industry: a.industry || '', Country: a.country || '', 'Deal value': a.deal_value || '', 'Target revenue': a.target_revenue || '', 'Target EBITDA': a.target_ebitda || '', 'Target employees': a.target_employees || '', Stake: a.stake || '', Via: a.via || '', Description: String(a.description || '').slice(0, 200), Source: a.source || '', 'Source URL': a.source_url || '' })));
    // Long texts are clipped so the workbook stays a size Excel opens quickly (the full texts are in the master file).
    const TX_COLS = MASTER_COLS.filter(k => !['summary', 'buyer_description'].includes(k));
    const tx = [...state.transactions].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map(t => Object.fromEntries(TX_COLS.map(k => [TX_LABELS[k] || k, Array.isArray(t[k]) ? t[k].join(', ') : k === 'description' ? String(t[k] || '').slice(0, 300) : t[k] ?? ''])));
    const B = RevEst.benchmarks(), bench = [...B.rpe].filter(([k]) => !k.includes('|') || /^(I|S|U):/.test(k)).map(([k, s]) => ({ Level: { I: 'Industry', S: 'Sector', U: 'Sub-sector', n: 'Niche', band: 'Size band', all: 'All' }[k.split(':')[0]] || k, Group: k.includes(':') ? k.slice(k.indexOf(':') + 1) : 'all deals', Deals: s.n, 'Median rev / employee (EUR k)': Math.round(s.median), P25: Math.round(s.p25), P75: Math.round(s.p75) })).sort((a, b) => b.Deals - a.Deals);
    const count = l => l.length.toLocaleString('en-US');
    const readme = [
      ['M&A CRM datasets', ''], ['Built', new Date().toISOString().slice(0, 16).replace('T', ' ')],
      ['Companies', `${count(cs)} (strategic ${count(cs.filter(c => c.role === 'Buyer'))}, financial ${count(cs.filter(c => c.role === 'Investor'))}, targets ${count(cs.filter(c => c.role === 'Target'))})`],
      ['Targets sheet', `${count(targets)} companies typed Target or scoring as likely target, best first`], ['Buyers sheet', `${count(buyers)} investors and companies with buyer score 60+, most active first`],
      ['People', count(people)], ['Buyer deals', `${count(deals)} acquisitions in the companies' deal histories`], ['Transactions', `${count(tx)} deals (S&P, Mergermarket, research)`],
      ['', ''], ['Buyer / target scores', '0-100. Buyer: deals on record, stated appetite, size, PE-backed / listed. Target: revenue in the EUR 2-75m sweet spot, founder / long-held PE ownership, few deals.'],
      ['Revenue estimate', 'Only for companies without stated revenue: headcount x revenue per employee of comparable deals, CRM companies and public benchmarks, adjusted for observed signals (revenue.js). P25-P75 range; grade A (stated) to E (very rough).'],
      ['Indicative EV', 'EV/Revenue and EV per employee of comparable deals and an EBITDA route, with a size discount below EUR 25m revenue.'],
      ['Amounts', 'Companies in EUR m unless Currency says otherwise; transactions in USD m.'], ['Confidential', 'Internal use only: contains S&P Capital IQ / Mergermarket derived data and personal data of contacts.'],
    ];
    return [
      ['README', XLSX.utils.aoa_to_sheet(readme)],
      ['Companies', XLSX.utils.json_to_sheet(rows.map(x => x.r))],
      ['Targets', XLSX.utils.json_to_sheet(targets.map(x => x.r))],
      ['Buyers', XLSX.utils.json_to_sheet(buyers.map(x => x.r))],
      ['People', XLSX.utils.json_to_sheet(people)],
      ['Buyer deals', XLSX.utils.json_to_sheet(deals)],
      ['Transactions', XLSX.utils.json_to_sheet(tx)],
      ['Rev per employee', XLSX.utils.json_to_sheet(bench)],
    ];
  }

  function workbook() {
    const wb = XLSX.utils.book_new();
    for (const [name, ws] of sheets()) {
      if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return wb;
  }
  const fileName = () => `mna-crm-datasets-${new Date().toISOString().slice(0, 10)}.xlsx`;
  function download() { XLSX.writeFile(workbook(), fileName(), { compression: true }); }
  // For the offline pipeline: the workbook as bytes.
  const bytes = () => XLSX.write(workbook(), { type: 'array', bookType: 'xlsx', compression: true });
  return { download, bytes, workbook, companyRow, fileName };
})();

document.addEventListener('click', e => {
  if (e.target.id !== 'downloadDatasets') return;
  const btn = e.target;
  btn.disabled = true;
  toast('Building the datasets workbook…');
  setTimeout(() => { try { Datasets.download(); toast('Datasets downloaded.'); } catch (err) { toast('Could not build datasets: ' + err.message, 7000); } finally { btn.disabled = false; } }, 50);
});
