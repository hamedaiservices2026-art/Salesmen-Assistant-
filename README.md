# Salesman Assistant

A personal assistant for field sales reps. Every day it tells the rep where he stands against his monthly targets, what is left, what to focus on, and what he will earn. It is mobile-first and Arabic-first (with English and Urdu), and the commission figure is calculated transparently so every amount can be traced. The rep types his day close; the company's admin can also upload the day's figures from Excel.

## Requirements

- Node 22 or newer (`engines` in `package.json`, `.nvmrc` says 22)
- pnpm 10

## Run locally

```sh
pnpm install
rm -rf .data
pnpm db:seed
pnpm dev
```

`pnpm db:seed` prints three invite paths (`/invite/<token>`: Ahmed, the other company's rep, and the supervisor Sami). Open Ahmed's invite on `http://localhost:3000`, choose a 6-digit PIN, and you are signed in. Later sign-ins use the login `ahmed` and that PIN. The seed is fixed to November 2026, so for a demo set `APP_TODAY=2026-11-14` before `pnpm dev`.

### Demo accounts (LOCAL-ONLY sample data)

The local seed also creates two admin-console accounts whose passwords are written in `src/db/seed.ts`. They are synthetic sample data for a local database and must never be used anywhere reachable from the internet.

| Account | Sign in at | Email | Password |
| --- | --- | --- | --- |
| Platform owner | `/admin/signin` | `owner@platform.test` | `demo-owner-2026` |
| Demo company admin | `/admin/signin` | `admin@demo.test` | `demo-admin-2026` |

The demo seed refuses a database that has `DATABASE_URL` set unless `ALLOW_DEMO_SEED=1`. With that override on a deployed database the demo owner and admin are created without a password; the seed prints their `/admin/invite/<token>` links instead, so no credential written in this repository opens them.

## Tests and checks

```sh
pnpm test        # unit tests
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e         # builds, seeds a temporary database, and drives the whole rep flow in a browser
pnpm e2e:admin   # the owner's path (company, admin, rep, lines, targets, published scheme, commission screen) and the demo company's admin path (overview order, coverage line, Excel upload, supervisor coverage, incentive and notification, isolation and role checks)
```

`pnpm e2e` and `pnpm e2e:admin` need Playwright installed globally; it is not a project dependency. It uses a temporary database directory (through `PGLITE_DIR`) that it removes at the end, so your `.data` is left alone, and it starts its own server on a free port.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm db:seed` | Loads the demo data (local database, or a deployed one only with `ALLOW_DEMO_SEED=1`). |
| `pnpm admin:create-owner <email> <name>` | Creates the platform owner and prints his `/admin/invite/<token>` link (valid 7 days). Run again for a new link. |
| `pnpm db:pilot <company id or exact name>` | Adds the six pilot lines and a draft November 2026 scheme to an existing company. Safe to run twice. |
| `pnpm e2e`, `pnpm e2e:admin` | Browser end-to-end runs on a temporary database (see above). |
| `node scripts/admin-screenshot.mjs <path> <out.png> [--locale ar\|en\|ur] [--as owner\|admin] [--create-company]` | Signs in to the admin console with the demo credentials of a local seed and saves a 1440x1000 screenshot of `<path>`. `BASE_URL` defaults to `http://localhost:3000`. |
| `node scripts/screenshot.mjs <path> <out.png> [--locale ar\|en\|ur]` | The same for a rep screen, signed in as the demo rep `ahmed`. |

Upload templates: `/admin/uploads` offers a downloadable `.xlsx` template for each kind (`/admin/uploads/template/targets` and `/admin/uploads/template/daily`, admin only). The file's first sheet takes the columns `login, year, month, line, amount` (monthly targets) or `login, date, line, amount` (daily sales and collection); the second sheet lists the company's line codes.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. When unset, the app uses a local PGlite database (see `PGLITE_DIR`). |
| `PGLITE_DIR` | Directory of the local PGlite database. Default `.data/pglite`. `pnpm e2e` points it at a temporary directory. |
| `APP_TODAY` | `YYYY-MM-DD`. Overrides "today" for demos, screenshots and `pnpm e2e`. |
| `ALLOW_APP_TODAY` | Set to `1` to honour `APP_TODAY` in a production build; otherwise it is ignored there. |
| `ALLOW_LOCAL_DB` | Set to `1` to let a production build (`NODE_ENV=production`) use the local PGlite database when `DATABASE_URL` is unset. Without it every database request of a production server fails with a clear error (the server itself boots; it never silently keeps data in a local folder). Needed for local production runs such as `pnpm e2e`. |
| `ALLOW_DEMO_SEED` | Set to `1` to let `pnpm db:seed` run while `DATABASE_URL` is set. Without it the seed refuses, because re-seeding resets used invites and adds demo rows. |

## Deploying

A deployed instance needs:

- `DATABASE_URL`, the Postgres connection string. Without it every database request of a production server fails with a clear error (it will not silently keep data in a local folder). Migrations from `drizzle/` run at start-up under a Postgres session advisory lock, so several instances can start together. That lock needs a session-level connection: use the **direct** connection string (Supabase port 5432), not the transaction pooler (port 6543), until a separate `MIGRATION_DATABASE_URL` is added in plan 4. The connection already uses `prepare: false`, so the pooler can be adopted for queries once migrations run on a direct connection.
- `NODE_ENV=production` (set by `next start`).
- Do not set `APP_TODAY` or `ALLOW_APP_TODAY`; they exist for demos and tests.

The demo seed is not part of a deployment. To seed a deployed database anyway (a staging copy, for example) set `ALLOW_DEMO_SEED=1` together with `DATABASE_URL`; without it `pnpm db:seed` refuses.

## Local database warning

The local PGlite database is single-process. Run only one thing against `.data/pglite` at a time: stop the dev server before seeding, and never seed while a server is running. `pnpm db:seed` does not reset the database by itself, so `rm -rf .data` first for a clean start. It also leaves existing rows as they are (for example supervisor links added to the seed later), so an already-seeded database keeps its old values.

## Sample data

All seeded names, targets and figures are synthetic. They are not real customers or results.

## What is built and what comes next

Built (plan 1, rep core): invite and PIN sign-in, month-calendar home with standing on each target line, typed day close with reconciliation, traceable commission with a what-if, history, and Arabic, English and Urdu.

Built (plan 2, admin): an admin console under `/admin` with its own email and password sign-in.

- The platform owner creates companies and each company's first admin.
- The admin manages users (reps, supervisors, other admins), company settings, target lines (sales, collection and coverage; units cases, value or outlets), monthly targets (a form or an Excel upload), coverage, focus items, policy documents, the monthly commission scheme (a structured editor with a live preview, versions and publish) and mid-month incentives that notify the reps.
- The admin uploads daily sales and collection figures from Excel. Rows are all-or-nothing and reported row by row. The admin's amount wins over the rep's for the same day and line, and the rep sees the difference; a close created by an upload stays a draft until the rep confirms it.
- The team overview ranks reps by distance from pace, computed by the same engine as the rep screens.
- A supervisor sees `/app/team` and records coverage (customers covered out of customers in the territory) for his reps; reps update their own coverage at `/app/coverage`.
- Reps get an in-app notifications page and a bell with the unread count.

Pilot setup on a real database (no demo data): `pnpm admin:create-owner`, then `pnpm db:pilot <company>` for the six pilot lines and a draft November scheme; see [docs/DEPLOY.md](docs/DEPLOY.md).

Next: photo and voice day close, an assistant that reads the policy documents; push notifications, install guide, offline use and a mobile supervisor view.

- Design: `docs/superpowers/specs/2026-11-14-salesman-assistant-design.md`
- Plans: `docs/superpowers/plans/`

## Deploying

Step-by-step pilot deployment (Supabase + Vercel, free tiers): [docs/DEPLOY.md](docs/DEPLOY.md).
