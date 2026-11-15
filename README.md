# Salesman Assistant

A personal assistant for field sales reps. Every day it tells the rep where he stands against his monthly targets, what is left, what to focus on, and what he will earn. It is mobile-first and Arabic-first (with English and Urdu), and the commission figure is calculated transparently so every amount can be traced. Data arrives with almost no effort from the rep; in this first version he types his day close.

## Requirements

- Node 22
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
pnpm e2e         # builds, seeds a fresh database, and drives the whole rep flow in a browser
```

`pnpm e2e` needs the Playwright that is pre-installed globally; it is not a project dependency. It deletes `.data`, so do not run it while a dev server is using that database.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. When unset, the app uses a local PGlite database in `.data/pglite`. |
| `APP_TODAY` | `YYYY-MM-DD`. Overrides "today" for demos, screenshots and `pnpm e2e`. |
| `ALLOW_APP_TODAY` | Set to `1` to honour `APP_TODAY` in a production build; otherwise it is ignored there. |
| `ALLOW_DEMO_SEED` | Set to `1` to let `pnpm db:seed` run while `DATABASE_URL` is set. Without it the seed refuses, because re-seeding resets used invites and adds demo rows. |

## Local database warning

The local PGlite database is single-process. Run only one thing against `.data/pglite` at a time: stop the dev server before seeding, and never seed while a server is running. `pnpm db:seed` does not reset the database by itself, so `rm -rf .data` first for a clean start.

## Sample data

All seeded names, targets and figures are synthetic. They are not real customers or results.

## What is built and what comes next

Built (plan 1, rep core): invite and PIN sign-in, month-calendar home with standing on each target line, typed day close with reconciliation, traceable commission with a what-if, history, and Arabic, English and Urdu.

Next: admin dashboard and Excel upload; photo and voice day close, assistant and policy documents; notifications, install guide, offline and supervisor view.

- Design: `docs/superpowers/specs/2026-11-14-salesman-assistant-design.md`
- Plans: `docs/superpowers/plans/`
