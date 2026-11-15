# Deploying the pilot (plan 1)

Goal: a private URL the pilot rep opens on his iPhone, running the sample data. About 20 minutes, free tiers only.
Everything here is checked against the code at this commit except the parts that happen inside the Supabase and Vercel dashboards.

## 1. Database (Supabase, free)

1. Create a project. Pick the region closest to Saudi Arabia that is offered (Frankfurt if nothing nearer). Remember the database password.
2. Open **Project Settings → Database → Connection string** and copy the **Direct connection** string (port **5432**). Do not use the pooled string (port 6543): start-up migrations take a session-level lock that is unreliable behind the pooler.
3. If the dashboard only offers the direct string over IPv6 and Vercel cannot reach it, use the **Session pooler** string (also port 5432 on the pooler host). It is session-level, so the lock works.

## 2. Hosting (Vercel, free)

1. Import the GitHub repository `Salesmen-Assistant-` (branch `claude/sales-rep-support-system-oxd6dn`, or merge it into the default branch first). Framework: Next.js (detected). Package manager: pnpm (detected from `pnpm-lock.yaml`). Node: 22 (`engines` and `.nvmrc`).
2. Under **Settings → Functions**, set the function region to the one nearest the database.
3. Environment variables (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | the direct connection string from step 1 |
| `APP_TODAY` | `2026-11-14` |
| `ALLOW_APP_TODAY` | `1` |

`APP_TODAY` and `ALLOW_APP_TODAY` pin "today" to a day inside the sample November 2026 data so the screens keep showing it. Remove both as soon as you load real data. Never set `ALLOW_DEMO_SEED` or `ALLOW_LOCAL_DB` on Vercel.

4. Deploy. The first request creates the tables (migrations run once, under a lock).

## 3. Load the sample data and get the invite link

The sample data is a demo company with one rep (login `ahmed`) and one second company used to prove isolation. Run this once, on any computer or cloud session that has the repo and Node 22 with pnpm:

```bash
pnpm install
DATABASE_URL='<direct connection string>' ALLOW_DEMO_SEED=1 pnpm db:seed
```

It prints two paths of the form `/invite/<token>`. Open `https://<your-vercel-domain>` + the **first** path on the iPhone, choose a 6-digit PIN, and note the username shown (`ahmed`). The links expire after 7 days; running the seed again issues new ones and resets the demo rep's PIN and sessions.
Do not share the second path: it belongs to the isolation-test company.

## 4. What to expect on the phone

- It is a website, not yet an installable app: open it in Safari. Home Screen install, push notifications, and offline use arrive in plan 4.
- Arabic is the default; Settings switches to English or Urdu.
- All names and figures are synthetic. Do not enter real customer data until plan 2 (admin, Excel upload) and a review of the free-tier terms of any AI service added in plan 3.

## 5. Known limits of this deployment

- No admin screen: creating another rep, changing targets, or reissuing an invite is done by code until plan 2.
- A forgotten PIN needs a new invite until PIN reset is added.
- Migrations use the connection in `DATABASE_URL`; behind a transaction pooler they can hang. A separate migration URL is planned.
