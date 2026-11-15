import type { ISODate } from "./calendar";

export type PaceStatus = "ahead" | "slightly_behind" | "behind" | "no_target";

/** Integer division rounding half up (non-negative values). */
function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

export function computePace(i: {
  target: number;
  achieved: number;
  total: number;
  elapsed: number;
  left: number;
  behindPct?: number;
}): {
  expected: number;
  gap: number;
  remaining: number;
  requiredDaily: number | null;
  status: PaceStatus;
  pct: number | null;
} {
  const { target, achieved, total, elapsed, left } = i;
  const behindPct = i.behindPct ?? 10;
  const expected = total > 0 && target > 0 ? roundDiv(target * elapsed, total) : 0;
  const gap = expected - achieved;
  const remaining = Math.max(0, target - achieved);
  const requiredDaily = left > 0 ? ceilDiv(remaining, left) : null;
  const pct = target > 0 ? Math.floor((achieved * 100) / target) : null;

  let status: PaceStatus;
  if (target <= 0) status = "no_target";
  else if (achieved >= expected) status = "ahead";
  else if (gap * 100 <= behindPct * target) status = "slightly_behind";
  else status = "behind";

  return { expected, gap, remaining, requiredDaily, status, pct };
}

/** `recorded`: a closed day on a line with no target, so there is no rate to hit or miss. */
export type DayMark = "hit" | "below" | "recorded" | "missing" | "today" | "future" | "off";

export function markDay(i: {
  date: ISODate;
  today: ISODate;
  isSellingDay: boolean;
  amount: number | null;
  target: number;
  total: number;
}): DayMark {
  if (!i.isSellingDay) return "off";
  if (i.date > i.today) return "future";
  if (i.amount === null) return i.date === i.today ? "today" : "missing";
  if (i.target <= 0) return "recorded";
  return i.amount * i.total >= i.target ? "hit" : "below";
}

/** What is needed per selling day strictly after `today`; null when no selling days remain. */
export function nextDayRequired(remaining: number, sellingDays: ISODate[], today: ISODate): number | null {
  const after = sellingDays.filter((d) => d > today).length;
  return after > 0 ? ceilDiv(Math.max(0, remaining), after) : null;
}

/**
 * What the home panel says about today. A day off never asks the rep to sell: it names the next
 * selling day's need instead.
 */
export function todayNeed(i: {
  isSellingDay: boolean;
  hasClosedToday: boolean;
  requiredDaily: number | null;
  nextDayRequired: number | null;
  noTarget: boolean;
}): { kind: "need" | "done" | "off" | "none"; amount: number | null } {
  if (i.hasClosedToday) return { kind: "done", amount: i.nextDayRequired };
  if (i.noTarget) return { kind: "none", amount: null };
  if (!i.isSellingDay) return { kind: "off", amount: i.nextDayRequired };
  if (i.requiredDaily === null) return { kind: "none", amount: null };
  return { kind: "need", amount: i.requiredDaily };
}
