# M&A CRM

A company database and CRM for M&A work that runs on GitHub Pages. You can:

1. **Import all your lists**: old buyer lists, project lists and Capital IQ exports in Excel or CSV. Duplicates are merged automatically.
2. **Research companies with Claude**: one click (or a whole selection) finds the LinkedIn page, employees on LinkedIn, the CEO, CFO and Corp Dev/M&A people with their LinkedIn profiles, earlier acquisitions, ownership, and a short and long description, all with source links.
3. **Find matches**: pick company X and the engine ranks buyers or targets for it.
4. **Email the matches** as Outlook drafts or directly from your own mailbox, and track all activity.

The data lives in a **shared team database** (Supabase) once connected, or in your browser until then. **No company data is ever stored on GitHub.** Only the app code is.

---

## 1. Files on GitHub

Upload these files to your `mna-crm` repo with **Add file → Upload files → Commit changes**:

`index.html`, `app.js`, `projects.js`, `pipeline.js`, `process.js`, `connectors.js`, `engine.js`, `enrich.js`, `store.js`, `config.js`, `styles.css`, `README.md`, `supabase-setup.sql`

**Don't upload** `CLAUDE.md`, `sample-companies.csv`, or the `.claude`, `database` and `research` folders. They contain client data or local tooling.

### Loading the combined database

`database\mna-crm-database-20261029.json` holds all buyers from Lakeside, Sentinel, Thames and Anubis: 911 unique companies, with project history, contacts and descriptions. Load it once via **Settings → Restore backup**. With the team database connected, it's loaded for everyone.

GitHub Pages: repo → **Settings → Pages** → Branch `main`, folder `/ (root)`. The site is then live at `https://<your-github-username>.github.io/mna-crm/`. After an upload, press **Ctrl+F5** to load the new version.

## 2. Team database (Supabase, one-time, about 10 minutes)

