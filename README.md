# M&A CRM

A lightweight M&A CRM that runs on GitHub Pages. You can:

1. **Upload companies** from CSV or Excel (targets, strategic buyers, PE investors, with contact emails).
2. **Find matches**: pick company X and the engine ranks every other company on sector, geography, size fit, keywords and buyer/target role, and shows why each one matched.
3. **Email the matches**: select the matches you want and the app creates personalised Outlook drafts or sends the emails directly from your own Microsoft 365 mailbox.
4. **Track activity**: every email is logged and contacted companies get status *Contacted*.

Your company data stays in your browser (IndexedDB) and is **never uploaded to GitHub**. Only the app code is on GitHub.

---

## 1. Put it on GitHub Pages

1. Create a new repository on GitHub, e.g. `mna-crm`. On the free plan, Pages needs a **public** repo; with GitHub Pro/Team a private repo works too.
2. Upload these files: `index.html`, `app.js`, `engine.js`, `styles.css`, `README.md`. **Don't upload `sample-companies.csv` or any real data to a public repo.**
3. Go to the repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
4. After about a minute your app is live at `https://<your-github-username>.github.io/mna-crm/`.

## 2. Connect Outlook (one-time Azure setup, about 5 minutes)

Your IT admin may need to do this step or approve it.

1. Go to <https://entra.microsoft.com> → **Applications → App registrations → New registration**.
   - Name: `M&A CRM`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: platform **Single-page application (SPA)**, URI `https://<your-github-username>.github.io/mna-crm/` (exactly the Pages URL, including the trailing `/`)
2. Click **Register**. Copy the **Application (client) ID** and **Directory (tenant) ID**.
3. **API permissions → Add a permission → Microsoft Graph → Delegated** → add `Mail.Send`, `Mail.ReadWrite` and `User.Read`. If your organisation requires it, click **Grant admin consent**.
4. In the CRM, open **Settings**, paste both IDs and your name, click **Save**, then **Sign in with Microsoft**.

Emails are sent as **you**, from your own mailbox, and appear in your Sent Items.

## 3. Importing buyer lists

Click **Import Excel / CSV**. You can select several files at once. For each file:

1. **Pick the sheets** to import. Dashboards, old sheets and graveyards are unticked by default. The project name is read from the file name, e.g. "Project Lakeside" becomes `Lakeside`.
2. For each sheet, check the result:
   - **Header row**: found automatically, even with title rows above it.
   - **Amounts**: EUR millions or thousands. "In EUR k" above the header is detected.
   - **Columns**: each column is matched to a field. "Contact Name 2", "Function 2" and "E-mail 2" become the company's second contact. Status, log, tier, responsible and comments are kept as **project history**. Anything else is kept as extra info. Your corrections are remembered for the next upload.
   - **Rows**: untick the rows you don't want. The filter box lets you deselect, for example, all rows marked "oud".
   - **Duplicates**: a company that already exists (same website, or same name ignoring GmbH/BV/Group etc.) is **merged**. Empty fields are filled in, new contacts are added, and project status is updated. Near-matches are flagged in orange so you can choose.

Use **Find duplicates** on the Companies tab to clean up afterwards. You can also merge two companies by hand in the company dialog.

Click **Download template** for a clean example layout. Column names are flexible. For example, `Company`, `Investor`, `Category`, `Turnover`, `E-mail`, `Omzet` and `Land` are all recognised. Amounts like `€12,5m`, `850k` and `1.2bn` all work.

| Column | Used for |
|---|---|
| `name`, `role` (Target / Buyer / Investor) | role matching: targets are matched to buyers and investors, and the other way around |
| `sector`, `subsector` | sector match |
| `country` (`region` optional, auto-filled for Europe) | geography match |
| `revenue`, `ebitda`, `employees` | size fit |
| `description`, `keywords` | keyword similarity |
| `target_sectors`, `target_countries`, `min_revenue`, `max_revenue` | **buyer criteria**: strongest signal when filled in (separate items with `;`) |
| `Contact name`, `Function`, `E-mail`, `Phone` (+ ` 2`, ` 3` …) | contacts that get the emails |
| `Status`, `Date of last contact`, `Log`, `Tier`, `Responsible`, `Remarks` | project history |

## 4. How the score works

Each company gets 0–100 based on weighted parts (you can adjust the weights in the Match engine):

- **Sector (35)**: buyer explicitly wants the deal's sector, or same sub-sector or sector
- **Geography (15)**: buyer targets the country or region, or same country, region or Europe
- **Size fit (20)**: deal revenue within the buyer's min/max; otherwise the buyer is several times larger than the target
- **Keywords (20)**: shared words in description and keywords
- **Role (10)**: target ↔ buyer or investor

## 5. Good practice

- Start with **Save as Outlook drafts**, check a few in Outlook, then use **Send now**.
- Keep the delay between emails at 3 seconds or more. Microsoft limits sending to about 30 messages per minute and 10,000 recipients per day.
- Use **Settings → Download backup** regularly. Clearing browser data deletes the CRM data.
- Under GDPR, only email business contacts with a legitimate interest, and honour opt-out requests.
