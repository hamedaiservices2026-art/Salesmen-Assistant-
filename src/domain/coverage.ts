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

/** The tier percents (ascending) of the scheme's tiered components on `lineId`. */
export function coverageTiers(scheme: Scheme | null, lineId: string): number[] {
  if (!scheme) return [];
  const pcts = scheme.components.flatMap((c) => (c.type === "tiered" && c.lineId === lineId ? c.tiers.map((t) => t.minPct) : []));
  return [...new Set(pcts)].sort((a, b) => a - b);
}

/** Field problems of one coverage update: `{ field: code }`, empty when it is valid. */
export function coverageErrors(i: { covered: number; total: number; asOf: string; today: ISODate }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isSafeInteger(i.total) || i.total < 1) errors.total = "invalid";
  if (!Number.isSafeInteger(i.covered) || i.covered < 0) errors.covered = "invalid";
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
