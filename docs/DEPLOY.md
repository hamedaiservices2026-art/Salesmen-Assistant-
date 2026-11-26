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
3. Environment variable (Production): `DATABASE_URL`, the direct connection string from step 1. The photo and AI features add more in section 7; without them the rest of the app works.

Do not set `APP_TODAY`, `ALLOW_APP_TODAY`, `ALLOW_DEMO_SEED`, `ALLOW_LOCAL_DB`, `AI_PROVIDER=fake`, `ALLOW_AI_FAKE` or `ALLOW_LOCAL_FILES` on Vercel: the first two pin "today" for demos and tests, the others exist for local runs and the offline end-to-end runs.

4. Deploy. The first request creates the tables (migrations run once, under a lock).

## 3. The owner's path (no demo data)

Production never loads the demo: it has accounts whose passwords would be public in the source.

1. **Create the platform owner.** Pick one of the two ways.

   **A. In the browser, no commands (the `/setup` page).**

   1. Make a setup code: a random string of at least 32 characters (for example 40 letters and digits from a password manager). Keep it private; anyone holding it can create the owner while the page is open.
   2. In Vercel open **Settings → Environment Variables**, add `SETUP_TOKEN` with that code, environment **Production** only, and save.
   3. **Redeploy** (Deployments → the latest one → Redeploy): a variable reaches the site only after a new deployment.
   4. Open `https://<your-vercel-domain>/setup`. Type the setup code, your email and your name, and press the button. The page shows your `/admin/invite/<token>` link once: open it, choose a password of at least 10 characters with at least 5 different characters, and you are signed in.
   5. **Delete `SETUP_TOKEN`** in Vercel and **redeploy** again.

   `/setup` answers "page not found" while `SETUP_TOKEN` is missing or shorter than 32 characters, and forever once any owner exists, even if the variable is still set. A wrong code shows only "not accepted" after about a second; five wrong codes in 15 minutes lock the page for 15 minutes (even the right code is refused then; wait and try again). The lock counts every visitor together, so a stranger who finds the open page can keep it locked by sending wrong codes; he cannot create the owner. If the page stays refused, use way B: the command does not go through the page's counter, so it is never locked out. The link is shown once and never logged; if you lose it before opening it, use way B for a new link.

   **B. With a command.** On any computer or cloud session that has the repo and Node 22 with pnpm (`pnpm install` first); `DATABASE_URL` is the string from step 1:

   ```bash
   DATABASE_URL='<direct connection string>' pnpm admin:create-owner you@example.com "Your Name"
   ```

   It prints `/admin/invite/<token>`. Open `https://<your-vercel-domain>` + that path and choose a password as above. Running it again for the same email issues a fresh link (and voids the old one).

   Either way you land in the console; later sign-ins are at `/admin/signin` with the email and password. The invite link expires after 7 days.

2. **Create the company.** In `/admin/companies` fill the company name, currency, time zone, default language and the first admin's name and email. The page shows that admin's invite link once; send it to him. He opens it and sets his own password.

3. **Optional: load the pilot structure.** On a computer with the repo (as in way B above), run

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
- With AI set up (section 7) the rep can record his day by a photo of the day-end report or a voice note, reviews the filled form and confirms it, attaches photos to returns, and asks the assistant about his numbers and the policy documents. Without it, typing works as before and the photo, voice and assistant buttons say they are unavailable.
- Arabic is the default; Settings switches to English or Urdu.
- A mid-month incentive created in `/admin/incentives` reaches each rep as an in-app notification (the bell on his home screen shows the unread count).
- Review the free-tier terms of the database and hosting services before entering real customer data.

## 6. Free tier and known limits

Nothing in the admin console is withheld for the free tier; every admin screen described above works on it. Known limits of this deployment:

- **One upload at a time per server instance.** The upload lock is in memory, per admin and per instance. A second upload from the same admin while one runs is told to wait; two instances (as on a serverless host) do not coordinate, but a file is still applied all-or-nothing inside the database.
- **Upload memory.** Reading a 2 MB `.xlsx` can use up to about 300 MB of memory. Keep the Vercel function memory at the plan's default or higher; a file that stays within the 2 MB and 5,000-row limits is the supported case.
- **A forgotten PIN or password needs a new link from the admin** (`New sign-in link` in `/admin/users`); for the owner, run `pnpm admin:create-owner` again (`/setup` works only before the first owner exists). The old PIN or password keeps working until the new link is opened.
- Migrations use the connection in `DATABASE_URL`; behind a transaction pooler they can hang. A separate migration URL is planned.

## 7. AI and photos

The AI features and the photos are optional. Nothing in sections 1 to 6 needs them, and a rep can always type his close.

### Owner's checklist

