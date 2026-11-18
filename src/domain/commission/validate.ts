import { z } from "zod";
import type { ISODate } from "../calendar";
import type { LineKind } from "../lines";
import type { Unit } from "../money";
import type { Component, Condition, LeafCondition, Pay } from "./types";

/** What a scheme may refer to in one month: the company's active lines, its focus items and the month's dates. */
export type SchemeRefs = {
  lines: { id: string; unit: Unit; kind: LineKind }[];
  focus: { id: string; startsOn: ISODate; endsOn: ISODate }[];
  period: { start: ISODate; end: ISODate };
};

export const SCHEME_ISSUE_CODES = [
  "shape",
  "duplicate_id",
  "label_missing",
  "unknown_line",
  "unknown_focus",
  "empty_tiers",
  "duplicate_tier",
  "bad_pct",
  "bad_amount",
  "bad_bps",
  "per_case_needs_cases",
  "window_order",
  "window_outside_period",
  "line_bonus_needs_full_period",
  "focus_window_mismatch",
  "empty_all",
  "gate_unknown_target",
  "pct_needs_value",
  "too_many_issues",
] as const;
export type SchemeIssueCode = (typeof SCHEME_ISSUE_CODES)[number];

/** `path` is dotted from the list, e.g. `components.2.lineId` or `components.0.tiers.1.minPct`. */
export type SchemeIssue = { path: string; code: SchemeIssueCode };

export type ValidateResult = { ok: true; components: Component[] } | { ok: false; issues: SchemeIssue[] };

const MAX_COMPONENTS = 50;
/** Shape bound on an `all`; the rule `empty_all` then asks for 2–4. */
const MAX_LEAVES = 10;
const MAX_TEXT = 200;
const MAX_ID = 64;
const PCT_MIN = 1;
const PCT_MAX = 1000;
const BPS_MAX = 10_000;
/** Sanity caps in minor units (halalas): a fixed pay up to 1e11, a per-carton rate up to 1e9. */
const FIXED_MAX = 100_000_000_000;
const PER_CASE_MAX = 1_000_000_000;
/** At most this many issues are returned; a final `too_many_issues` marks a truncated list. */
const MAX_ISSUES = 100;

/**
 * A real calendar date written `YYYY-MM-DD` with zero padding. The engine compares dates as text,
 * which orders correctly only in exactly this form.
 */
export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Shape only: numbers are any finite number here and their ranges are checked below, so a bad
// amount gets its own code instead of a generic `shape`.
const isoDate = z.string().refine(isISODate);
const text = z.string().max(MAX_TEXT);
const labels = { label: text, labelEn: text.optional(), labelUr: text.optional() };
const componentId = z.string().min(1).max(MAX_ID);
const lineId = z.string().min(1).max(MAX_ID);

const pay = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), amount: z.number() }),
  z.object({ kind: z.literal("pct_of_achieved"), bps: z.number() }),
]);
const leaf = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line_pct_at_least"), lineId, minPct: z.number() }),
  z.object({ kind: z.literal("focus_at_least"), focusItemId: z.string().min(1).max(MAX_ID), min: z.number() }),
]);
const condition = z.union([leaf, z.object({ kind: z.literal("all"), conditions: z.array(leaf).max(MAX_LEAVES) })]);

const componentSchema = z.discriminatedUnion("type", [
  z.object({
    id: componentId,
    type: z.literal("tiered"),
    lineId,
    tiers: z.array(z.object({ minPct: z.number(), pay })).max(20),
    ...labels,
  }),
  z.object({
    id: componentId,
    type: z.literal("per_unit"),
    lineId,
    rate: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("per_case"), amount: z.number() }),
      z.object({ kind: z.literal("pct_of_value"), bps: z.number() }),
    ]),
    abovePct: z.number().optional(),
    ...labels,
  }),
  z.object({
    id: componentId,
    type: z.literal("bonus"),
    condition,
    amount: z.number(),
    startsOn: isoDate,
    endsOn: isoDate,
    ...labels,
  }),
  z.object({
    id: componentId,
    type: z.literal("gate"),
    condition,
    appliesTo: z.array(componentId).min(1).max(MAX_COMPONENTS),
    ...labels,
  }),
]);
const componentsSchema = z.array(componentSchema).max(MAX_COMPONENTS);

