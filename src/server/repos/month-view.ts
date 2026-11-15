import { and, eq, gte, lte } from "drizzle-orm";
import { dayCounts, type ISODate } from "@/domain/calendar";
import type { Unit } from "@/domain/money";
import { computePace, markDay, nextDayRequired, type DayMark } from "@/domain/pace";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { loadCalendar, loadMonthTotals, type FocusTotal } from "./month-data";

export type LineView = {
  lineId: string;
  nameAr: string;
  nameEn: string;
  unit: Unit;
  kind: "sales" | "collection";
  target: number;
  achieved: number;
  pace: ReturnType<typeof computePace>;
  /** Needed per selling day after today (null when none remain). */
  nextDayRequired: number | null;
  days: { date: ISODate; mark: DayMark; amount: number | null }[]; // every day of the month
};

export type FocusView = {
  id: string;
  name: string;
  unit: Unit;
  target: number;
  startsOn: ISODate;
  endsOn: ISODate;
  achieved: number;
  perDay: number | null;
};

export type MonthView = {
  year: number;
  month: number;
  today: ISODate;
  counts: { total: number; elapsed: number; left: number };
  weekStartsOn: number;
  lines: LineView[];
  focus: FocusView[];
  hasClosedToday: boolean;
  /** Whether `today` is a selling day. */
  todaySelling: boolean;
};

/** ceil(remaining ÷ selling days left in the item's window from today); null when nothing is left. */
function focusPerDay(f: FocusTotal, selling: ISODate[], today: ISODate): number | null {
  const remaining = Math.max(0, f.target - f.achieved);
  const from = today > f.startsOn ? today : f.startsOn;
  const daysLeft = selling.filter((d) => d >= from && d <= f.endsOn).length;
  if (remaining === 0 || daysLeft === 0) return null;
  return Math.ceil(remaining / daysLeft);
}

/** Per-date line amounts of the rep's closes in the month. */
async function loadDayAmounts(ctx: Ctx, start: ISODate, end: ISODate) {
  const rows = await ctx.db
    .select({ date: s.dailyCloses.date, lineId: s.closeLines.lineId, amount: s.closeLines.amount })
    .from(s.dailyCloses)
    .leftJoin(
      s.closeLines,
      and(eq(s.closeLines.closeId, s.dailyCloses.id), eq(s.closeLines.companyId, ctx.companyId)),
    )
    .where(
      and(
        eq(s.dailyCloses.companyId, ctx.companyId),
        eq(s.dailyCloses.userId, ctx.userId),
        gte(s.dailyCloses.date, start),
        lte(s.dailyCloses.date, end),
      ),
    );
  const closedDates = new Set(rows.map((r) => r.date));
  const amounts = new Map<string, number>(); // `${lineId}|${date}`
  for (const r of rows) if (r.lineId !== null && r.amount !== null) amounts.set(`${r.lineId}|${r.date}`, r.amount);
  return { closedDates, amounts };
}

export async function getMonthView(
  ctx: Ctx,
  opts: { year: number; month: number; today: ISODate },
): Promise<MonthView> {
  const { year, month, today } = opts;
  const cal = await loadCalendar(ctx, year, month);
  const [totals, days] = await Promise.all([loadMonthTotals(ctx, year, month), loadDayAmounts(ctx, cal.start, cal.end)]);
  const counts = dayCounts(cal.selling, today);
  const selling = new Set(cal.selling);

  const lines: LineView[] = totals.lines.map((l) => {
    const target = totals.targets.get(l.lineId) ?? 0;
    const achieved = totals.achieved.get(l.lineId) ?? 0;
    return {
      ...l,
      target,
      achieved,
      pace: computePace({ target, achieved, ...counts }),
      nextDayRequired: nextDayRequired(Math.max(0, target - achieved), cal.selling, today),
      days: cal.dates.map((date) => {
        const amount = days.amounts.get(`${l.lineId}|${date}`) ?? null;
        const mark = markDay({ date, today, isSellingDay: selling.has(date), amount, target, total: counts.total });
        return { date, mark, amount };
      }),
    };
  });

  const focus: FocusView[] = totals.focus.map((f) => ({
    id: f.id,
    name: f.name,
    unit: f.unit,
    target: f.target,
    startsOn: f.startsOn,
    endsOn: f.endsOn,
    achieved: f.achieved,
    perDay: focusPerDay(f, cal.selling, today),
  }));

  return {
    year,
    month,
    today,
    counts,
    weekStartsOn: cal.weekStartsOn,
    lines,
    focus,
    hasClosedToday: days.closedDates.has(today),
    todaySelling: selling.has(today),
  };
}