1. **Provide the keys** as **Production** variables in Vercel (Settings, Environment Variables): `GEMINI_API_KEY` and `GROQ_API_KEY`, and `OPENROUTER_API_KEY` only if you use OpenRouter. Redeploy afterwards: a changed variable applies to a new deployment.
2. **Run the smoke check once** on your computer, with the same keys in your shell: `AI_SMOKE=1 pnpm ai:smoke`. It lists the model ids each key can really use and makes one tiny call per job, and its table shows which model actually answered. The defaults were verified live on 2026-11-26 with the owner's keys: Gemini `gemini-4-hydrogen` (new, and it answered HTTP 503 "high demand" that day, so the app falls back to `AI_GEMINI_FALLBACK_MODEL`, default `gemini-3.5-flash-lite`, in the same request), Groq `whisper-large-v3`, OpenRouter `google/gemma-4-31b-it:free` (a free model with 20 requests per minute and 50 per day class limits; prompts sent to free models may be logged or used for training). Correct a model variable only if the smoke list shows a different id you want, and see `docs/ai-providers.md` for the recorded results.
3. **Create the private storage bucket** (below) and confirm that a photo uploads, loads and deletes. The Storage request shape the app uses was verified live on 2026-11-26 (see `docs/ai-providers.md`); do it once on your own project anyway.
4. **Check on a real iPhone in the first week** (below), and fill `/admin/ai/mapping` from the first real report.
5. **Review the notice wording** the reps and the admin see before AI is used (see "What is sent" below) and answer the questions in section 8.

### Private photo storage (Supabase Storage)