const pctOk = (n: number) => Number.isInteger(n) && n >= PCT_MIN && n <= PCT_MAX;
const amountOk = (n: number, max = FIXED_MAX) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const bpsOk = (n: number) => Number.isInteger(n) && n >= 0 && n <= BPS_MAX;

function leavesOf(c: Condition): LeafCondition[] {
  return c.kind === "all" ? c.conditions : [c];
}

/**
 * Checks a scheme's components, as sent by the editor, against the month's lines, focus items and
 * dates. On success the parsed components (unknown keys dropped) are what gets stored.
 *
 * - shape: the structure of `Component`, with dates as real zero-padded `YYYY-MM-DD`;
 * - ids unique; the Arabic `label` not blank;
 * - every line and focus item named exists in `refs` (a deactivated line is not there);
 * - tiers non-empty with unique whole `minPct` in 1–1000 (also `abovePct` and condition `minPct`);
 *   fixed amounts and focus minimums safe whole numbers (≥ 0; a focus minimum ≥ 1; fixed pay ≤ 1e11,
 *   a per-carton rate ≤ 1e9); bps 0–10 000; a percentage pay (`pct_of_value`, `pct_of_achieved`) only on a `value` line;
 * - `per_case` only on a `cases` or `outlets` line;
 * - a bonus window is ordered and inside the month; a bonus whose condition names a line (also
 *   inside `all`) spans the whole month, and one naming a focus item has exactly that item's window,
 *   so the month's sums are the window's sums and a bonus met after its window cannot appear;
 * - `all` has 2–4 conditions; a gate applies only to existing non-gate components.
 *
 * One issue per path: the first rule that fails on a field is the one reported.
 */
