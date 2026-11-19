import type { ISODate } from "./calendar";
import { isISODate, type Scheme } from "./commission";

/** Customers reached out of the customers in the territory, as of one date. */
export type CoverageCount = { covered: number; total: number };

/** Whole percent, floored; null without a total. */
export function coveragePct(c: CoverageCount): number | null {
  return c.total > 0 ? Math.floor((c.covered * 100) / c.total) : null;
}

/**
 * The next commission tier above the current percent and how many more customers reach it
 * (ceil(tier × total ÷ 100) − covered). Null when no tier is left or there is no total.
 */
export function coverageNeed(c: CoverageCount, tiers: number[]): { nextPct: number; more: number } | null {
  const pct = coveragePct(c);
  if (pct === null) return null;
  const next = tiers.filter((t) => t > pct).sort((a, b) => a - b)[0];
  if (next === undefined) return null;
  const needed = Math.floor((next * c.total + 99) / 100);
  return { nextPct: next, more: Math.max(0, needed - c.covered) };
}

/**
 * The percents (ascending) a commission component asks of `lineId`: the tiers of its tiered components,
 * and the `line_pct_at_least` leaves of bonus and gate conditions (alone or inside an `all`).
 */
export function coverageTiers(scheme: Scheme | null, lineId: string): number[] {
  if (!scheme) return [];
  const pcts = scheme.components.flatMap((c) => {
    if (c.type === "tiered") return c.lineId === lineId ? c.tiers.map((t) => t.minPct) : [];
    if (c.type === "bonus" || c.type === "gate") {
      const leaves = c.condition.kind === "all" ? c.condition.conditions : [c.condition];
      return leaves.flatMap((l) => (l.kind === "line_pct_at_least" && l.lineId === lineId ? [l.minPct] : []));
    }
    return [];
  });
  return [...new Set(pcts)].sort((a, b) => a - b);
}

/** The largest count a column can hold (int4). */
export const COUNT_MAX = 2_147_483_647;

/** Field problems of one coverage update: `{ field: code }`, empty when it is valid. */
export function coverageErrors(i: { covered: number; total: number; asOf: string; today: ISODate }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isSafeInteger(i.total) || i.total < 1 || i.total > COUNT_MAX) errors.total = "invalid";
  if (!Number.isSafeInteger(i.covered) || i.covered < 0 || i.covered > COUNT_MAX) errors.covered = "invalid";
  else if (errors.total === undefined && i.covered > i.total) errors.covered = "covered_above_total";
  if (!isISODate(i.asOf)) errors.asOf = "invalid";
  else if (i.asOf > i.today) errors.asOf = "future";
  return errors;
}

/** `today` and the `count - 1` days before it, newest first (the dates a coverage update can be as of). */
export function recentDays(today: ISODate, count: number): ISODate[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
}

/** Dates a coverage update can be as of: today and up to `count - 1` earlier days, never before the 1st of today's month (an older date would fall outside the month's figures). */
export function coverageDays(today: ISODate, count: number): ISODate[] {
  const dayOfMonth = Number(today.slice(8, 10));
  return recentDays(today, Math.max(1, Math.min(count, dayOfMonth)));
}
