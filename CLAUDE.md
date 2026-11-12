# M&A CRM

Static web app (GitHub Pages) for 33 Equity: company database, projects (mandates with buyer pipelines), Claude research, match engine, Outlook emails. Plain browser JavaScript, no build step. Menu groups: Deals (Dashboard, Projects, Pitches), Database (Companies, Transactions), Analysis (Buyer search = match engine, Value a company, Market heat map), Outreach (Email, Activity), Admin (Data & sources, Settings). "Transactions" and "Value a company" are two views of the comps panel (`cf.view`, mapped in `showTab`). All imports, sources, connectors, backup/restore and delete live on **Data & sources** (`datahub.js`); import buttons elsewhere relay their files to the inputs there (`data-relay`), and `data-goto` links switch pages. Files: `index.html`, `shell.js` (app shell: SVG menu icons via `data-icon`, collapsible sidebar, breadcrumb `onTabShown`, global search Ctrl K, top-bar save status; `showTab` switches the page at once and renders it after paint), `datahub.js` (Data & sources page), `app.js` (UI), `projects.js` (Projects page; projects are stored as shared state `projects`, linked by name via `company.projects[].project`), `pipeline.js` (per-project deal profile `project.target`, valuation, Find buyers, pipeline board, cadence follow-ups, offer/pass dialogs, offers on `company.projects[].offer`, milestone dates on `.dates`), `process.js` (dashboard, timeline/Gantt `project.timeline`, heat score, conflict check, weekly client report), `connectors.js` (Apollo: CSV, people files, API via `supabase/functions/apollo`), `valuation.js` (Comps & valuation page: transactions database in chunked shared state `tx:meta` / `tx:N`, Capital IQ import incl. S&P Capital IQ Pro exports with `SPTR_` field-code rows (`spgLayout`), multiples/revenue/EBITDA read from the deal summary when the export has no financials (`mineSummary`, amounts in USD m; fields filled this way are listed in `t.mined`), multi-source merge (`mergeTx`: match on transaction ID, else target + year; reported figures replace mined ones; `t.sources` lists the files), a downloadable master file (`exportMasterTx`, re-importable via exact labels), "Add buyers to Companies" (every acquirer becomes a company with `acquisitions` incl. tags and deal summary as `why`), comparable-deal similarity, 10-factor software scorecard on `project.valuation`, Valuation tab and printable report), `market.js` (Market heat map: segment momentum = share of deals last 12 months vs the 24 months before, heat = momentum × log2(1 + deals), PE share, multiples, active buyers, mandates in the market), `compset.js` (Comps page → "Value a company": target from its website via `Enricher.readWebsite` (web_fetch) or the CRM, tags, revenue/ARR/EBITDA, include/exclude filters and single deals, SVG charts, PDF slides and Excel with live formulas; state in localStorage `mna-crm-compset`; `csUse(ctx, state)` points it at a pitch instead), `pitch.js` (Pitches page: per prospect a comp set + buyer longlist (match engine + acquirers of the comparable deals, tag hits in company text and acquisitions), editable tier and rationale, PDF deck and Excel with sheets "Buyer list - Strategics" / "Buyer list - Financial" in the project buyer-list columns; "Start project" creates the project with the buyers; stored as shared state `pitches`, included in backups), `supabase/functions/apollo/index.ts` (Edge Function proxy, deployed separately; don't upload it to Pages), `taxonomy.js` (4 levels **Industry › Sector › Sub-sector › Niche**: Technology has 7 sectors (Horizontal software, Infrastructure & security software, Vertical software, Software groups, IT services, Internet & digital platforms, Hardware & semiconductors) with sub-sectors and the 58 niches + synonyms; 10 other industries (Financial Services, Business Services, …) with sectors for non-software buyers; `Taxonomy.classify(c)` derives niches from texts, `ofDeal(a)` / `pathOfDeal(a)` classify a deal, `pathOf(name)` gives the path of a niche/sub-sector/sector, `pathOfCompany(c)` = hand/research-set `cls_industry/cls_sector/cls_subsector` (`cls_src`) › investor → Financial Services › Private equity & venture capital › niche › Capital IQ label (`fromLabel`, GICS → path), `endMarket(subsector, path)` links vertical software to the industry it sells into, `adjacent()` links related niches, `TREE` feeds the cascading selects; `industryOf(niche)` now returns the sub-sector; the old `company.industry` field is dropped on classify), `engine.js` (import parsing, duplicates, matching; sector fit is niche-first: same niche / buy-box niche > bought in niche > adjacent niche > same sub-sector / bought in sub-sector > end-market link (e.g. a construction group for construction software) > same sector (not for the broad Vertical / Horizontal software sectors); "Technology" and labels like "Application Software" never count; `Engine.dealPath(deal)` reads `cls_*` picked in a deal profile, else the main niche; `acquisitionProfile` also gives `subsectors`, `sectors`, `last12`, `last36`), `enrich.js` (research via Anthropic API + `apply()` that writes a profile onto a company), `store.js` (Supabase or IndexedDB; in the browser, IndexedDB v2 keeps one record per company in store `companies`, so a save writes only changed companies — never go back to writing the whole array), performance notes: companies carry `niches` (top 3) + `niche_sig`, deals carry `niche` + `nv` (taxonomy version), and `backfillDealNiches()` in app.js fills/saves these and warms the match caches (`Engine.warm`) in idle time after load — keep new per-company work cached the same way, `config.js`, `styles.css` (warm theme: colours, `--serif`, `--ink`, `--gold` as tokens on `:root`; use tokens, not new hex values). Look & feel helpers in app.js: `logo()` / `personAvatar()` (favicon or coloured initials via `hueOf`), `badges(c)` (Researched / Acquisitive / PE-backed / Listed / Reachable / mandates), the company page in `renderDrawer` (metric row, sticky side card with actions and profile completeness), `toast()` picks ok/err styling from the text; shell.js draws loading skeletons until the first render. Buyer lists (Buyer search and Find buyers) share `buyerRow()` / `kindPills()` / `buyerKind()` in app.js (columns: score, buyer, about, relevant acquisitions via `Engine.relevantDeals`, why it fits). Pipeline tab has a Board / Deal progress toggle (`board.view`, `progressHtml`); offers show as cards (`offerCardsHtml`, cash/earn-out/rollover parsed from the structure text); the project Valuation tab has a Market report (`multBars`). Companies has quick-filter pills, active-filter chips and saved searches (shared state `savedSearches`, in backups); companies can be watched (`c.watched`, `c.watch_seen`, `watchNews()`), shown on the dashboard with the "Start from a website" box (opens the company or creates a pitch), mandate cards and an activity feed.

**Classification in the UI:** Companies has one filter select with the whole tree (values `I:`/`S:`/`U:`/`n:` + name, `l:` + own label; `clsMatches`); the company page, project deal profile (`target.cls_*`, `target.niche`) and Value a company / pitches (`cs.target.cls_*`) use four linked selects (`clsEditorHtml` / `applyClsChange` in app.js). Transactions has the same tree filter (`txClsMatches`, `txClsOptions`) and a "By sub-sector" table; the heat map defaults to sub-sectors (also niche, S&P tags, S&P label, country); comparable-deal similarity (`compareTx`) scores niche 1 › sub-sector 0.8 › related niche 0.6 › sector. **Per employee:** `perEmployee(list)` gives revenue and EBITDA per employee (USD k) over deals with both; Transactions and Value a company show it, and a target with only a headcount gets an "EV/Rev (headcount)" method. Company page shows revenue / employee. **Research → transactions:** `syncResearchToTransactions` (valuation.js) runs after every research / acquisitions import: researched figures (deal value, target employees, revenue, EBITDA, strings with currency) fill blanks on the linked deal (`tx_id`, else target + year) and sourced researched deals become transactions with source "Claude research".

## Team database (Supabase)

The CRM runs on Supabase project `gpaskdvvmfwwermqpqcp` (EU, Frankfurt): `config.js` holds the URL and the publishable key (public by design; access is limited to logged-in @33equity.eu users by RLS + grants in `supabase-setup.sql`). Never put a secret / service_role key in any file. Company saves go in batches of ≤100 rows / ~1.5 MB with split-and-retry (`Store.saveCompanies`). The public demo site is live at https://testvaluationz.netlify.app (function `estimate`, index in private bucket `site-private`). Since the CRM is now in cloud mode, the local test server (localhost:8770) also connects to the team database unless you clear the config: test against a restore only with care.

## Public valuation & buyer site (prototype)

`public-site/` is an OffDeal-style public website (website + a few numbers → indicative valuation, market activity, anonymised buyers, lead form). The front end (`index.html`, `site.css`, `site.js`) holds no data; the engine (`public-site/estimate-core.js` + `taxonomy.js`) runs server-side in `supabase/functions/estimate/index.ts` (run `public-site\sync-function.ps1` before deploying; tables in `supabase/public-site.sql`). Its data is the anonymous market index built in the CRM by `publicindex.js` (Data & sources → Build market index): per-niche stats only with 8+ deals and buyer profiles without names. Never put the index or any CRM data in the front end, a public bucket or GitHub. Locally, `dev-worker.js` plays the server on localhost using `local-data/public-index.json`, and `serve.ps1` has a `/fetch?url=` proxy to read websites. See `public-site/README.md`.

The site is multilingual (EN/NL/DE/ES): English texts are in `index.html` (data-i18n keys), the other languages and all results texts in `i18n.js`; `fin-ui.js` merges its own texts. The results page has a valuation model that runs entirely in the browser (no server, no Claude API): `market-params.js` (public market data to update yearly: risk-free, Damodaran ERP / country risk / Europe betas, tax rates, size premium bands, LBO terms), `fin-engine.js` (5-year P&L, NOPLAT → FCF, mid-year DCF with Gordon TV and WACC × g sensitivity, LBO entry value at 20/25/30% IRR; an uploaded plan is followed for its years, then growth and margin fade), `fin-import.js` (reads an uploaded P&L in the browser: year columns, labels in four languages, unit detection; SheetJS lazy-loaded), `fin-excel.js` (Excel download with live formulas, laid out like the 33 Equity FMs: Cover, Inputs, P&L, DCF, LBO), `fin-ui.js` (football field, tabs income statement / DCF / LBO / your data). Every input has an ⓘ button (`class="info" data-info="key"` → text `info.key` in `help.js`, which also holds the skip hints and email-gate texts) and everything except revenue is optional. The first estimate is free without email; the full model (DCF / LBO / upload / Excel) opens after name + email (`gateHtml` / `unlock` in fin-ui.js, remembered in localStorage `site-lead`), which saves a lead at once (`summary.stage`: unlock / excel / update / report). The lead form sends the model (`input.model`) to the `leads` table; the CRM merges rows per email + website (`mergeLeads`). In the CRM, Pitches shows a "Website leads" panel (`leadsHtml` / `leadToPitch` / `leadCardHtml` in pitch.js; `Store.loadLeads` / `updateLead`; badge `#navLeadCount`, refreshed every 5 min): **Create pitch** fills the pitch target from the lead and the pitch shows a "From the website" card. Lead fields are visitor input: always escape them. RLS lets team members select/update `leads` (see `supabase/public-site.sql`). `public-site-demo/` is the Netlify copy (same files with SITE_API filled in).

## Enriching the whole database (gap-based queue) — the main research route now

`research/enrich/req-NNNN.json` (818 batches of 20, built from the master on 2026-11-12, best first: 0001–0013 never-researched project buyers, 0014–0139 tier 1 = active buyers / investors / PE-owned platforms, 0140–0353 tier 2, 0354+ tier 3). Each company has `have` (known facts: don't redo), `need` (the gaps: website, linkedin, hq, founded, ownership, classification, description, buyer_profile, buy_box, financials, ma_contacts, new_deals, deal_facts) and `deals_missing_facts`. Agents follow `research/enrich/INSTRUCTIONS.md` exactly and write `res-NNNN.json` (format `mna-crm-research` v2: profile incl. `niche` or `cls_industry/cls_sector/cls_subsector`, `employees`, `revenue`/`ebitda` in EUR m + `financials_year`, people with `email` only when published on the company's own site, acquisitions with `deal_value`/`target_revenue`/`target_ebitda` as strings with currency and `target_employees`). Run rounds of ~4–6 parallel agents (general-purpose), then `powershell -NoProfile -ExecutionPolicy Bypass -File .claude\check-enrich.ps1`: it strips companies without sources into a redo batch `req-R0NN.json`, reports what was found and lists the next batches. The user imports all `res-*.json` at once with **✦ Import research** (multiple files). Lesson from the pilot: agents tend to fill famous companies from memory; memory is not a source (Wikipedia / IR pages are fine). Rebuild the queue from a fresh master when much has been imported. Background: `research/ENRICHMENT-STRATEGY.md`, `research/CLASSIFICATION-AND-RESEARCH-PLAN.md`; the first identity pilot (100 top buyers) is in `research/identity/` and already in the master.

## Researching companies with Claude Code (the free route, using the subscription)

The user exports companies from the CRM (**Export for research**) as `research-request-*.json`, usually in their Downloads folder, and asks Claude Code to research them. Then:

1. Read the request file. Each company has `id`, `name`, `website`, `country`, `sector`, `description`, `known_people`.
2. Research each company with web search (about 3–6 searches each). Find:
   - Website and the LinkedIn company page.
   - Employee count shown on LinkedIn, and total employees.
   - HQ city and country, year founded, and ownership (founder/family, PE-backed by whom and since when, listed + ticker, or subsidiary of whom).
   - CEO, CFO, Corporate Development / M&A / Strategy people, and active founders, with LinkedIn profile URLs where seen.
   - Acquisitions made by the company (most recent first, max 15).
   - A one-sentence short description and a 4–6 sentence long description.
3. Rules:
   - Always fill `industry` and `niche` with values from the lists in `taxonomy.js` (e.g. "Business process & automation" / "Process mining & intelligence"), plus a specific `sector` and `subsector`. Never use broad labels like "Application Software", "Systems Software" or "IT Consulting and Other Services": they make every software company look alike to the match engine.
   - Only report what a source supports. Use `""` for unknown values.
   - Never guess emails or construct LinkedIn URLs. Only use URLs actually seen in results.
   - Prefer sources from the last 24 months, and drop people who have left.
   - If a name is ambiguous, use the website and country, and say so in `notes`.
4. Write the results to `research/research-results-YYYYMMDD-HHMM.json` in this folder, then tell the user to import it with **✦ Import research** on the Companies page.
5. For large batches, use subagents in parallel (5–10 companies each). Write partial results as you go so nothing is lost if usage limits are hit.

### Results file format

```json
{
  "type": "mna-crm-research",
  "version": 1,
  "created": "2026-10-29T14:00:00Z",
  "model": "Claude Code (subscription)",
  "companies": [
    {
      "id": "<id from the request, or omit for a new company>",
      "name": "Company name",
      "website": "example.com",
      "searches": 5,
      "profile": {
        "website": "", "linkedin_url": "", "linkedin_employees": "", "employees": "",
        "hq_city": "", "country": "", "founded": "", "ownership": "",
        "industry": "<from the list in taxonomy.js>", "niche": "<from the list in taxonomy.js>",
        "sector": "specific market, e.g. Process mining software (never Application Software / Systems Software / IT Services)", "subsector": "narrower product focus",
        "short_description": "", "long_description": "",
        "company_type": "Strategic | Financial | unknown",
        "is_acquisitive": "yes | some | no | unknown",
        "acquisition_focus": "2-3 sentences: what kind of companies it buys (niches, business models, typical size, geography, strategy)",
        "target_sectors": "ERP; field service software", "target_countries": "Netherlands; Germany; Nordics",
        "people": [{ "name": "", "title": "", "role_tag": "CEO | CFO | COO | CTO | Founder | Chairman | Corporate Development | M&A | Strategy | Board | Other", "linkedin_url": "", "source_url": "" }],
        "acquisitions": [{ "target": "", "year": "", "description": "", "source_url": "" }],
        "notes": "",
        "sources": ["https://..."]
      }
    }
  ]
}
```

**Data model v2 (optional profile fields, also accepted in the descriptions format):** `investor_type` (buyout | growth | vc | family_office | search_fund | holdco_serial | corporate_vc | strategic | pe_backed_platform), `sponsor_name` + `sponsor_since` (PE/VC owner), `parent_name`, `former_names` (become aliases), `buy_box` `{ ev_min, ev_max, rev_min, rev_max, ebitda_min, ticket_min, ticket_max` (all EUR m)`, deal_types[]` (platform | add_on | majority | minority | growth | carve_out)`, business_models[], niches[]` (taxonomy names)`, countries[], profitable_required` (yes/no)`, stake` (majority/minority/both)`, notes, source }`, `fund` `{ aum, current_fund, fund_size, vintage, close_date, source_url }` (EUR m), `research_level` (1 = identity pass, else 2). They're applied by `Enricher.applyFacts()` and only fill blanks; a buy box also fills `min_revenue` / `max_revenue` / `target_countries` / `target_sectors`, and the match engine scores size on `buy_box.ev_min/ev_max` (target EV ≈ 2× revenue). `c.research = { level, at, by }` records how deep a company was researched. Activity (deals in the last 12 / 36 months) is computed in `Engine.acquisitionProfile`, not stored. **Data & sources → Fill in from own data** runs `Enricher.derive` (founding year, HQ city, parent, former names from Capital IQ descriptions) and `Enricher.ownersFromDeals` (latest buyer in the deal history → `sponsor_*` when financial, `parent_*` when strategic). The plan for enriching the database is in `research/ENRICHMENT-STRATEGY.md`.

The `profile` object is the same shape as the `save_profile` tool in `enrich.js`, and it's applied by `Enricher.apply()`. The user's own data wins: blank fields are filled in, but imported facts are never overwritten. A researched `long_description` goes to `summary` when the company already has a description; `acquisition_focus`, `target_sectors` and `target_countries` feed Find buyers; researched `acquisitions` are merged into the deal history by target name (never replace it); `company_type` sets the type unless the user set one.

For buyers (e.g. S&P acquirers) a research round should cover: website, LinkedIn page, HQ, ownership, short and long description, company type, acquisition focus / target sectors / target countries, and CEO / CFO / Corp Dev / M&A people. Requests for website-only passes use `mode: "website"` and are cheaper (~1 search per company).

## Descriptions from list data (no web research)

To write short descriptions and summaries from what's already in the lists, write a file `{"type":"mna-crm-descriptions","version":1,"companies":[{"id","name","short_description","summary","tags":[]}]}`. **Import research** recognises it, fills `short_description`, `summary` and `tags`, and doesn't mark the company as researched. Version 2 items may also carry the data model v2 fields (`investor_type`, `buy_box`, `fund`, `sponsor_name`, `parent_name`, `hq_city`, `founded`, `niche`, `acquisition_focus`, `target_sectors`, `target_countries`); they only fill blanks (research level 0). Investor buy boxes from Capital IQ descriptions: `research/desc-request-inv-*.json` → `desc-results-inv-*.json`. Rows whose name is a category label are section headers, not companies, so skip them.

## Acquisition track records

To research buyers' acquisitions (portfolio investments for PE), write `research/acq-results-*.json`:

```json
{ "type": "mna-crm-acquisitions", "version": 1, "created": "<ISO>",
  "companies": [ { "id": "", "name": "", "acquisitive": "yes|some|no|unknown", "notes": "",
    "acquisitions": [ { "target": "", "target_website": "", "date": "YYYY-MM", "industry": "", "country": "", "deal_value": "", "target_revenue": "", "target_employees": "", "stake": "", "type": "", "description": "", "source_url": "" } ] } ] }
```

- Every deal needs a `source_url`, and you shouldn't invent values.
- **Import research** merges deals by target name.
- Requests are built from the database file in batches of about 20 companies (`research/acq-request-*.json`), worked by parallel subagents.
- Wave 1 covered tier-1 buyers of Lakeside, Sentinel and Anubis. Wave 2 covers tier 2 (`acq-request-t2-1..9`), then `acq-request-redo-1` (12 buyers that came back empty).
- Web search is capped at about 200 searches per round, shared across agents. Run about 2–4 batches per round and tell agents to prefer direct page fetches.
- After each round, run `powershell -NoProfile -ExecutionPolicy Bypass -File .claude\merge-acquisitions.ps1`. It merges every `acq-results-*.json` into `database\mna-crm-database-with-acquisitions.json` (full restore) and `research\acquisitions-all.json` (import into an existing CRM).

## Finding decision makers (people request via Apollo)

**Find people** exports `people-request-*.json` (`type: mna-crm-people-request`). It contains companies with `id`, `name`, `website`, plus the wanted `titles` and `max_per_company`.
1. Use the Apollo connector if it's authorised (the user runs `/mcp`). Search people by company domain and the titles, then enrich only the chosen people, which costs credits.
2. Prefer M&A / Corp Dev, then Strategy, CEO, CFO, and for PE the investment team.
3. Keep only verified business emails, and never guess emails.

Write `research/people-results-YYYYMMDD-HHMM.json`:

```json
{ "type": "mna-crm-people", "version": 1, "source": "Apollo",
  "companies": [ { "id": "<from request>", "name": "...", "website": "...",
    "people": [ { "name": "", "title": "", "email": "", "email_status": "verified", "linkedin_url": "", "seniority": "", "departments": [], "apollo_id": "" } ] } ] }
```

The user imports it with **✦ Import research**.

## Master database (single source of truth)

`database/mna-crm-master.json` is the one big database: every company from every source (the user's buyer lists, S&P/Capital IQ buyers, research results) with websites, profiles, people, acquisitions, plus all projects and transactions. It's a normal CRM backup (`version: 5`, includes `transactions`), so the user restores it in the live CRM under **Settings → Data → Restore backup**.

To add anything to it, use the CRM's own merge logic in the local test CRM (http://localhost:8770, `.claude\serve.ps1`), never hand-edit the JSON:
1. Copy the master and any new source files into `local-data/` (the server serves it; it's not uploaded to GitHub).
2. In the page: restore the master (dispatch a `change` on `#restore` with a `DataTransfer` file), then import the new source: company lists via the import wizard, transaction exports via `importTransactionFiles([...])` (it also adds the buyers to Companies), research results via **Import research**.
3. Save with `fetch('/save?name=mna-crm-master.json', { method: 'POST', body: JSON.stringify(backupData()) })`, move `local-data/mna-crm-master.json` to `database/`, keep the previous version as `database/mna-crm-master-YYYYMMDD.json`.
4. Wipe the test browser afterwards (companies, `tx:*`, `projects`) and delete the copies in `local-data/`.

One company per buyer: transaction buyers are matched by name, and fund vehicles of one investment house ("Thoma Bravo Fund XV, L.P.", "EQT X", "Hg Saturn 1") are merged into the house after every buyer import (`consolidateFundHouses` in valuation.js, `Engine.fundHouses` / `houseKey`). Each deal keeps the vehicle it went through as `via`; vehicle names stay as aliases.

If the user changed things in the live CRM since the last master, start from their fresh backup (**Settings → Data → Download backup**) instead: a restore overwrites companies with the same ID.

## Working on the app

- Test locally: `powershell -NoProfile -ExecutionPolicy Bypass -File .claude\serve.ps1 -Root "<this folder>" -Port 8770`, then open http://localhost:8770/.
- The user deploys by uploading changed files to their GitHub repo `mna-crm` (no git on this PC). After a change, always list exactly which files to upload.
- Don't commit or upload client lists, `sample-companies.csv`, or the `research/` and `database/` folders to the public repo.
