# Salesman Assistant — Design

Date: 2026-11-14 · Status: awaiting owner review · Working name: "Salesman Assistant" (final name undecided)

Product truth lives in `PRODUCT.md`. This document is the design a builder plans from. Items marked **(owner)** were decided by the product owner; items marked **(call)** are the designer's calls and can be overturned.

## 1. Intent

Field sales reps for FMCG distributors in Saudi Arabia work all day in a sales force automation (SFA) app, but at the end of the day they do not know where they stand against their monthly targets, what is left, what to focus on, or what they will earn. This product is a personal assistant that sits beside the SFA app and answers those questions every day, so the rep achieves more. It is sold to companies; reps and supervisors use a mobile app and admins use a web dashboard.

The pilot is one rep whose company uses SalesBuzz. There is no integration in the pilot.

## 2. Goals, non-goals, anti-goals

**Goals**

- A rep sees, in seconds, his standing on each target line: achieved, where he should be today, what is left, and the rate he needs per remaining selling day.
- Recording the day takes under a minute: photo of the day-end report, a voice note, or typing.
- The commission figure is exact and traceable to the company's rules, with a what-if simulator.
- The company can push focus items, incentives (including mid-month), and notifications.
- An assistant answers from the rep's own numbers, explains incentives in plain words, gives selling tips, and answers policy questions from the company's documents with the source cited.
- Arabic first (right-to-left), English, Urdu as an option.
- Runs on free tiers during the pilot.

**Non-goals (phase 1)**

- Replacing the SFA app: no order taking, invoicing, or route planning.
- Direct SFA integration. Excel upload is the bridge.
- Customer-level and van-stock-level data (phase 2).
- Native App Store and Play Store builds (the code is kept ready for wrapping).

**Anti-goals**

- Making the rep retype what the company system already has.
- A commission number the rep cannot trust or trace.
- A generic, template-looking interface.
- A thin product: "simple" means simple presentation, not fewer capabilities.

## 3. Constraints

- **(owner)** Market is Saudi Arabia; currency SAR, configurable per company.
- **(owner)** Targets are flexible: each rep has target lines, each line measured in cases or in value (SAR). One rep can mix both.
- **(owner)** One app for the rep. Supervisor uses the same mobile app. Admin is a web dashboard.
- **(owner)** Most users are on iPhone; the app must work well there.
- **(owner)** Free tiers only for AI services in the pilot.
- **(owner)** Cloud only, built directly from the GitHub repository.
- **(owner)** Visual direction: "Month sheet" (the month drawn as a calendar, one cell per selling day), in a blue, white, and red palette. See section 9.
- iOS limits: web push works only after the app is added to the Home Screen (iOS 16.4+), and installation is a manual step. The app must guide the rep through it.

## 4. Approaches considered

| Approach | Trade-off | Outcome |
|---|---|---|
| Telegram bot with mini app | Fastest, free messaging; needs Telegram, weak offline, a second app | Rejected: owner wants one app |
| PWA only | One codebase, instant updates; manual install on iPhone | Basis of the chosen approach |
| **PWA now, wrap for stores later** | Same speed as PWA; store builds when a company asks, Apple account needed only then | **Chosen (owner)** |
| Native from day one | Best iPhone experience; slowest, separate admin build | Rejected for the pilot |

## 5. Users and roles

| Role | Surface | Can do |
|---|---|---|
| Rep | Mobile app | See own standing, record the day, view commission, use the assistant, receive notifications, view history |
| Supervisor | Mobile app (team view added) | Everything a rep can for himself if he also sells, plus: see team standing, send focus and notifications to his reps |
| Company admin | Web dashboard | Manage users, target lines, targets, selling calendar, commission schemes, incentives, policy documents, Excel uploads, notifications |
| Platform owner | Web dashboard | Create companies and their first admin **(call)** |

Sign-in **(call)**: the admin creates a user and gets an invite link or QR code. The rep opens it on his phone, sets a 6-digit PIN, and stays signed in on that device. No SMS (SMS costs money). Admins sign in with email and password.

## 6. Core concepts and rules

**Company.** Everything is scoped to a company (tenant). Settings: currency, default language, selling week (for example Saturday to Thursday), holidays, time zone (Asia/Riyadh).

**Period.** A calendar month per company, with its list of selling days derived from the selling week and holidays.

**Target line.** Defined by the company: a name (for example "Beverages", "Food", "Collection"), a unit (`cases` or `value`), and a kind (`sales` or `collection`). Collection lines are always `value`.

**Target.** An amount for a rep, a period, and a target line.