1. Go to <https://supabase.com>, sign up, and click **New project**.
   - Name: `mna-crm`
   - Region: **Europe (Frankfurt)**
   - Database password: anything strong (you won't need it in the app)
2. When it's ready, open **SQL Editor → New query**, paste the full contents of `supabase-setup.sql`, and click **Run**. This creates the tables and the rule that **only @33equity.eu logins** can see the data.
3. **Authentication → URL Configuration**:
   - **Site URL:** `https://<your-github-username>.github.io/mna-crm/`
   - **Redirect URLs:** add the same URL.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
5. Put both into `config.js` (`supabaseUrl` and `supabaseAnonKey`) and upload `config.js` to GitHub. The anon key is designed to be public, because the database rules protect the data.
6. Open the CRM, enter your @33equity.eu email, and click the login link you receive.
7. If you already imported data in this browser before, go to **Settings → Copy this browser's data to the team database**.

Colleagues just open the same link and log in with their own @33equity.eu email.

## 3. Claude research

### Free route: Claude Code with your subscription

1. In the Companies list, tick the companies you want researched, then click **✦ Export for research**. This downloads a `research-request-….json` file.
2. In Claude Code, opened on this folder, say: *"Research the companies in Downloads\research-request-….json"*. Claude follows the procedure in `CLAUDE.md` and writes `research\research-results-….json`.
3. In the CRM, click **✦ Import research** and pick that file. The profiles, people and acquisitions are added to the matching companies.

This uses your subscription's usage limits instead of paid API calls. It works well for tens of companies per session; for thousands, the API route below is faster.

### Paid route: the "Research via API" button (one-time setup, about 3 minutes)

1. Go to <https://console.anthropic.com>, create an account for 33 Equity, and add a payment method.
2. **Set a monthly spend limit** (Settings → Limits), e.g. $100.
3. **API Keys → Create key**, then paste it in the CRM under **Settings → Claude research**. The key stays in your browser only.

**How to use it:** open a company and click **✦ Research with Claude**, or tick several companies in the list and click **Research with Claude**. A progress panel shows what's running and the cost so far. You can pause or stop it at any time.

**What it costs:** roughly **$0.15–0.35 per company** with Claude Opus 5.5, most of it web search. For example, 1,000 companies cost about $250. Sonnet 5.5 and Haiku 5.5 are cheaper options in Settings. Companies researched in the last 90 days are skipped unless you click **Research again** on one company.

**What to expect:**
- Claude uses web search, so results are good but not perfect. Every person and acquisition has a source link, so check before you rely on it.
- Claude **does not log into LinkedIn**. It only uses LinkedIn pages and numbers that are publicly visible in search results.
- Claude **never guesses email addresses**. Emails come from your own lists, or you add them by hand.
- Your own data always wins: Claude only fills in empty fields, and never overwrites what you imported.

## Dashboard

The home page across all active mandates:
- **KPIs:** contacted, in process, NDAs, IOIs, open actions.
- **Next best actions:** sorted by urgency. Examples: IOI deadline coming with buyers who haven't bid, NDAs to chase, reminders and calls due, tier-1 buyers not yet approached, phases behind plan.
- **Mandate cards:** current phase, week X of Y, and best offer.
- **Conversion funnel:** compared with market benchmarks. Typically ~30% of contacted buyers sign an NDA and 5–15 in 100 submit an IOI.
- **Why buyers pass:** a breakdown of pass reasons.

## Apollo: decision makers and verified emails

Three options, from simplest to most automated:
1. **CSV export:** export a people list in Apollo, then use **Import Excel / CSV**. First/Last Name, Title, Email, Email Status, Seniority, Departments, Person Linkedin Url, Website and Apollo Contact Id are recognised, and each person is added to the right company.
2. **Claude Code (subscription):**
   - Select companies, then click **👤 Find people**. This downloads `people-request-….json`.
   - In Claude Code, connect Apollo once: type `/mcp` and choose Apollo.
   - Ask Claude to *"find the decision makers in Downloads\people-request-….json"*.
   - Import the result with **✦ Import research**.
3. **Apollo API (in-app):** deploy `supabase/functions/apollo/index.ts` as a Supabase Edge Function named `apollo`.
   - Set the secrets `APOLLO_API_KEY` and `ALLOWED_ORIGIN` (your GitHub Pages address).
   - Paste the function URL in **Settings → Connectors**.
   - **Find decision makers** then searches Apollo directly, which is free, and reveals emails at 1 credit each.

Choose which departments to look for under **Settings → Connectors**: M&A / Corp Dev, Strategy, CEO/MD, CFO, Founder, PE investment team. Outreach always goes to the best contact first (M&A → Corp Dev → Strategy → CEO → CFO), and verified emails come before unverified ones. GDPR: email business contacts only, for a relevant reason, with an opt-out.

## 4. Running a deal in a project

Each project has five tabs:

- **Overview:**
  - **Deal profile:** the company you're selling. Fill it in via *Edit project & deal profile*, including sector, keywords, revenue, EBITDA and a codename for emails.
  - **Valuation:** an EV range from editable revenue and EBITDA multiples.
  - **Offers:** a comparison of bids against the mid valuation.
  - **Precedent acquisitions:** deals done by matching buyers.
- **Buyers:** the longlist, with a funnel, filters, **Move selected to…** a stage, and **Email selected**.
- **Pipeline board:** drag buyers between the stages Not approached → Teaser sent → Reminder sent → NDA signed → IM sent → Meeting → Offer → Passed.
  - Moving a buyer to **Offer** asks for the amount and type (IOI/LOI/Firm).
  - Moving a buyer to **Passed** asks for the reason.
- **✦ Find buyers:** ranks every company in the database that isn't on the project yet. The score covers sector, keyword phrases, M&A appetite (acquisitions, PE-backed add-on buyers), geography, size, and history with us (engaged or passed in earlier projects). *Add selected* puts them on the longlist with a tier.
- **Follow-ups:** buyers whose teaser or reminder went out more than *N* days ago.
  - **Email reminder to selected** sends a reminder.
  - **Mark selected as reminded** only updates their stage.

When you **send** emails from a project (not drafts), each buyer moves one step: Not approached → Teaser sent → Reminder sent → 2nd reminder sent. The date and a log line are added automatically.

## 5. Importing lists

Click **Import Excel / CSV**. You can select several files at once. For each file:

1. **Pick the sheets.** Dashboards, old sheets and graveyards are unticked by default.
   - The project name is read from the file name ("Project Lakeside" becomes `Lakeside`).
   - Leave it empty for plain company lists such as Capital IQ screens.
2. **Check each sheet:**
   - **Header row:** found automatically, even with title rows above it, as in Capital IQ exports.
   - **Amounts and currency:** millions or thousands, EUR/USD/GBP. "In EUR k" or "($USDmm)" is detected.
   - **Columns:** each column is matched to a field.
     - "Contact Name 2 / Function 2 / E-mail 2 / LinkedIn 2" become the second contact.
     - Status, log, tier, responsible and comments are kept as **project history**.
     - Capital IQ columns (Company Name, Exchange:Ticker, Company Type, Primary Industry, Business Description, Total Revenue, Total Employees, Year Founded, Capital IQ ID…) are recognised automatically.
     - Your corrections are remembered for the next upload.
   - **Rows:** untick the rows you don't want. The filter box helps, e.g. type `oud` and click Deselect.
   - **Duplicates:** a company that already exists is **merged**. It counts as existing if it has the same website, Capital IQ ID, LinkedIn page or name (ignoring GmbH/BV/Group etc.). Near-matches are flagged in orange for you to decide.

### Duplicates: one record per company, without losing data

On import, a company is merged automatically when it has the same **main website** (www, subdomains and paths are ignored: `en.acme.com/de` = `acme.com`), LinkedIn page, Capital IQ ID or name.

**⧉ Duplicates** on the Companies page shows the rest in two groups:
- **Certain:** the same company, safe to merge.
- **Check these:** the same brand on another country domain (`hypoport.de` / `hypoport.com`), contact emails at the other's website (this can also be an owner or parent), or similar names.

Choose the main record per group (the clearest name is preselected), untick records that shouldn't be merged, and click **Merge**. Merging is **lossless**:
- All contacts and all project history are combined. Logs are joined, and the most recent status counts.
- Other names become **aliases** ("Also known as"), and search finds them too.
- Different values (another description, revenue, country) are kept under **"Other values found in your lists"**, with *use this* to swap them.
- The merged records are stored. **Sources → Restore as separate company** undoes a merge.

## 5. Connect Outlook (one-time Azure setup, about 5 minutes)

Your IT admin may need to do this step or approve it.

1. Go to <https://entra.microsoft.com> → **Applications → App registrations → New registration**.
   - **Name:** `M&A CRM`
   - **Supported account types:** *Accounts in this organizational directory only*
   - **Redirect URI:** platform **Single-page application (SPA)**, URI `https://<your-github-username>.github.io/mna-crm/`
2. Click **Register**, then copy the **Application (client) ID** and **Directory (tenant) ID**.
3. **API permissions → Add a permission → Microsoft Graph → Delegated** → add `Mail.Send`, `Mail.ReadWrite` and `User.Read`. If required, click **Grant admin consent**.
4. In the CRM, open **Settings → Microsoft / Outlook**, paste both IDs and your name, click **Save**, then click **Sign in with Microsoft**.

## 6. How the match score works

Each company gets a score from 0 to 100, built from these weighted parts. You can adjust the weights in the Match engine.

- **Sector (35):** the buyer explicitly wants the deal's sector, or has the same sub-sector or sector.
- **Geography (15):** the buyer targets the country or region, or is in the same country, region or Europe.
- **Size fit (20):** the deal's revenue is within the buyer's min/max; otherwise the buyer should be several times larger.
- **Keywords (20):** shared words in the descriptions and keywords.
- **Role (10):** target ↔ buyer or investor.

## 7. Good practice

- Start with **Save as Outlook drafts**, check a few in Outlook, then use **Send now**.
- Keep at least 3 seconds between emails. Microsoft limits sending to about 30 per minute.
- Use **Settings → Download backup** now and then.
- Under GDPR, only email business contacts with a legitimate interest, and honour opt-out requests.