export function validateComponents(raw: unknown, refs: SchemeRefs): ValidateResult {
  const issues: SchemeIssue[] = [];
  const flagged = new Set<string>();
  let truncated = false;
  const add = (path: string, code: SchemeIssueCode) => {
    if (flagged.has(path)) return;
    if (issues.length >= MAX_ISSUES) {
      truncated = true;
      return;
    }
    flagged.add(path);
    issues.push({ path, code });
  };

  const parsed = componentsSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add(["components", ...issue.path.map(String)].join("."), "shape");
    return { ok: false, issues };
  }
  const components = parsed.data as Component[];

  const lines = new Map(refs.lines.map((l) => [l.id, l]));
  const focus = new Map(refs.focus.map((f) => [f.id, f]));
  const { start, end } = refs.period;
  const payable = new Set(components.filter((c) => c.type !== "gate").map((c) => c.id));

  const checkLine = (id: string, path: string) => {
    const line = lines.get(id);
    if (!line) add(path, "unknown_line");
    return line;
  };
  const checkPay = (p: Pay, path: string, line: { unit: Unit } | undefined) => {
    if (p.kind === "fixed") {
      if (!amountOk(p.amount)) add(`${path}.amount`, "bad_amount");
    } else if (!bpsOk(p.bps)) add(`${path}.bps`, "bad_bps");
    // A percentage of achieved is a percentage of money; of a carton count it is meaningless.
    else if (line && line.unit !== "value") add(`${path}.kind`, "pct_needs_value");
  };
  const checkCondition = (c: Condition, path: string) => {
    if (c.kind === "all" && (c.conditions.length < 2 || c.conditions.length > 4)) add(`${path}.conditions`, "empty_all");
    leavesOf(c).forEach((l, k) => {
      const at = c.kind === "all" ? `${path}.conditions.${k}` : path;
      if (l.kind === "line_pct_at_least") {
        checkLine(l.lineId, `${at}.lineId`);
        if (!pctOk(l.minPct)) add(`${at}.minPct`, "bad_pct");
      } else {
        if (!focus.has(l.focusItemId)) add(`${at}.focusItemId`, "unknown_focus");
        if (!amountOk(l.min) || l.min < 1) add(`${at}.min`, "bad_amount");
      }
    });
  };

  const seen = new Set<string>();
  components.forEach((c, i) => {
    const p = `components.${i}`;
    if (seen.has(c.id)) add(`${p}.id`, "duplicate_id");
    seen.add(c.id);
    if (c.label.trim() === "") add(`${p}.label`, "label_missing");

    switch (c.type) {
      case "tiered": {
        const tierLine = checkLine(c.lineId, `${p}.lineId`);
        if (c.tiers.length === 0) add(`${p}.tiers`, "empty_tiers");
        const minPcts = new Set<number>();
        c.tiers.forEach((t, j) => {
          if (!pctOk(t.minPct)) add(`${p}.tiers.${j}.minPct`, "bad_pct");
          else if (minPcts.has(t.minPct)) add(`${p}.tiers.${j}.minPct`, "duplicate_tier");
          minPcts.add(t.minPct);
          checkPay(t.pay, `${p}.tiers.${j}.pay`, tierLine);
        });
        break;
      }
      case "per_unit": {
        const line = checkLine(c.lineId, `${p}.lineId`);
        if (c.rate.kind === "per_case") {
          if (!amountOk(c.rate.amount, PER_CASE_MAX)) add(`${p}.rate.amount`, "bad_amount");
          if (line && line.unit !== "cases" && line.unit !== "outlets") add(`${p}.rate`, "per_case_needs_cases");
        } else if (!bpsOk(c.rate.bps)) add(`${p}.rate.bps`, "bad_bps");
        else if (line && line.unit !== "value") add(`${p}.rate.kind`, "pct_needs_value");
        if (c.abovePct !== undefined && !pctOk(c.abovePct)) add(`${p}.abovePct`, "bad_pct");
        break;
      }
      case "bonus": {
        checkCondition(c.condition, `${p}.condition`);
        if (!amountOk(c.amount)) add(`${p}.amount`, "bad_amount");
        if (c.startsOn > c.endsOn) add(`${p}.endsOn`, "window_order");
        if (c.startsOn < start) add(`${p}.startsOn`, "window_outside_period");
        if (c.endsOn > end) add(`${p}.endsOn`, "window_outside_period");
        const leaves = leavesOf(c.condition);
        if (leaves.some((l) => l.kind === "line_pct_at_least")) {
          if (c.startsOn !== start) add(`${p}.startsOn`, "line_bonus_needs_full_period");
          if (c.endsOn !== end) add(`${p}.endsOn`, "line_bonus_needs_full_period");
        }
        for (const l of leaves) {
          if (l.kind !== "focus_at_least") continue;
          const item = focus.get(l.focusItemId);
          if (!item) continue;
          // The engine counts the item's whole-window total, so the bonus window must be the item's.
          if (c.startsOn !== item.startsOn) add(`${p}.startsOn`, "focus_window_mismatch");
          if (c.endsOn !== item.endsOn) add(`${p}.endsOn`, "focus_window_mismatch");
        }
        break;
      }
      case "gate": {
        checkCondition(c.condition, `${p}.condition`);
        c.appliesTo.forEach((id, j) => {
          if (!payable.has(id)) add(`${p}.appliesTo.${j}`, "gate_unknown_target");
        });
        break;
      }
    }
  });

  if (truncated) issues.push({ path: "components", code: "too_many_issues" });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, components };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Every line id that components name (a component's `lineId`, a condition's, or one inside `all`),
 * sorted and unique. Reads any input without trusting its shape, so a caller can lock those lines
 * before validating. Looks no further than the sizes the shape allows (anything longer fails
 * validation anyway), so an oversized input cannot make the lock list large.
 */
export function referencedLineIds(raw: unknown): string[] {
  const ids = new Set<string>();
  const take = (v: unknown) => {
    // An id longer than the shape allows is `unknown_line` in the validator; it is not worth a lock.
    if (isObject(v) && typeof v.lineId === "string" && v.lineId.length <= MAX_ID) ids.add(v.lineId);
  };
  if (!Array.isArray(raw)) return [];
  for (const c of raw.slice(0, MAX_COMPONENTS)) {
    if (!isObject(c)) continue;
    take(c);
    take(c.condition);
    if (isObject(c.condition) && Array.isArray(c.condition.conditions)) c.condition.conditions.slice(0, MAX_LEAVES).forEach(take);
  }
  return [...ids].sort();
}
