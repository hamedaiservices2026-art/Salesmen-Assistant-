# Salesman Assistant

A personal assistant for field sales reps. Every day it tells the rep where he stands against his monthly targets, what is left, what to focus on, and what he will earn. It is mobile-first and Arabic-first (with English and Urdu), and the commission figure is calculated transparently so every amount can be traced. Data arrives with almost no effort from the rep; in this first version he types his day close.

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

`pnpm db:seed` prints two invite paths (`/invite/<token>`). Open Ahmed's invite on `http://localhost:3000`, choose a 6-digit PIN, and you are signed in. Later sign-ins use the login `ahmed` and that PIN. The seed is fixed to November 2026, so for a demo set `APP_TODAY=2026-11-14` before `pnpm dev`.

## Tests and checks

```sh
pnpm test        # unit tests
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e         # builds, seeds a temporary database, and drives the whole rep flow in a browser
```

`pnpm e2e` needs Playwright installed globally; it is not a project dependency. It uses a temporary database directory (through `PGLITE_DIR`) that it removes at the end, so your `.data` is left alone, and it starts its own server on a free port.

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

Next: admin dashboard and Excel upload; photo and voice day close, assistant and policy documents; notifications, install guide, offline and supervisor view.

- Design: `docs/superpowers/specs/2026-11-14-salesman-assistant-design.md`
- Plans: `docs/superpowers/plans/`

## Deploying

Step-by-step pilot deployment (Supabase + Vercel, free tiers): [docs/DEPLOY.md](docs/DEPLOY.md).
