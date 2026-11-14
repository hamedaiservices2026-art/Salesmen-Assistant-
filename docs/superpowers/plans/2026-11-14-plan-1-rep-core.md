# Plan 1: Rep Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rep can sign in with an invite and PIN, see his standing on each target line on the month-calendar home screen, record his day by typing, see a traceable commission with a what-if, and browse history, all on seeded sample data.

**Architecture:** One Next.js App Router application. Business rules (selling calendar, pace, commission, reconciliation) are pure TypeScript modules under `src/domain` with no framework or database imports. A server layer under `src/server` owns sign-in, sessions, and company-scoped data access through Drizzle. The database is Postgres in production and PGlite (in-process Postgres) in tests and local development, selected by whether `DATABASE_URL` is set.

**Tech Stack:** Node 22, pnpm, Next.js 16, TypeScript (strict), Tailwind CSS 4, next-intl 4, Drizzle ORM 0.45 with drizzle-kit, `@electric-sql/pglite`, `postgres`, zod 4, Vitest 5, lucide-react, `@fontsource-variable/alexandria`, `@fontsource/noto-nastaliq-urdu`.

**Spec:** `docs/superpowers/specs/2026-11-14-salesman-assistant-design.md` (product truth in `PRODUCT.md`). Mockups for structure and exact values: `docs/design/*.mockup.html`.

**This is plan 1 of 4.** Later plans, written when this one lands: (2) admin dashboard, Excel upload, scheme and incentive editing; (3) AI: photo and voice day close, assistant, policy documents; (4) notifications, install guide, offline, supervisor view.

## Global Constraints

- All quantities are integers. Lines with unit `cases` store case counts. Lines with unit `value` store minor units (halalas; 100 per SAR). No floating-point money anywhere in `src/domain`.
- Currency default `SAR`; time zone default `Asia/Riyadh`; "today" is always computed in the company's time zone.
- Languages: `ar` (default, right-to-left), `en`, `ur` (right-to-left). Every user-visible string comes from `src/i18n/messages/*.json`; no hard-coded copy in components. Digits are always Western (`0-9`).
- Arabic copy is plain spoken Egyptian-Gulf neutral Arabic as in the mockups (for example "قفلة اليوم", "متأخر", "النهارده محتاج تبيع").
- Layout uses CSS logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`), never `left` or `right`.
- Colors (exact): blue `#0B4EA2`, blue hover `#083A7A`, blue tint `#E6EEF9`, pale cell `#E3ECF8`, cell ink `#1B3358`, ink `#0E1B2E`, secondary text `#47566B`, muted `#5B6A80`, line `#D8DFE9`, soft line `#E3E8F0`, header secondary text `#D5E3F5`, red text `#9B1220`, red tint `#FBE3E5`, white `#FFFFFF`. Red is used only for alerts.
- Type: Alexandria for `ar` and `en`; Noto Nastaliq Urdu for `ur`. Minimum text size 12px; touch targets at least 44px; tabular numerals on all figures.
- Icons: lucide-react only, stroke width 1.8 to 2. No emoji.
- Every database query takes a `Ctx` and filters by `ctx.companyId`. A rep can read and write only his own rows.
- Sample data is synthetic. Seeded names and figures must not be presented as real customers or results.
- The framework is newer than most references. When a Next.js, next-intl, Drizzle, or Tailwind API is uncertain, read the installed package's own docs or types under `node_modules` before guessing.
- Commit after every task with a message describing the change. Do not put model identifiers in commits or code.

## Review Focus

1. **First and last selling day, or no days elapsed:** pace and projection must not divide by zero; on day one "expected so far" is 0 and projection uses the target-rate fallback defined in Task 5.
2. **Missing or zero target for a line:** no `NaN`, no crash; the line shows "no target yet" and still accepts day closes.
3. **Same day submitted twice (double tap, retry):** one close per rep per date; the second submit updates, never duplicates.
4. **A rep asking for another rep's or another company's data by changing an id or URL:** refused.
5. **Numbers typed with Arabic-Indic digits or separators** (`١٢٠`, `1,140`, `82٬800`): parsed to the right integer; anything else is rejected with a message, not saved as 0.

---

## Shared sample data (used by tests and the seed)

Company "Demo Distribution Co." · SAR · `Asia/Riyadh` · selling weekdays Saturday to Thursday (JS `getDay()` values `[6,0,1,2,3,4]`) · no holidays. Period November 2026: 26 selling days. "Today" in tests: `2026-11-14` (elapsed selling days 11, remaining including today 15).

Rep "Ahmed" (`ahmed`). Lines and targets:

| Line id | Name (ar / en) | Unit | Kind | Target | Achieved (1–12 Nov) |
|---|---|---|---|---|---|
| `bev` | مشروبات / Beverages | cases | sales | 3000 | 1140 |
| `food` | أغذية / Food | value | sales | 18 000 000 (180,000 SAR) | 8 280 000 |
| `coll` | تحصيل / Collection | value | collection | 45 000 000 (450,000 SAR) | 18 900 000 |

Daily amounts for selling days 1,2,3,4,5,7,8,9,10,11,12 Nov:

- `bev`: 96, 118, 104, 122, 88, 110, 121, 92, 99, 84, 106
- `food` (SAR): 7200, 8100, 7400, 7900, 6800, 7600, 8300, 7100, 7500, 7000, 7900
- `coll` (SAR): 17000 on each of the first ten days, 19000 on 12 Nov

