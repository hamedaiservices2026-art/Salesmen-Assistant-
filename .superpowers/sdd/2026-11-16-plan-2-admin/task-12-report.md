# Task 12 report: commission editor screen

## Implemented
- `src/ui/admin/scheme-form.ts` (pure): `EditorCard` (text as typed), `fromComponents`, `toComponents` (field errors `required`/`invalid`, keys `<cardId>.<field>`), `newCard` for the eight presets, editing helpers (`setLine`, leaf helpers, `withWindow`, `moveCard`, `removeCard`), `issueFieldKey` / `issueCardIndex` (server issue path to card and field).
  - Money via `parseAmount(s, "value")` (Arabic-Indic digits accepted); percent of sales typed with up to two decimals uses the same hundredths arithmetic (`0.5` is 50 bps); tier thresholds and condition percents are whole numbers; a focus minimum uses the item's unit.
  - Percentage pay is offered only on value lines; a per-unit card's rate kind follows its line (value: percent, cases or outlets: per case); changing the line resets a now-invalid kind.
  - A bonus window is derived, read-only: the whole month, or the focus item's window when any row names a focus item (follows a changed item).
- Page `/admin/schemes?ym=` (`requireRole(["admin"])`, malformed month falls back to the current month, handles `invalid_period`): month nav, tabs (Commission, Incentives `/admin/incentives`, Focus items `/admin/focus`; the last two pages do not exist yet), red notice for the published plan's own issues (named by the published parts), status line, editor.
- `actions.ts`: `previewSchemeAction`, `saveDraftAction`, `publishSchemeAction`; form data only, ctx from `requireRole`, `today` from the company clock; publish returns `draftRev: expected + 1` (what the conditional write sets).
- `scheme-editor.tsx` (client): cards with up/down/remove, add menu (8 presets), save draft, publish with native `<dialog>` confirmation (stronger wording when there are no parts; says the draft is saved first when what is typed differs from the saved draft), stale banner (typed state kept, save and publish disabled), tokens updated from results, `beforeunload` warning when unsaved, preview debounced 400 ms with cancellation of older responses, issues next to the owning card plus a summary and "draft has errors and will not be saved", live client field errors shown after the first save or publish attempt.
- `ComponentCard`, `TierRows`, `ConditionRows`, `PreviewPanel` (reuses `CommissionBreakdown` and `explainResult`, same strings as the rep screen), plus `src/ui/admin/form-styles.ts` (shared class names and `FieldState`; one file beyond the brief's list).
- Messages: `admin.schemes.*` in ar, en, ur (Arabic preset names exactly as the brief).

## TDD
- RED: `npx vitest run src/ui/admin/scheme-form.test.ts` with the implementation file moved away: `Error: Cannot find module './scheme-form'` (suite failed). I wrote the test file first but only ran the RED after writing the implementation, by moving it away.
- GREEN: same command: 10 passed (round-trip of the sample scheme and of a scheme with labels, abovePct, `all` bonus, percent tier; `'300'` and `'٣٠٠'` give `30000`; `'0.5'` gives bps 50; empty tier amount gives `required` at `<id>.tiers.0.pay`; presets; volume window equals the item's; issue path mapping).

## Browser check (production build, `APP_TODAY=2026-11-14`, seeded fresh)
Shots in `shots/`: `t12-editor-ar-1440.png`, `t12-editor-ar-cards-1440.png` (extra100, combined and coverage cards added), `t12-editor-ar-invalid-1440.png` (empty tier amount: red field, "required", summary, "draft will not be saved"), `t12-editor-ar-saved-1440.png`, `t12-publish-dialog-ar-1440.png`, `t12-editor-ar-published-1440.png`, `t12-stale-ar-1440.png` (two contexts; typed Urdu label kept), `t12-editor-ar-1024.png`, `t12-editor-en-1440.png`, `t12-editor-en-1024.png`, `t12-rep-commission-ar.png`.
- Adding "إضافي عند 100%" (500 on beverages): Ahmed's preview "if you hit every target" went 6,400 to 6,900; the month-end projection stays 3,478.55 (Ahmed is at 89%, so the bonus is not met: row shows "2,695 of 3,000, 305 short", 0). After publishing, `/app/commission` as Ahmed shows the new row with the same text and the 6,900 figure.
- Fixed after first look: dates in the window box were garbled by bidi (now separate LTR spans); percent shown as `0.5` not `0.50`.
- At 1024 the preview stays at the side and the editor column is narrow (label fields stack); usable, long. Below 900 it stacks.
- Server stopped after the check.

## Results
See the final section below.

## Concerns
- `/admin/incentives` and `/admin/focus` tab targets do not exist yet (later tasks); they 404 until then.
- The publish action's new `draftRev` is computed as expected + 1 (documented server behaviour) because `publishScheme` does not return it.
- English focus item names are not localized (the focus table has one `name`).

## Final results
- `pnpm test`: 39 files, 493 tests passed. `pnpm typecheck` and `pnpm lint` clean. `pnpm build` ok (also run by `pnpm e2e`). `pnpm e2e`: All 34 checks passed.
