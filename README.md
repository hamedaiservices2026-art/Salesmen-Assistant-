# Salesman Assistant

A personal assistant for field sales reps. Every day it tells the rep where he stands against his monthly targets, what is left, what to focus on, and what he will earn. It is mobile-first and Arabic-first (with English and Urdu), and the commission figure is calculated transparently so every amount can be traced. The rep records his day close by a photo of the day-end report, by a voice note, or by typing, and reviews what was read before it is saved; he can also ask an assistant about his own numbers, the month's incentives and the company's policy documents. The company's admin can also upload the day's figures from Excel.

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

## Trying the AI features locally (no key, no network)

The demo company has AI switched on; the other company has it off. Start the app with the offline fake provider and the demo date:

```sh
APP_TODAY=2026-11-14 AI_PROVIDER=fake pnpm dev
```

Sign in as Ahmed, open the close screen and tap the report-photo or voice button; the first time he reads and accepts a short notice. The fake provider is a fixed function of what it is sent, so a run is repeatable:

- A report photo that is 640 pixels wide reads as the sample report dated 14 November (beverages 118, food 7,900, collection 19,500, cash sales 14,800, credit sales 3,200 flagged for checking). 641 pixels wide reads as a poor scan dated 12 November, with several fields unreadable. 642 pixels wide gives an unreadable reply. `scripts/fixtures/report-640.jpg` and `report-641.jpg` are the first two; any other width reads like 640.
- Any voice recording is heard as a fixed sample sentence ("مشروبات مية وعشرين كرتونة، أغذية ٨٢٥٠ ريال، تحصيل عشرين ألف، نقدي خمسة آلاف وخمسمية"), which the app reads into beverages 120, food 8250, collection 20000 and cash sales 5500.
- The assistant answers from the rep's real figures and the demo policy by matching words of the question to the labels of those figures; a question with no matching word gets "not sure". Suggested questions are on the screen. A question containing `[[fake:obey]]` makes the fake invent a figure, which the app refuses to show.

Photos are kept in `.data/files` (`FILES_DIR`). Without `AI_PROVIDER=fake` and without keys, AI reads as unavailable and typing works as before. A real provider needs its key variable (table below); see [docs/ai-providers.md](docs/ai-providers.md) for what has and has not been verified.

## Tests and checks

```sh
pnpm test        # unit tests
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e         # builds, seeds a temporary database, and drives the whole rep flow in a browser
pnpm e2e:admin   # the owner's path (company, admin, rep, lines, targets, published scheme, commission screen) and the demo company's admin path (overview order, coverage line, Excel upload, supervisor coverage, incentive and notification, isolation and role checks)
pnpm e2e:ai      # the AI features with the offline fake provider: photo and voice close, return photos and who may open them, the assistant, the admin's switch and usage
```

`pnpm e2e`, `pnpm e2e:admin` and `pnpm e2e:ai` need Playwright installed globally; it is not a project dependency. Each uses a temporary database directory (through `PGLITE_DIR`) that it removes at the end, so your `.data` is left alone, and starts its own server on a free port. `pnpm e2e:ai` also uses a temporary photo folder, runs Chromium with a fake microphone, and fails if the browser tries to reach any host other than that local server. `E2E_AI_SKIP_BUILD=1 pnpm e2e:ai` reuses the last build when you are only editing the script.