**Daily close.** One per rep per selling day. Holds an amount per target line, plus cash sales, credit sales, collections, expenses, stock loaded, sold, and returned. Has a source (`photo`, `voice`, `manual`, `excel`) and a status (`draft`, `confirmed`). A close from Excel and a close from the rep for the same day: the Excel value wins for line amounts and the rep is shown the difference **(call)**.

**Pace.** For a line: expected so far = target × elapsed selling days ÷ total selling days, where elapsed counts completed selling days before today. Remaining = target − achieved. Required daily rate = remaining ÷ selling days left including today. Status: ahead (achieved ≥ expected), slightly behind (within 10% of target below expected), behind (more) **(call on thresholds; configurable)**. A day "hit" its rate when the day's amount ≥ target ÷ total selling days.

**Lines stand alone.** There is no single combined percentage across lines with different units. The home screen shows one line at a time with a selector **(call)**. How lines combine into pay is the commission scheme's job.

**Focus item.** Set by admin or supervisor: a product or free-text item, a target amount with unit, a date range, and the reps it applies to. Progress comes from the rep's day close (optional per-item entry) or Excel.

**Commission scheme.** Rules, not AI. A scheme belongs to a company and a period and is a list of components. Component types for phase 1:

- `tiered`: based on achievement percent of a line (or collection); a table of thresholds to fixed amounts or to a percent of achieved value.
- `per_unit`: an amount per case or a percent of value on a line, optionally only above a threshold.
- `bonus`: a fixed amount when a condition is met inside a date range (this is how a mid-month incentive is modeled).
- `gate`: a condition that must hold or the listed components pay zero (for example collection ≥ 80%).

The engine returns, for each component, the inputs used, the rule applied, and the amount, so the rep can see where every riyal comes from. It also computes: projected month-end at current pace, payout at 100%, the nearest win (the cheapest unmet threshold in sales terms), and a what-if for a chosen daily rate.

**Incentive.** A `bonus` component added during the period. Adding one notifies the affected reps and gives them a plain-language explanation.

**Reconciliation.** Shown at day close: cash to hand over = cash sales + collections − expenses; stock left = loaded − sold + returned.

**Returns.** Logged in the day close: quantity, reason (expired, damaged, other), photos.

**History.** Any past day or month: closes, totals, commission.

## 7. Surfaces

### Rep mobile app

1. **Home.** Line selector; headline achieved versus target; status chip; the month calendar (signature element) with each selling day marked hit or below, today marked, days off muted; today's required amount; focus items; button to record the day.
2. **Day close.** Three ways in: photo, voice, typing. Photo and voice produce a filled form the rep reviews and corrects before confirming. Returns with photos. Reconciliation panel.
3. **Commission.** Projected month-end amount; the breakdown with the rule behind each amount; tier tables; nearest win; what-if stepper.
4. **Assistant.** Chat by text or voice, with read-aloud. New incentives appear as a card with "explain simply". Policy answers cite the document and section. Suggested questions.
5. **History.** Months and days.
6. **Notifications** and **settings** (language, PIN, install guide).

First run: an install guide with pictures for iPhone ("Share, then Add to Home Screen") and a prompt to allow notifications after install.

### Supervisor (same app)

A team tab: each rep's standing per line sorted by distance from pace, who has not closed today, send a focus item or message. Tapping a rep opens that rep's home view read-only.

### Admin web dashboard

Overview (team indicators, reps table, active incentives, what reps ask the assistant most, last upload), Users, Target lines and targets, Selling calendar, Commission schemes and incentives, Policy documents, Excel upload (with downloadable templates and a row-by-row error report), Notifications, Company settings. Platform owner additionally sees Companies.

### Behavior at the edges **(calls)**

- **No targets yet:** the home screen explains that targets have not been uploaded and still lets the rep record his day.
- **Target changed mid-month:** a new upload replaces the target; pace is recalculated from the new figure; the change is logged.
- **Missed day close:** the calendar shows that selling day as "not recorded" (distinct from below-rate) and the rep can fill it in later.
- **Notifications:** every notification is stored in an in-app list. Push is sent in addition when the device allows it.
- **Company-written content** (incentive text, focus item names, policy documents) is shown as written. The assistant explains it in the rep's language on request.
- **Scheme editing:** a structured form for the four component types, with a preview against a sample rep before publishing. Publishing a change mid-period recalculates and records who changed it.
- **Photo and voice drafts** are never saved as confirmed without the rep pressing confirm. Low-confidence fields are highlighted.
- **Photos and documents** are stored privately and served only to users of the same company with the right role.

## 8. Data sources

