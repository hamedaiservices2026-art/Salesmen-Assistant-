# Deploying the pilot

Goal: a private URL where the owner creates the pilot company and the rep opens his link on an iPhone. No demo data is loaded in production. About 30 minutes, free tiers only.
Everything here is checked against the code at this commit except the parts that happen inside the Supabase and Vercel dashboards.

## 1. Database (Supabase, free)

1. Create a project. Pick the region closest to Saudi Arabia that is offered (Frankfurt if nothing nearer). Remember the database password.
2. Open **Project Settings → Database → Connection string** and copy the **Direct connection** string (port **5432**). Do not use the pooled string (port 6543): start-up migrations take a session-level lock that is unreliable behind the pooler.
3. If the dashboard only offers the direct string over IPv6 and Vercel cannot reach it, use the **Session pooler** string (also port 5432 on the pooler host). It is session-level, so the lock works.

## 2. Hosting (Vercel, free)

1. Import the GitHub repository `Salesmen-Assistant-` (branch `claude/sales-rep-support-system-oxd6dn`, or merge it into the default branch first). Framework: Next.js (detected). Package manager: pnpm (detected from `pnpm-lock.yaml`). Node: 22 (`engines` and `.nvmrc`).
2. Under **Settings → Functions**, set the function region to the one nearest the database.
3. Environment variable (Production): `DATABASE_URL`, the direct connection string from step 1. Nothing else.

Do not set `APP_TODAY`, `ALLOW_APP_TODAY`, `ALLOW_DEMO_SEED` or `ALLOW_LOCAL_DB` on Vercel: the first two pin "today" for demos and tests, the others exist for local runs.

4. Deploy. The first request creates the tables (migrations run once, under a lock).

## 3. The owner's path (no demo data)

Production never loads the demo: it has accounts whose passwords would be public in the source. Run these on any computer or cloud session that has the repo and Node 22 with pnpm (`pnpm install` first). `DATABASE_URL` is the string from step 1.

1. **Create the platform owner.**

   ```bash
   DATABASE_URL='<direct connection string>' pnpm admin:create-owner you@example.com "Your Name"
   ```

   It prints `/admin/invite/<token>`. Open `https://<your-vercel-domain>` + that path, choose a password of at least 10 characters with at least 5 different characters. You are signed in at `/admin/companies`. Later sign-ins are at `/admin/signin` with the email and password. The link expires after 7 days; run the command again for a new one.

2. **Create the company.** In `/admin/companies` fill the company name, currency, time zone, default language and the first admin's name and email. The page shows that admin's invite link once; send it to him. He opens it and sets his own password.

3. **Optional: load the pilot structure.** Run

   ```bash
   DATABASE_URL='<direct connection string>' pnpm db:pilot "<company name or id>"
   ```

   It adds the six pilot lines (185, 250 and 320 ml cans, Kinza, Food, Coverage) and a draft, unpublished November 2026 scheme holding only what is fixed: the three can amounts at 100% and the Kinza and Food bonus. Running it again changes nothing. If the company has no use for it, skip it and create the lines in `/admin/lines`.

4. **The admin completes and publishes the scheme.** In `/admin/schemes` he adds the 90% to 99% and 110% tiers, any extra incentive at 100%, and the month's variable component (coverage or a volume item), checks the preview against a rep, and publishes.

5. **The admin creates the rep and sends him the link.** In `/admin/users` he adds the rep (and a supervisor, if the company has one), copies the invite link shown once and sends it. The rep opens it on his iPhone and chooses a 6-digit PIN. Targets for the month are set in `/admin/targets` (a form) or by Excel upload, below.

6. **Coverage.** If the company measures coverage, the admin adds a line of kind `coverage` in `/admin/lines`. A coverage line has no cell in the targets grid: the rep, his supervisor (`/app/team`) or the admin (`/admin/coverage`) records customers covered out of customers in the territory.

`pnpm e2e:admin` runs this path on a temporary local database in a browser, with synthetic test amounts.

## 4. Upload the first Excel file

`/admin/uploads` has two cards, one per kind. Each has a **template** button: the downloaded `.xlsx` holds the header row on its first sheet and, on a second sheet, the company's active line codes with their names and units (coverage lines are not listed and are refused in a file; they have their own page).

| Kind | Columns | Use |
| --- | --- | --- |
| Monthly targets | `login, year, month, line, amount` | A new target replaces the old one and every change is logged in the targets history. |
| Daily sales and collection | `login, date, line, amount` | The day's figures per rep and line. |

- **Accepted files:** `.xlsx` only, up to 2 MB and 5,000 rows. A renamed non-Excel file, an empty file, or a file with missing or duplicated column names is refused with a message. A sheet formatted as an Excel Table is read like any other sheet (only its cells are used).
- **Dates:** text `YYYY-MM-DD` or a date-formatted cell. Digits may be Western or Arabic-Indic. Future dates and non-selling days are refused. Amounts are in whole units of the line (cases) or in currency (value).
- **All or nothing:** if any row has a problem, nothing is applied. The page shows a row-by-row report (row number, column, reason, up to 100 rows plus a count of the rest); fix the file and upload it again. A fully valid file applies every row at once.
- **History:** the page lists the last 20 uploads with their row counts and outcome, applied or not.
- **Precedence for daily files:** the admin's figure wins over the rep's for the same day and line, and the rep sees both on his close form ("the admin recorded X" and what he typed himself). The admin's figure is the one stored for that day and line.
- **Draft closes:** an upload for a day on which the rep has no close creates a **draft** close. The day stays open for the rep (it still prompts him and shows as a gap), and his cash and stock fields start blank so he has to enter them and confirm. An upload for a day he has already closed adds the admin's figure to that close.

## 5. What to expect on the phone

- It is a website, not yet an installable app: open it in Safari. Home Screen install, push notifications, and offline use arrive in plan 4.
- Arabic is the default; Settings switches to English or Urdu.
- A mid-month incentive created in `/admin/incentives` reaches each rep as an in-app notification (the bell on his home screen shows the unread count).
- Review the free-tier terms of the database and hosting services before entering real customer data.

## 6. Free tier and known limits

Nothing in the admin console is withheld for the free tier; every admin screen described above works on it. Known limits of this deployment:

- **One upload at a time per server instance.** The upload lock is in memory, per admin and per instance. A second upload from the same admin while one runs is told to wait; two instances (as on a serverless host) do not coordinate, but a file is still applied all-or-nothing inside the database.
- **Upload memory.** Reading a 2 MB `.xlsx` can use up to about 300 MB of memory. Keep the Vercel function memory at the plan's default or higher; a file that stays within the 2 MB and 5,000-row limits is the supported case.
- **A forgotten PIN or password needs a new link from the admin** (`New sign-in link` in `/admin/users`); for the owner, run `pnpm admin:create-owner` again. The old PIN or password keeps working until the new link is opened.
- Migrations use the connection in `DATABASE_URL`; behind a transaction pooler they can hang. A separate migration URL is planned.