Focus items: `cola` "كولا 330 مل علب" target 400 cases, 1–30 Nov, achieved 120. `mango` "عصير مانجو 1 لتر" target 200 cases, 1–20 Nov, achieved 120.

Commission scheme "November 2026" (amounts in halalas):

- `c_bev` tiered on `bev`: ≥80% pays 150 000; ≥90% pays 250 000; ≥100% pays 400 000.
- `c_food` per_unit on `food`: 50 basis points of achieved value.
- `c_coll` tiered on `coll`: ≥90% pays 100 000.
- `c_mango` bonus: focus item `mango` ≥ 200 between 2026-11-01 and 2026-11-20 pays 50 000.
- `g_coll` gate: `coll` ≥ 60%, applies to `c_bev`.

---

### Task 1: Project scaffold, tokens, and fonts

**Files:**
- Create: Next.js app at the repository root (`package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`), `vitest.config.ts`, `src/ui/tokens.css`, `.gitignore`, `.env.example`, `README.md`
- Test: `src/ui/tokens.test.ts`

**Interfaces:**
- Produces: scripts `pnpm dev`, `pnpm build`, `pnpm test` (Vitest, node environment, `src/**/*.test.ts`), `pnpm lint`, `pnpm typecheck`. CSS custom properties in `src/ui/tokens.css`, exposed to Tailwind 4 through `@theme`: `--color-brand`, `--color-brand-hover`, `--color-brand-tint`, `--color-cell`, `--color-cell-ink`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-line`, `--color-line-soft`, `--color-on-brand-2`, `--color-alert`, `--color-alert-tint`, carrying the exact values in Global Constraints (in that order). Font families `--font-sans` (Alexandria Variable) and `--font-urdu` (Noto Nastaliq Urdu), self-hosted from the fontsource packages. Path alias `@/*` → `src/*`.

- [ ] **Step 1:** Scaffold with `pnpm create next-app@latest` (TypeScript, App Router, `src/` directory, Tailwind, ESLint, no Turbopack-specific config needed), preserving the existing `PRODUCT.md` and `docs/`. Add the dependencies in Tech Stack. Enable `strict` and `noUncheckedIndexedAccess`.
- [ ] **Step 2:** Write `src/ui/tokens.test.ts`: read `src/ui/tokens.css` as text and assert it contains `--color-brand: #0B4EA2`, `--color-alert: #9B1220`, `--color-ink: #0E1B2E`, and `--color-cell: #E3ECF8`. Run `pnpm test`; expect FAIL (file missing).
- [ ] **Step 3:** Create `tokens.css`, import it and the font packages from `globals.css`, set `body` to `--font-sans`, background white, color `--color-ink`, `font-variant-numeric: tabular-nums`. Root layout renders `<html lang="ar" dir="rtl">` for now (Task 2 makes it dynamic). `page.tsx` shows the product working name in a blue header band.
- [ ] **Step 4:** Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; all pass.
- [ ] **Step 5:** Commit.

### Task 2: Languages and number formatting

**Files:**
- Create: `src/i18n/config.ts`, `src/i18n/request.ts`, `src/i18n/messages/ar.json`, `en.json`, `ur.json`, `src/domain/money.ts`
- Modify: `src/app/layout.tsx`, `next.config.ts`
- Test: `src/domain/money.test.ts`, `src/i18n/config.test.ts`

**Interfaces:**
- Produces:
  - `type Locale = 'ar' | 'en' | 'ur'`; `const LOCALES`, `const DEFAULT_LOCALE = 'ar'`; `dirOf(locale: Locale): 'rtl' | 'ltr'` (`ar` and `ur` → `rtl`).
  - Locale is read from the cookie `locale` (no URL prefix), falling back to `ar`.
  - `type Unit = 'cases' | 'value'`.
  - `formatAmount(amount: number, unit: Unit): string`: cases → grouped integer (`1140` → `"1,140"`); value → halalas to SAR, grouped, decimals shown only when non-zero (`8280000` → `"82,800"`, `97855` → `"978.55"`). Always Western digits.
  - `formatPercent(numerator: number, denominator: number): string`: whole percent, floor (`1140/3000` → `"38%"`); denominator 0 → `"—"`.
  - `parseAmount(input: string, unit: Unit): number | null`: accepts Western and Arabic-Indic digits, `,` `٬` and spaces as grouping, `.` or `٫` as decimal for `value` only; returns integer (minor units for `value`); returns `null` for empty, negative, non-numeric, or decimals on `cases`.

- [ ] **Step 1:** Write failing tests with these assertions: `formatAmount(1140,'cases') === '1,140'`; `formatAmount(8280000,'value') === '82,800'`; `formatAmount(97855,'value') === '978.55'`; `formatPercent(1140,3000) === '38%'`; `formatPercent(5,0) === '—'`; `parseAmount('١٢٠','cases') === 120`; `parseAmount('1,140','cases') === 1140`; `parseAmount('82٬800','value') === 8280000`; `parseAmount('978.55','value') === 97855`; `parseAmount('12.5','cases') === null`; `parseAmount('abc','value') === null`; `parseAmount('','cases') === null`; `parseAmount('-3','cases') === null`; `dirOf('ur') === 'rtl'`; `dirOf('en') === 'ltr'`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `money.ts` and the i18n config; wire next-intl (cookie-based locale) so the root layout sets `lang` and `dir` from the locale and applies `--font-urdu` when the locale is `ur`. Seed the three message files with the keys `app.name`, `nav.home`, `nav.close`, `nav.commission`, `nav.assistant`, `nav.history` (ar: "الرئيسية", "القفلة", "العمولة", "المساعد", "السجل").
- [ ] **Step 4:** Run tests and build; pass.
- [ ] **Step 5:** Commit.

### Task 3: Selling calendar

**Files:**
- Create: `src/domain/calendar.ts`
- Test: `src/domain/calendar.test.ts`

**Interfaces:**
- Produces:
  - `type ISODate = string` (`YYYY-MM-DD`).
  - `sellingDays(year: number, month: number, weekdays: number[], holidays: ISODate[]): ISODate[]` (month 1–12; ascending).
  - `monthGrid(year: number, month: number, weekStartsOn: number): (ISODate | null)[]` (leading `null`s to align the first day; no trailing padding).
  - `dayCounts(days: ISODate[], today: ISODate): { total: number; elapsed: number; left: number }` where `elapsed` counts selling days strictly before `today` and `left` counts selling days on or after `today`.
  - `todayIn(timeZone: string, now?: Date): ISODate`.

- [ ] **Step 1:** Failing tests: `sellingDays(2026,11,[6,0,1,2,3,4],[])` has length 26, excludes `2026-11-06`, `-13`, `-20`, `-27`, starts `2026-11-01`, ends `2026-11-30`; with holiday `2026-11-10` length is 25. `dayCounts(days,'2026-11-14')` → `{total:26, elapsed:11, left:15}`; `dayCounts(days,'2026-11-01')` → `{26,0,26}`; `dayCounts(days,'2026-12-05')` → `{26,26,0}`; `dayCounts(days,'2026-11-13')` (a Friday) → `{26,11,15}`. `monthGrid(2026,11,0)` has 30 entries and no leading nulls (1 Nov 2026 is a Sunday); `monthGrid(2026,11,6)` starts with one `null`. `todayIn('Asia/Riyadh', new Date('2026-11-13T22:30:00Z')) === '2026-11-14'`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement using UTC date arithmetic only (no local-time `Date` getters). **Step 4:** Run; PASS. **Step 5:** Commit.

### Task 4: Pace

**Files:**
- Create: `src/domain/pace.ts`
- Test: `src/domain/pace.test.ts`

**Interfaces:**
- Consumes: `dayCounts` result shape from Task 3.
- Produces:
  - `type PaceStatus = 'ahead' | 'slightly_behind' | 'behind' | 'no_target'`
  - `computePace(i: { target: number; achieved: number; total: number; elapsed: number; left: number; behindPct?: number }): { expected: number; gap: number; remaining: number; requiredDaily: number | null; status: PaceStatus; pct: number | null }`
    - `expected = round(target × elapsed ÷ total)` (0 when `total` is 0); `gap = expected − achieved`; `remaining = max(0, target − achieved)`; `requiredDaily = ceil(remaining ÷ left)`, `null` when `left` is 0; `pct = floor(achieved × 100 ÷ target)`, `null` when target ≤ 0.
    - Status: target ≤ 0 → `no_target`; `achieved ≥ expected` → `ahead`; else `gap × 100 ≤ behindPct × target` → `slightly_behind` (`behindPct` default 10); else `behind`.
  - `type DayMark = 'hit' | 'below' | 'missing' | 'today' | 'future' | 'off'`
  - `markDay(i: { date: ISODate; today: ISODate; isSellingDay: boolean; amount: number | null; target: number; total: number }): DayMark` — not a selling day → `off`; date after today → `future`; date equals today and `amount` is null → `today`; `amount` null on a past selling day → `missing`; `amount × total ≥ target` and target > 0 → `hit`; otherwise `below`.

- [ ] **Step 1:** Failing tests on the sample data at `2026-11-14`: `bev` → `{expected:1269, gap:129, remaining:1860, requiredDaily:124, status:'slightly_behind', pct:38}`; `food` → `expected 7615385`, `status 'ahead'`, `pct 46`; `coll` → `expected 19038462`, `gap 138462`, `status 'slightly_behind'`, `pct 42`. Edges: `{target:0,...}` → `status 'no_target'`, `pct null`, no `NaN` in any field; `{elapsed:0}` → `expected 0`, `status 'ahead'`; `{left:0}` → `requiredDaily null`; `{target:3000, achieved:400, total:26, elapsed:11, left:15}` → `'behind'`. `markDay`: amount 118 → `hit`; 110 → `below`; null on `2026-11-09` → `missing`; `2026-11-13` not selling → `off`; `2026-11-14` null → `today`; `2026-11-14` with amount 130 → `hit`; `2026-11-15` → `future`.
- [ ] **Step 2–5:** Run FAIL, implement with integer arithmetic, run PASS, commit.

### Task 5: Commission engine

**Files:**
- Create: `src/domain/commission/types.ts`, `src/domain/commission/evaluate.ts`, `src/domain/commission/project.ts`, `src/domain/commission/index.ts`
- Test: `src/domain/commission/evaluate.test.ts`, `src/domain/commission/project.test.ts`

**Interfaces:**
- Produces (in `types.ts`):

```ts
export type Metric = { target: number; achieved: number };
export type SchemeInput = {
  lines: Record<string, Metric>;
  focus: Record<string, { achieved: number }>; // already limited to each item's date window
};
export type Pay = { kind: 'fixed'; amount: number } | { kind: 'pct_of_achieved'; bps: number };
export type Condition =
  | { kind: 'line_pct_at_least'; lineId: string; minPct: number }
  | { kind: 'focus_at_least'; focusItemId: string; min: number };
export type Component =
  | { id: string; type: 'tiered'; label: string; lineId: string; tiers: { minPct: number; pay: Pay }[] }
  | { id: string; type: 'per_unit'; label: string; lineId: string;
      rate: { kind: 'per_case'; amount: number } | { kind: 'pct_of_value'; bps: number }; abovePct?: number }
  | { id: string; type: 'bonus'; label: string; condition: Condition; amount: number; startsOn: string; endsOn: string }
  | { id: string; type: 'gate'; label: string; condition: Condition; appliesTo: string[] };
export type Scheme = { id: string; name: string; components: Component[] };
export type ComponentResult = {
  componentId: string; label: string; amount: number;
  reason: 'tier' | 'below_first_tier' | 'rate' | 'below_threshold' | 'bonus_met' | 'bonus_not_met' | 'blocked_by_gate' | 'no_target';
  detail: { lineId?: string; focusItemId?: string; pct?: number; tierMinPct?: number; achieved?: number; needed?: number; gateId?: string };
};
export type Evaluation = { total: number; results: ComponentResult[] }; // gates are not in results
export type NearestWin = { componentId: string; label: string; lineId?: string; focusItemId?: string; gap: number; gain: number } | null;
```

- Produces (functions):
  - `evaluateScheme(scheme: Scheme, input: SchemeInput): Evaluation` — percent is `floor(achieved × 100 ÷ target)`; a tiered component pays the highest tier whose `minPct` ≤ percent; `pct_of_achieved` and `pct_of_value` pay `round(achieved × bps ÷ 10000)`; `per_case` pays `achieved × amount`; `abovePct` set and percent below it → 0 with `below_threshold`; a line with target ≤ 0 used by a percent rule → 0 with `no_target`; a component listed in a failing gate's `appliesTo` → 0 with `blocked_by_gate`. Results keep scheme order.
  - `projectInput(input: SchemeInput, days: { total: number; elapsed: number }): SchemeInput` — each line's achieved becomes `round(achieved × total ÷ elapsed)`; when `elapsed` is 0 it becomes `target`; focus items unchanged.
  - `inputAtFullTarget(scheme: Scheme, input: SchemeInput): SchemeInput` — each line achieved raised to at least its target; each focus item referenced by a bonus raised to that bonus's `min`.
  - `whatIf(input: SchemeInput, days: { total: number; elapsed: number; left: number }, lineId: string, dailyRate: number): SchemeInput` — like `projectInput`, but `lineId` achieved becomes `achieved + dailyRate × left`.
  - `nearestWin(scheme: Scheme, input: SchemeInput): NearestWin` — over every unmet tier threshold, unmet bonus, and failing gate condition, compute `needed` (the absolute amount that meets it: `ceil(minPct × target ÷ 100)` or `min`) and `gap = needed − achieved`; `gain` = total with that one metric raised to `needed` minus the current total; discard candidates whose `gain` is 0 (for example a gate whose protected component would still pay nothing); pick the smallest `gap ÷ needed` among the rest. Returns `null` when no candidate remains.

- [ ] **Step 1:** Failing tests on the sample scheme and data. Actuals: `evaluateScheme` → total `41400`; `c_bev` amount 0 reason `blocked_by_gate`; `c_food` 41400 reason `rate`; `c_coll` 0 `below_first_tier`; `c_mango` 0 `bonus_not_met` with `detail.needed 200`, `detail.achieved 120`. Projection with `{total:26, elapsed:11}` → lines `bev 2695`, `food 19570909`, `coll 44672727`; evaluating it → `c_bev 150000` (89% → tier 80), `c_food 97855`, `c_coll 100000`, total `347855`. Full target → total `400000 + 90000 + 100000 + 50000 = 640000`. `whatIf(..., 'bev', 124)` → `bev 3000` → evaluating gives `c_bev 400000`. `nearestWin` on actuals → `{componentId:'c_mango', focusItemId:'mango', gap:80, gain:50000}` (the failing gate `g_coll` has a smaller relative gap but a gain of 0, so it is discarded). A component both gated and below its first tier reports `blocked_by_gate`. Edges: gate passing leaves `c_bev` paid by tier; line target 0 → `no_target`, total finite; `projectInput` with `elapsed:0` returns targets; a scheme with no components → `{total:0, results:[]}`; tiers given out of order still pay the highest matching tier.
- [ ] **Step 2–5:** Run FAIL, implement, run PASS, commit.

### Task 6: Reconciliation

**Files:**
- Create: `src/domain/reconciliation.ts`
- Test: `src/domain/reconciliation.test.ts`

**Interfaces:**
- Produces: `reconcile(i: { cashSales: number; collections: number; expenses: number; loaded: number; sold: number; returned: number }): { cashToHandOver: number; stockLeft: number; warnings: ('negative_cash' | 'negative_stock')[] }` — `cashToHandOver = cashSales + collections − expenses`; `stockLeft = loaded − sold + returned`; negative results are returned as computed with the matching warning.

- [ ] **Step 1:** Failing tests: `{cashSales:1480000, collections:1950000, expenses:15000, loaded:160, sold:118, returned:3}` → `{cashToHandOver:3415000, stockLeft:45, warnings:[]}`; expenses above cash → `negative_cash`; sold above loaded with no returns → `negative_stock`.
- [ ] **Step 2–5:** Run FAIL, implement, run PASS, commit.

### Task 7: Database schema, client, and seed

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/seed.ts`, `src/db/testing.ts`, `drizzle.config.ts`, `drizzle/` (generated migrations)
- Test: `src/db/seed.test.ts`

**Interfaces:**
- Produces:
  - Tables (snake_case columns; every table except `companies` has `company_id`; ids are text ULIDs or UUIDs generated in code; timestamps `created_at`, `updated_at`): `companies` (name, currency, time_zone, default_locale, selling_weekdays int[], week_starts_on int default 0), `holidays` (date), `users` (role `'rep'|'supervisor'|'admin'|'owner'`, name, login unique across all companies, locale, supervisor_id nullable, pin_hash nullable, failed_attempts int, locked_until nullable, active bool), `invites` (user_id, token_hash unique, expires_at, used_at), `sessions` (user_id, token_hash unique, expires_at), `target_lines` (name_ar, name_en, unit `'cases'|'value'`, kind `'sales'|'collection'`, sort int, active), `targets` (user_id, year, month, line_id, amount bigint; unique on user, year, month, line), `daily_closes` (user_id, date, source `'manual'|'photo'|'voice'|'excel'`, status `'draft'|'confirmed'`, cash_sales, credit_sales, collections, expenses, loaded, sold, returned, note; unique on user, date), `close_lines` (close_id, line_id, amount; unique on close, line), `focus_items` (name, unit, target amount, starts_on, ends_on), `focus_assignments` (focus_item_id, user_id), `close_focus` (close_id, focus_item_id, amount; unique), `returns` (close_id, description, quantity, reason `'expired'|'damaged'|'other'`), `schemes` (name, year, month, components jsonb typed as `Component[]`, published bool; unique on company, year, month).
  - `getDb(): Promise<Db>` — Postgres through `postgres` when `DATABASE_URL` is set, otherwise PGlite stored at `.data/pglite`; runs pending migrations once per process. `type Db` is the Drizzle database type both drivers satisfy.
  - `createTestDb(): Promise<Db>` (in `testing.ts`) — fresh in-memory PGlite with migrations applied.
  - `seedDemo(db: Db): Promise<{ companyId: string; repId: string; inviteToken: string; otherRepId: string; otherInviteToken: string }>` — inserts exactly the Shared sample data, plus a second company with one rep (`other-rep`), one target line, and one close, used by access tests. Focus progress rows for `cola` and `mango` each sum to 120 within 1–12 Nov. Idempotent: running twice does not duplicate.
  - Scripts: `pnpm db:generate`, `pnpm db:seed` (prints the invite link path `/invite/<token>`).

- [ ] **Step 1:** Failing test: `createTestDb()` then `seedDemo(db)`; assert 2 companies, 3 target lines for the demo company, targets `3000`, `18000000`, `45000000`, 11 closes for Ahmed whose `bev` amounts sum to `1140`, `food` to `8280000`, `coll` to `18900000`, one published scheme with 5 components, and that a second `seedDemo(db)` leaves all counts unchanged.
- [ ] **Step 2–5:** Run FAIL, implement schema, generate migrations, implement client and seed, run PASS, commit. Add `.data/` to `.gitignore`.

### Task 8: Sign-in, invites, and sessions

**Files:**
- Create: `src/server/auth/pin.ts`, `src/server/auth/sessions.ts`, `src/server/auth/invites.ts`, `src/server/auth/guard.ts`, `src/server/ctx.ts`, `src/app/invite/[token]/page.tsx`, `src/app/signin/page.tsx`, `src/app/(auth-actions)/actions.ts`
- Test: `src/server/auth/auth.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `seedDemo`.
- Produces:
  - `type Ctx = { db: Db; companyId: string; userId: string; role: 'rep'|'supervisor'|'admin'|'owner'; locale: Locale; timeZone: string }`.
  - `hashSecret(secret: string): Promise<string>` and `verifySecret(secret: string, hash: string): Promise<boolean>` using `node:crypto` scrypt with a random salt.
  - `createInvite(db, userId): Promise<string>` (raw token; stored hashed with SHA-256; expires in 7 days).
  - `acceptInvite(db, token: string, pin: string): Promise<{ ok: true; sessionToken: string } | { ok: false; error: 'invalid' | 'expired' | 'used' | 'weak_pin' }>` — PIN must be exactly 6 digits and not one repeated digit or `123456`.
  - `signIn(db, login: string, pin: string): Promise<{ ok: true; sessionToken: string } | { ok: false; error: 'invalid' | 'locked' }>` — 5 consecutive failures lock the user for 15 minutes; success resets the counter; unknown login and wrong PIN return the same `invalid`.
  - `createSession`, `getSessionUser(db, token): Promise<Ctx | null>`, `destroySession`. Sessions last 90 days; cookie `session`, http-only, `SameSite=Lax`, `Secure` in production.
  - `requireCtx(): Promise<Ctx>` for server components and actions: redirects to `/signin` when there is no valid session.
  - Pages: `/invite/[token]` (set PIN twice, then go to `/app`), `/signin` (login name and PIN; six large digit boxes or one numeric field with `inputmode="numeric"`).

- [ ] **Step 1:** Failing tests: accept the seeded invite with `'482915'` → ok and `getSessionUser` returns Ahmed's ctx with the demo `companyId`; the same token again → `used`; `'111111'` and `'123456'` and `'12345'` → `weak_pin`; a random token → `invalid`; `signIn` with the right PIN → ok; five wrong PINs then the right one → `locked`; unknown login → `invalid`; a destroyed session → `getSessionUser` null; `verifySecret('482915', await hashSecret('482915'))` true and two hashes of the same secret differ.
- [ ] **Step 2–5:** Run FAIL, implement, run PASS, wire the two pages and their server actions with translated copy in all three message files, commit.

### Task 9: Rep data access

**Files:**
- Create: `src/server/repos/month-view.ts`, `src/server/repos/closes.ts`, `src/server/repos/commission.ts`, `src/server/repos/history.ts`
- Test: `src/server/repos/repos.test.ts`

**Interfaces:**
- Consumes: `Ctx`, domain functions from Tasks 3–6, schema from Task 7.
- Produces:
  - `getMonthView(ctx: Ctx, opts: { year: number; month: number; today: ISODate }): Promise<MonthView>` where

```ts
type LineView = { lineId: string; nameAr: string; nameEn: string; unit: Unit; kind: 'sales'|'collection';
  target: number; achieved: number; pace: ReturnType<typeof computePace>;
  days: { date: ISODate; mark: DayMark; amount: number | null }[] };  // every day of the month
type MonthView = { year: number; month: number; today: ISODate; counts: { total: number; elapsed: number; left: number };
  weekStartsOn: number; lines: LineView[];
  focus: { id: string; name: string; unit: Unit; target: number; achieved: number; perDay: number | null }[]; // perDay = ceil(remaining ÷ selling days left in the item's window)
  hasClosedToday: boolean };
```

  - `getClose(ctx, date: ISODate): Promise<CloseForm | null>` and `saveClose(ctx, form: CloseForm): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }>` where `CloseForm = { date: ISODate; lines: Record<string, number>; focus: Record<string, number>; cashSales: number; creditSales: number; collections: number; expenses: number; loaded: number; sold: number; returned: number; returns: { description: string; quantity: number; reason: 'expired'|'damaged'|'other' }[]; note: string }`. `saveClose` upserts on (user, date), sets source `manual` and status `confirmed`, rejects dates in the future, dates outside selling days, and negative numbers.
  - `getCommissionView(ctx, opts: { year; month; today }): Promise<{ scheme: Scheme | null; input: SchemeInput; counts; actual: Evaluation; projected: Evaluation; atFullTarget: Evaluation; nearest: NearestWin; lines: { lineId: string; nameAr: string; nameEn: string; unit: Unit }[] }>`.
  - `getHistoryMonths(ctx): Promise<{ year: number; month: number; lines: { lineId: string; pct: number | null }[]; commission: number }[]>` (newest first) and `getHistoryDays(ctx, year, month): Promise<{ date: ISODate; lines: Record<string, number>; cashToHandOver: number }[]>`.
  - Every function reads only rows with `company_id = ctx.companyId` and `user_id = ctx.userId`.

- [ ] **Step 1:** Failing tests on the seeded data with today `2026-11-14`: `getMonthView` → 3 lines in sort order; `bev` pace equals Task 4's expected object; `bev.days` has 30 entries with marks `hit` on the 2nd, 4th, 8th, `below` on the other eight closed days, `off` on the 6th, 13th, 20th, 27th, `today` on the 14th, `future` from the 15th; `hasClosedToday` false; focus `mango` → `achieved 120`, `perDay 14` (80 over the 6 selling days 14–19 Nov), `cola` → `perDay 19` (280 over 15). `saveClose` for `2026-11-14` with `bev 130` then `getMonthView` → `bev.achieved 1270`, the 14th marked `hit`, `hasClosedToday` true; saving the same date again with `bev 100` → still one close, achieved `1240` (Review Focus 3). `saveClose` for `2026-11-15` (future) and `2026-11-13` (Friday) → `ok:false`. With `ctx` for the other company's rep, `getMonthView` returns none of Ahmed's lines or amounts and `getClose(ctx,'2026-11-12')` does not return Ahmed's close (Review Focus 4). Deleting Ahmed's `bev` target → that line's pace status `no_target` and no `NaN` (Review Focus 2). `getCommissionView` → `actual.total 41400`, `projected.total 347855`, `atFullTarget.total 640000`, `nearest.componentId 'c_mango'`. `getHistoryMonths` → one month with commission `41400`.
- [ ] **Step 2–5:** Run FAIL, implement, run PASS, commit.

### Task 10: App shell and home screen

**Files:**
- Create: `src/app/app/layout.tsx`, `src/app/app/page.tsx`, `src/ui/components/AppHeader.tsx`, `BottomNav.tsx`, `LineTabs.tsx`, `MonthCalendar.tsx`, `StatusChip.tsx`, `TodayPanel.tsx`, `FocusList.tsx`, `PrimaryLink.tsx`, `scripts/screenshot.mjs`
- Modify: message files
- Test: `src/ui/components/month-calendar.test.ts` (logic helpers only)

**Interfaces:**
- Consumes: `requireCtx`, `getMonthView`, `todayIn`, `monthGrid`, `formatAmount`, `formatPercent`.
- Produces: route `/app` (signed-in only; `/` redirects there). The selected line is the URL search parameter `line` (default: first line). `calendarCells(view: LineView, weekStartsOn: number): ({ date: ISODate; day: number; mark: DayMark; amount: number | null } | null)[]` exported from `MonthCalendar.tsx`'s helper file. `scripts/screenshot.mjs <path> <out.png>` signs in with the seeded invite and captures a 390×844 screenshot at device scale 2 using the pre-installed Playwright (`import { chromium } from 'playwright'`; do not install Playwright).

Build the screen to match `docs/design/home.mockup.html` (structure, sizes, spacing, and copy), with these rules:

- Header band in brand blue: greeting with the rep's name, date line "{weekday} {day} {month} · يوم البيع {n} من {total}", notifications button (static in this plan), then the line tabs (each tab: line name and whole percent; selected tab white with blue text).
- Body: achieved figure (46px, weight 800) with "من {target} {unit}"; status chip — `slightly_behind` and `behind`: red tint with "متأخر {gap} {unit}"; `ahead`: blue tint with "سابق المعدل"; `no_target`: muted "لسه مفيش تارجت"; then "المفروض لحد النهارده {expected}".
- Calendar: weekday header row starting at the company's `weekStartsOn`; cells 46px tall, 8px radius. `hit`: solid blue, white text. `below`: pale cell `#E3ECF8`, cell ink. `missing`: white with a dashed `--color-line` border and "—". `today`: 2.5px ink border with "اليوم". `future`: 1px line border, secondary text. `off`: no border, muted. Legend under the grid. The grid has an accessible summary label.
- Today panel (blue tint): "النهارده محتاج تبيع" with required daily amount; sub-line "باقي {remaining} على {left} يوم". When `hasClosedToday`, the panel instead confirms the day is recorded and shows tomorrow's required amount.
- Focus list: name, "بيع {perDay} · ناقص {remaining}".
- Primary action "سجّل قفلة اليوم" → `/app/close`.
- Bottom navigation: Home, Close, Commission, Assistant (placeholder page saying it arrives in a later release), History. Current item in blue with heavier weight.

- [ ] **Step 1:** Failing test for `calendarCells` on the seeded `bev` view with `weekStartsOn 0`: 30 cells, no leading nulls, cell for the 2nd has `mark 'hit'` and `amount 118`; with `weekStartsOn 6`: first entry `null`, second is day 1.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement the helper, the components, and the page. **Step 4:** Run tests, typecheck, lint, build.
- [ ] **Step 5:** Run `pnpm db:seed`, start the dev server, capture `/app` in `ar` and `en` with `scripts/screenshot.mjs`, open both images, and compare against the mockup: palette, calendar marks on the right days, right-to-left order in Arabic and left-to-right in English, no clipped or overlapping text. Fix what differs.
- [ ] **Step 6:** Commit.

### Task 11: Day close by typing

**Files:**
- Create: `src/app/app/close/page.tsx`, `src/app/app/close/actions.ts`, `src/ui/components/AmountField.tsx`, `ReconciliationPanel.tsx`, `ReturnsEditor.tsx`
- Modify: message files
- Test: `src/app/app/close/parse-form.test.ts`

**Interfaces:**
- Consumes: `getClose`, `saveClose`, `getMonthView` (for the line and focus lists), `parseAmount`, `reconcile`.
- Produces: `parseCloseForm(data: FormData, lines: { lineId: string; unit: Unit }[], focus: { id: string; unit: Unit }[]): { ok: true; form: CloseForm } | { ok: false; errors: Record<string, 'required' | 'invalid'> }` — an empty line field is `required`; an unparsable one is `invalid`; empty optional fields (focus, expenses, loaded, sold, returned, credit sales) become 0.

Screen (structure as `docs/design/day-close.mockup.html`, in the new palette): date line; the three entry methods as a segmented control with only "اكتبها" enabled (photo and voice shown disabled with "قريباً"); one amount field per target line labeled with the line name and unit; cash sales, credit sales, collections, expenses; stock loaded, sold, returned; optional focus item amounts; returns editor (description, quantity, reason); the reconciliation panel updating live as the rep types; confirm button. On success return to `/app` with the day marked. Editing an existing close pre-fills the form. A date other than today is reachable as `/app/close?date=YYYY-MM-DD` for past selling days only.

- [ ] **Step 1:** Failing tests: form data with `line.bev = '١٣٠'`, `line.food = '8,250.50'`, `line.coll = '19000'` → `form.lines` `{bev:130, food:825050, coll:1900000}`; `line.bev = ''` → error `required`; `line.bev = 'abc'` → `invalid`, and nothing is saved as 0 (Review Focus 5); `expenses` empty → 0.
- [ ] **Step 2–4:** Run FAIL, implement, run PASS with typecheck, lint, build.
- [ ] **Step 5:** Screenshot `/app/close` in `ar`, fill and submit through the browser in the script or by hand, confirm the home calendar marks the 14th, and that submitting twice leaves one close. Fix what differs from the mockup.
- [ ] **Step 6:** Commit.

### Task 12: Commission screen

**Files:**
- Create: `src/app/app/commission/page.tsx`, `src/ui/components/CommissionBreakdown.tsx`, `TierTable.tsx`, `WhatIf.tsx`, `src/ui/commission-copy.ts`
- Modify: message files
- Test: `src/ui/commission-copy.test.ts`

**Interfaces:**
- Consumes: `getCommissionView`, `evaluateScheme`, `whatIf`, `formatAmount`.
- Produces: `explainResult(r: ComponentResult, t: (key: string, values?: Record<string, string | number>) => string, names: Record<string, string>): string` mapping each `reason` to a translated sentence (for example `tier` → "حققت {pct}% · شريحة {tierMinPct}%"; `blocked_by_gate` → "موقوفة لحد ما {gate} يتحقق"; `bonus_not_met` → "{achieved} من {needed} · ناقص {gap}").

Screen (structure as `docs/design/commission.mockup.html`, new palette): header amount = projected month-end total with the line "لو كمّلت بنفس المعدل"; under it earned-so-far (actual total) and payout at full target; "الرقم ده جاي منين" list — one row per component with its label, `explainResult` sentence, and projected amount; a tier table per tiered component with the projected tier highlighted; nearest win card; what-if: choose a line, step its daily rate up and down (step = 5 for cases, 500 SAR for value; starting at the current average), showing the month-end percent for that line and the resulting total, computed in the browser with the pure engine. No scheme published → an explanatory empty state.

- [ ] **Step 1:** Failing tests for `explainResult` covering all eight reasons with a stub `t` that returns the key and values, asserting the key and the values passed (for `bonus_not_met`: `{achieved:120, needed:200, gap:80}`).
- [ ] **Step 2–4:** Run FAIL, implement, run PASS with typecheck, lint, build.
- [ ] **Step 5:** Screenshot `/app/commission` in `ar`; confirm header shows `3,478.55`, earned so far `414`, full target `6,400`, nearest win names the mango item with `80` and `500`, and stepping `bev` to 124 per day shows 100% and raises the total. Fix what differs.
- [ ] **Step 6:** Commit.

### Task 13: History and settings

**Files:**
- Create: `src/app/app/history/page.tsx`, `src/app/app/history/[ym]/page.tsx`, `src/app/app/settings/page.tsx`, `src/app/app/settings/actions.ts`
- Modify: message files, `AppHeader.tsx` (settings entry)
- Test: `src/app/app/settings/locale.test.ts`

**Interfaces:**
- Consumes: `getHistoryMonths`, `getHistoryDays`, `destroySession`, `LOCALES`.
- Produces: `setLocale(ctx, locale: string): Promise<{ ok: boolean }>` — rejects values outside `LOCALES`, stores the choice on the user row and in the `locale` cookie.

History: list of months (newest first) with each line's percent and the month's commission; a month opens its days (date, each line's amount, cash handed over), and a past selling day with no close links to `/app/close?date=`. Settings: language (three options, each written in its own language), sign out.

- [ ] **Step 1:** Failing tests: `setLocale(ctx,'en')` → ok and the user row has `en`; `setLocale(ctx,'fr')` → not ok and the row is unchanged.
- [ ] **Step 2–4:** Run FAIL, implement, run PASS with typecheck, lint, build.
- [ ] **Step 5:** Screenshot history and settings in `ar` and the home screen in `ur`; confirm Urdu renders in Noto Nastaliq Urdu, right-to-left, with no missing keys shown raw. Commit.

### Task 14: End-to-end check and README

**Files:**
- Create: `scripts/e2e-smoke.mjs`
- Modify: `README.md`, `package.json` (script `e2e`)

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm e2e` — builds, starts the app on a free port with a fresh local database, seeds, and drives the pre-installed Playwright through: open the invite link, set PIN `482915`, land on `/app`, read `1,140` and `38%`; open the close form, enter `bev 130`, `food 8250.50`, `coll 19000`, confirm; back on home read `1,270`; open commission and read a non-empty breakdown; switch language to English and read "Beverages"; sign out; sign in again with the PIN; request `/app/close?date=2026-11-12` while signed in as the other company's rep and confirm Ahmed's figures are absent. Exits non-zero on any failed expectation. Because the seed is fixed to November 2026, the app reads "today" from the environment variable `APP_TODAY` when it is set (used only by this script and local demos).

- [ ] **Step 1:** Add `APP_TODAY` support in one place (the helper that calls `todayIn`), with a unit test that it is ignored when `NODE_ENV` is `production` and `ALLOW_APP_TODAY` is not `1`.
- [ ] **Step 2:** Write the script; run `pnpm e2e`; fix failures in the app, not by weakening the script.
- [ ] **Step 3:** README: what the app is, how to run it locally (`pnpm install`, `pnpm db:seed`, `pnpm dev`), how to run tests, the environment variables (`DATABASE_URL`, `APP_TODAY`, `ALLOW_APP_TODAY`), and the sample-data notice.
- [ ] **Step 4:** Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm e2e`; all pass. Commit.