1. In the Supabase project open **Storage** and create a bucket named `private-files` with **public access off**. The app never creates buckets and never makes a public link; every photo is served only by `/files/<id>` to a signed-in person who may see it.
2. In Vercel set (Production): `STORAGE_DRIVER=supabase`, `SUPABASE_URL` (`https://<ref>.supabase.co`) and `SUPABASE_SERVICE_ROLE_KEY` (the project's server key: a `sb_secret_...` key, or a legacy `service_role` key). Set `STORAGE_BUCKET` only if you named the bucket differently. These are server variables: never give one a `NEXT_PUBLIC_` name, because such a variable is sent to every browser.
3. Without `STORAGE_DRIVER=supabase` a production build refuses the local disk (a serverless disk does not persist), so photo features fail with a storage error instead of losing photos. Do not set `ALLOW_LOCAL_FILES` on Vercel.
4. Test it: as a rep add a photo to a return, save the close, reopen it and check the thumbnail loads. A failure here, or in the first live upload, usually means a path or header of the Storage request (`src/server/files/supabase-store.ts` keeps them in one block at the top, noted in `docs/ai-providers.md`).

### The providers

- **Gemini** (Google AI Studio key) reads report photos and answers assistant questions, and is the fallback for voice. **Groq** turns voice recordings into text. **OpenRouter** is an optional second provider for photos and questions (used when `OPENROUTER_API_KEY` is set; default free model `google/gemma-4-31b-it:free`, override with `AI_OPENROUTER_VISION_MODEL` and `AI_OPENROUTER_CHAT_MODEL`). If Gemini's primary model answers overloaded (503) or rate limited (429), the same request is retried once on `AI_GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`; `none` turns it off) before OpenRouter is tried. `AI_GEMINI_THINKING` defaults to `low` (Gemini 3.x and 4 reject a thinking budget of 0).
- Hosts the deployment must be able to reach: `generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai` (only if used) and your `<ref>.supabase.co`. A request that cannot reach one is treated as a failed call and the next provider, if any, is tried.
- Photo, voice and assistant requests are allowed 60 seconds (`maxDuration`); Vercel's Hobby limit is well above that.

### Limits

- **The free tiers' own limits** (requests per minute and per day, and what a provider does with free-tier content) changed several times in the sources checked and are mostly UNVERIFIED: read the live pages and your AI Studio and Groq consoles, and see `docs/ai-providers.md`.
- **This product's limits**, whatever the providers allow: per rep per day 20 photos, 30 voice notes and 50 questions; per rep per minute 3, 5 and 6; per company per day 200, 300 and 500; for the whole deployment per day 400, 600 and 800 (`AI_GLOBAL_DAY_VISION`, `AI_GLOBAL_DAY_STT`, `AI_GLOBAL_DAY_CHAT`); and 40 photo uploads per rep per day. A failed request still counts. There is no deployment-wide per-minute limit until you set `AI_GLOBAL_MINUTE_VISION`, `AI_GLOBAL_MINUTE_STT` and `AI_GLOBAL_MINUTE_CHAT` (about 40 percent of the provider's verified per-minute limit once you have read it: one request can make up to 5 provider calls: two attempts on the primary model, one on Gemini's fallback model and two on the next provider, while the counters count it once).
- The admin sees today's use against the company limits, and the last 14 days, at `/admin/ai/usage`.

### What is sent

- A report photo (which can show customer names), a voice recording and a question with the rep's own figures, incentives and the company's policy text go to the AI providers to be read and answered. The rep's PIN and phone number are never sent by the app. Nothing a model returns is saved or shown as a figure until the rep has reviewed it and pressed confirm, or, for the assistant, until the app has checked every number against the rep's own figures. No model takes part in any calculation.
- **Free tiers may use what is sent to improve their services.** Google's pricing page lists "content used to improve our products" as yes for the free Gemini tier; the other providers' terms were not verified. The rep's notice and the admin's confirmation say this, and say it is free during the trial. If you move to a paid plan, update that wording in the three language catalogs and raise `AI_NOTICE_VERSION`, so reps accept it again.
- Each rep reads and accepts the notice once before his first use (and again whenever its version is raised); he can withdraw in Settings. The admin sees the same points before switching AI on for the company at `/admin/ai`.

### Switching AI off

- **Everything at once:** set `AI_DISABLED=1` as a Production variable and redeploy. No provider is called, whatever any company's setting says.
- **One company:** the admin presses "turn off" at `/admin/ai`. A new company starts with AI off. The photo, voice and assistant buttons then say they are unavailable and typing is unaffected.
- **One rep:** he withdraws his agreement in Settings.

### Never set in production

`AI_PROVIDER=fake`, `ALLOW_AI_FAKE`, `ALLOW_LOCAL_FILES`, `APP_TODAY`, `ALLOW_APP_TODAY`, `ALLOW_DEMO_SEED`, `ALLOW_LOCAL_DB`. The fake provider returns fixed sample figures, so a deployment that used it would show every rep the same invented numbers. Keys are never put in a variable whose name starts with `NEXT_PUBLIC_` and never in the repository.

### How long things are kept

| What | Kept | Notes |
| --- | --- | --- |
| Report photos | 30 days after the day they record | Only the rep who took one can open it. |
| Return photos | 180 days after the day they record | The rep, his supervisor and the admin can open them. |
| A photo not saved with a close | 24 hours | Then it is deleted. |
| Assistant conversations | 30 days | One rolling conversation per rep; the rep can clear it at any time; admins and supervisors never read it. |
| AI usage rows (counts and codes only, no text, no names in the admin view) | 90 days | |
| Daily counters | 3 days | |
| A draft's receipt (the proof a close was read for this rep and day) | Valid for 24 hours, deleted a day after it expires | |
| Voice recordings | Not kept | Only the text is used. |

Old items are cleared by `runMaintenance` (`src/server/maintenance.ts`). It runs after a photo upload or an assistant question, at most once every 10 minutes per server instance, so something may outlive its period until the next upload or question; meanwhile the app serves no photo past its retention and shows no conversation row older than 30 days. Plan 4 adds a scheduled job that calls the same function.

### What to check on a real iPhone in week one

Nothing below could be tested without a real device, so none of it is verified:

1. **Camera capture** for a return photo (the camera opens, the photo uploads) and choosing a report photo from the library or a screenshot.
2. **Voice recording**: Safari should record `audio/mp4`; check the permission prompt, a 10-second note, a note cut by locking the phone, and the file-picker fallback if recording is not offered.
3. **Arabic read-aloud**: whether the iPhone offers an Arabic voice. When it does not, the assistant shows the answer written and a hint, with no listen button.
4. **A real day-end report photo from the sales program** (the spec still lacks a sample): how well it is read, and which labels it uses.
5. **Real Arabic recordings in the rep's own dialect**: how well the numbers are heard, and what the voice reader gets wrong.

When the first real report is available, open `/admin/ai/mapping` and write each field's name exactly as the report prints it, so reading from photos becomes more accurate.

## 8. Questions for the owner

Each has a working default and none blocks the build.

1. **The notice the rep reads before using AI.** Is the Arabic wording acceptable (`ai.notice` in `src/i18n/messages/ar.json`), and should the company's name or a contact person appear in it? Please review it and the data-use sentence about free tiers.
2. **Who may see photos.** Default: a report photo only by the rep who took it; return photos by him, his supervisor and the admin. Should admins also see report photos?
3. **How long to keep things.** Defaults: report photos 30 days, return photos 180 days, conversations 30 days, usage counts 90 days. Does the company need return photos for longer (for claims with suppliers)?
4. **Voice recordings.** Default: not kept. Keep them for a few days so a disputed number can be replayed?
5. **"What reps ask most" for a small team.** Default: a topic appears only when 3 different reps asked it, so with one pilot rep the card stays empty. Show topics anyway during the pilot?
6. **AI on by default.** Default: off for every new company until its admin turns it on. Should the pilot company start with it on?
7. **Daily limits.** Defaults per rep: 20 photos, 30 voice notes, 50 questions a day. Enough for the pilot rep?
8. **Free services and customer names.** The design accepts free tiers for the pilot, and a report photo can show customer names. Does the pilot company agree in writing, or should photos wait for a paid tier?
9. **Reading aloud.** Default: the phone's own voice; no button when the phone has no Arabic voice. If the pilot rep's iPhone has none, is a server voice (possibly paid later) wanted?
10. **Returns and focus items in a photo.** Default: the rep types them. Should a later version try to read them from the report?
11. **The real report.** Screenshots of the sales program's day-end report are still needed (design spec section 13, item 3) to fill the label mapping and to test reading on real photos, and real Arabic voice notes from the rep to test the dialect.