| Source | Who | Notes |
|---|---|---|
| Excel upload | Admin | Templates for targets and for daily sales and collections per rep per line. Validated, with an error report. |
| Photo of day-end report | Rep | Vision model extracts fields to a draft; rep confirms. The real SalesBuzz report layout is unknown until screenshots arrive, so extraction is prompt-driven and field mapping is editable. |
| Voice note | Rep | Transcribed, then parsed to the same draft form. |
| Typing | Rep | Same form. |

## 9. Visual direction

- **World (owner):** the month as a wall-calendar sheet. The calendar is the one signature element; layout, navigation, and controls stay standard.
- **Palette (owner):** blue, white, red, taking the blue from the Pepsi logo family as inspiration only, with no Pepsi marks or logo. Working values **(call)**: blue `#0B4EA2` for the shell, hit days, and primary actions; blue tint `#E6EEF9`; ink `#0E1B2E`; secondary text `#47566B`; red `#9B1220` on `#FBE3E5` reserved for alerts (behind pace, badges). The owner mentioned an earlier palette from a motion-graphics project; it could not be located, so these values stand until supplied.
- **Type (call):** Alexandria for Arabic and Latin; Noto Nastaliq Urdu for Urdu. Western digits, tabular numerals.
- **Scene:** outdoors in daylight, one hand, so a light theme with high contrast and touch targets of at least 44px.
- Approved mockup: the "Home" board on the design canvas. Earlier boards are reference only.

## 10. Architecture

**(call, owner delegated the stack)**

- One Next.js (App Router, TypeScript) application: rep and supervisor app at `/app`, admin at `/admin`, server routes for AI, imports, and push. Deployed to Vercel from GitHub.
- Supabase as managed Postgres and file storage (private buckets for photos and documents). Sign-in, sessions, and company and role scoping are implemented in the application's server code (hashed PINs and passwords, http-only session cookies, rate-limited sign-in), not in Supabase Auth or row-level security. Reason: the invite-plus-PIN sign-in is custom anyway, and the whole data layer can then be tested against a plain local Postgres.
- Every data access goes through a server-side layer that requires the caller's company and role; no table is queried without a company filter.
- PWA: web manifest, service worker (offline shell, last-loaded data, queued day close), web push with VAPID keys.
- Internationalization with message catalogs for `ar`, `en`, `ur`; direction set per language.
- Commission and pace logic as pure, dependency-free TypeScript modules with unit tests. No AI in any calculation.
- Scheduled jobs (Vercel cron): morning brief and end-of-day reminder notifications.

**AI services** sit behind one provider interface so a provider or model can be changed by configuration:

| Job | Primary (free tier) | Fallback | Notes |
|---|---|---|---|
| Read report photo | Gemini 4 Hydrogen (`gemini-4-hydrogen`) | A free vision model on OpenRouter | Returns structured fields plus confidence; never auto-confirms |
| Voice note to text | Groq Whisper large v3 | Gemini audio input | Arabic dialect accuracy unverified; test with real recordings in week one |
| Assistant answers | Gemini 4 Hydrogen | OpenRouter free model | Given the rep's computed figures and policy text; must not compute money itself |
| Read aloud | Device speech synthesis | Gemini text to speech | Arabic voice quality on iPhone unverified; test in week one |

Policy answers **(call)**: company documents are stored as text sections. For phase 1 the relevant documents are passed to the model directly (they are short), with section labels so answers can cite them. Search over sections is added only if documents outgrow that.

Free tiers may use submitted data to improve the provider's products. Acceptable for the pilot; move to paid tiers when a company signs.

## 11. Phases

**Phase 1 (pilot):** everything in sections 5 to 10: rep app, supervisor view, admin dashboard, Excel upload, commission engine, assistant, notifications, install guide, three languages.

**Phase 2 (needs company data):** customers (who has not bought, lapsed items, notes), van stock (load suggestions, near-expiry alerts), team ranking and contests, competitor photos, expenses and cheque reminders in depth, net pay estimate, direct SFA integration, store builds.

## 12. Left to the builder

- Exact schema, table names, and migrations.
- Component structure and state management.
- Prompt wording for extraction and the assistant.
- Excel template column layout (must cover: rep identifier, date, target line, amount).
- Offline queue mechanics.

## 13. Open items needing the owner

1. A Supabase project and a Vercel project connected to the repository (free tiers).
2. API keys for Gemini and Groq.
3. Screenshots of the SalesBuzz day-end report, to tune photo extraction.
4. The pilot company's real commission rules, to enter as the first scheme.
5. The palette from the earlier motion-graphics project, if it should replace the working values.
6. Product name.