`pnpm test` also holds two repository-wide checks (`src/boundaries.test.ts`): the provider and storage key variable names appear only where they are read (`src/server/ai/config.ts`, `src/server/files/store.ts`), in the smoke script, tests, `.env.example` and the documents; and no browser (`"use client"`) file imports `@/server/ai/**` or `@/server/files/**`, or takes a value import from any other `@/server/**` module except `upload-request-shared`.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm db:seed` | Loads the demo data (local database, or a deployed one only with `ALLOW_DEMO_SEED=1`). |
| `pnpm admin:create-owner <email> <name>` | Creates the platform owner and prints his `/admin/invite/<token>` link (valid 7 days). Run again for a new link. |
| `pnpm db:pilot <company id or exact name>` | Adds the six pilot lines and a draft November 2026 scheme to an existing company. Safe to run twice. |
| `pnpm e2e`, `pnpm e2e:admin`, `pnpm e2e:ai` | Browser end-to-end runs on a temporary database (see above). |
| `AI_SMOKE=1 pnpm ai:smoke` | Opt-in check of the real AI providers with your keys: lists the models each key can use and makes one tiny call per job. It makes real, possibly billed, requests, so it never runs in tests or CI (it refuses when `CI` is set). Prints no key and no response body. |
| `node scripts/make-fixtures.mjs` | Regenerates the two sample report images in `scripts/fixtures/` (committed; only needed if you change them). |
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
| `GEMINI_API_KEY` | Google AI Studio key: reads report photos and answers assistant questions (and is the fallback for voice). Server only; set it as a Production variable, never as `NEXT_PUBLIC_*`. Unset: that provider is not used. |
| `GROQ_API_KEY` | Groq key: turns voice recordings into text. Server only, as above. |
| `OPENROUTER_API_KEY` | Optional second provider for photos and questions. It is used for photos only when `AI_OPENROUTER_VISION_MODEL` is also set, and for questions only when `AI_OPENROUTER_CHAT_MODEL` is. Server only. |
| `AI_PROVIDER` | `fake` selects the offline fake provider (tests, demos, `pnpm e2e:ai`). In a production build it is ignored (AI is off) unless `ALLOW_AI_FAKE=1`. Never for a real deployment. |
| `ALLOW_AI_FAKE` | `1` lets a production build use the fake provider (end-to-end runs only). Never set it on a deployment. |
| `AI_DISABLED` | `1` switches AI off for the whole deployment, whatever any company's setting says. |
| `AI_GEMINI_VISION_MODEL`, `AI_GEMINI_CHAT_MODEL`, `AI_GEMINI_AUDIO_MODEL` | Gemini model ids for photos, questions and the voice fallback. Default `gemini-3.5-flash-lite`, which is UNVERIFIED (see `docs/ai-providers.md`). |
| `AI_GROQ_STT_MODEL` | Groq model id for voice. Default `whisper-large-v3`. |
| `AI_OPENROUTER_VISION_MODEL`, `AI_OPENROUTER_CHAT_MODEL` | OpenRouter model ids. No default: OpenRouter is not used until both a key and the id are set. |
| `AI_GEMINI_THINKING` | `off` (default), `low`, `default` or a whole token budget: how Gemini's thinking tokens are limited. |
| `AI_CONTEXT_MAX` | Characters of context one assistant question may send, 5000 to 60000 (default 60000). Lower it if the chat provider's tokens-per-minute limit is hit. |
| `AI_GLOBAL_DAY_VISION`, `AI_GLOBAL_DAY_STT`, `AI_GLOBAL_DAY_CHAT` | Daily requests for the whole deployment, per kind (photos, voice, questions). Defaults 400, 600, 800. |
| `AI_GLOBAL_MINUTE_VISION`, `AI_GLOBAL_MINUTE_STT`, `AI_GLOBAL_MINUTE_CHAT` | Requests per minute for the whole deployment, per kind. No default (no deployment-wide minute limit until set). Set each to about 80 percent of the provider's own limit. |
| `STORAGE_DRIVER` | `local` (default) or `supabase`: where private photos are kept. |
| `FILES_DIR` | Folder for the local driver. Default `.data/files`. |
| `ALLOW_LOCAL_FILES` | `1` lets a production build use the local folder (a single server with a lasting disk, or `pnpm e2e` and `pnpm e2e:ai`). A production build otherwise refuses it. Not for Vercel. |
| `SUPABASE_URL` | `https://<ref>.supabase.co`, for `STORAGE_DRIVER=supabase`. |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase server key (`sb_secret_...`, or a legacy `service_role` key) for `STORAGE_DRIVER=supabase`. Server only; never `NEXT_PUBLIC_*`. |
| `STORAGE_BUCKET` | The private bucket name. Default `private-files`. The app never creates buckets or public links. |

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

Built (plan 3, AI): the rep records his day by a photo of the day-end report or a voice note, and gets the same form he would have typed, pre-filled as a draft. He reviews it; a figure the reader was unsure of must be acknowledged, a report dated another day must have its date confirmed, and nothing is saved until he presses confirm. Returns carry photos, kept privately and served only to the people allowed to see them. The assistant answers by text or voice from the rep's own figures, the month's incentives and the policy documents, with citations, checks every number it shows against those figures, and reads answers aloud with the phone's own voice; an incentive notification has an "explain simply" button. The admin switches AI on or off for the company, maps report labels to fields (`/admin/ai/mapping`), sees usage against the daily limits (`/admin/ai/usage`), and sees which topics reps ask about most, without names and only for topics asked by at least 3 reps. No model takes part in any calculation. Old photos, conversations, usage rows and counters are cleared by `runMaintenance` (`src/server/maintenance.ts`), which runs after photo uploads and assistant questions, at most once every 10 minutes per server instance.

Pilot setup on a real database (no demo data): `pnpm admin:create-owner`, then `pnpm db:pilot <company>` for the six pilot lines and a draft November scheme; see [docs/DEPLOY.md](docs/DEPLOY.md).

Next (plan 4): push notifications, install guide, offline use (including a queue for a confirmed close), a scheduled job for `runMaintenance` and a mobile supervisor view.

- Design: `docs/superpowers/specs/2026-11-14-salesman-assistant-design.md`
- Plans: `docs/superpowers/plans/`

## Deploying

Everything a deployment needs (the direct `DATABASE_URL`, variables that must not be set in production such as `APP_TODAY`, `ALLOW_APP_TODAY` and `ALLOW_DEMO_SEED`, and why the demo seed stays out of it): [docs/DEPLOY.md](docs/DEPLOY.md).
