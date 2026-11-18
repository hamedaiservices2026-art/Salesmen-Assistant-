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

5. **The admin creates the rep and sends him the link.** In `/admin/users` he adds the rep, copies the invite link shown once and sends it. The rep opens it on his iPhone and chooses a 6-digit PIN. Targets for the month are set in `/admin/targets` (a form, or an Excel upload when plan 2 reaches it).

`pnpm e2e:admin` runs this whole path on a temporary local database in a browser, with synthetic test amounts.

## 4. What to expect on the phone

- It is a website, not yet an installable app: open it in Safari. Home Screen install, push notifications, and offline use arrive in plan 4.
- Arabic is the default; Settings switches to English or Urdu.
- Review the free-tier terms of the database and hosting services before entering real customer data.

## 5. Known limits of this deployment

- A forgotten PIN or password needs a new invite from the admin (`New link` in `/admin/users`), or `pnpm admin:create-owner` again for the owner.
- Migrations use the connection in `DATABASE_URL`; behind a transaction pooler they can hang. A separate migration URL is planned.
