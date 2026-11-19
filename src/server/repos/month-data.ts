import type { LineKind } from "@/domain/lines";
// Internal loaders shared by the rep repos. Every query is scoped to ctx.companyId and,
// for per-rep rows, ctx.userId.
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { monthGrid, sellingDays, todayIn, type ISODate } from "@/domain/calendar";
import type { Scheme, SchemeInput } from "@/domain/commission";
import type { Unit } from "@/domain/money";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { latestCoverage, type CoverageInfo } from "./coverage";

export type MonthCalendar = {
  start: ISODate;
  end: ISODate;
  dates: ISODate[]; // every day of the month
  selling: ISODate[];
  weekStartsOn: number;
};

export type LineInfo = {
  lineId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  unit: Unit;
  kind: LineKind;
  /** The date the line was created, in the company's time zone. */
  createdOn: ISODate;
};

export type FocusTotal = {
  id: string;
  name: string;
  nameEn: string | null;
  nameUr: string | null;
  unit: Unit;
  target: number;
  startsOn: ISODate;
  endsOn: ISODate;
  achieved: number; // limited to the item's own window
};

export type MonthTotals = {
  lines: LineInfo[];
  targets: Map<string, number>;
  achieved: Map<string, number>;
  focus: FocusTotal[];
  /** The rep's latest coverage per coverage line; those lines' target and achieved come from it. */
  coverage: Map<string, CoverageInfo>;
};

export function monthBounds(year: number, month: number): { start: ISODate; end: ISODate; dates: ISODate[] } {
  const dates = monthGrid(year, month, 0).filter((d): d is ISODate => d !== null);
  return { start: dates[0]!, end: dates[dates.length - 1]!, dates };
}

/** Selling days from the company's weekdays and holidays. */
export async function loadCalendar(ctx: Ctx, year: number, month: number): Promise<MonthCalendar> {
  const { start, end, dates } = monthBounds(year, month);
  const [company] = await ctx.db
    .select({ sellingWeekdays: s.companies.sellingWeekdays, weekStartsOn: s.companies.weekStartsOn })
    .from(s.companies)
    .where(eq(s.companies.id, ctx.companyId));
  if (!company) throw new Error("company not found");
  const holidays = await ctx.db
    .select({ date: s.holidays.date })
    .from(s.holidays)
    .where(and(eq(s.holidays.companyId, ctx.companyId), gte(s.holidays.date, start), lte(s.holidays.date, end)));
  return {
    start,
    end,
    dates,
    selling: sellingDays(year, month, company.sellingWeekdays, holidays.map((h) => h.date)),
    weekStartsOn: company.weekStartsOn,
  };
}

/** Active target lines of the company, in display order, coverage lines included (see isDailyLine). */
export async function loadLines(ctx: Ctx): Promise<LineInfo[]> {
  const rows = await ctx.db
    .select()
    .from(s.targetLines)
    .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.active, true)))
    .orderBy(asc(s.targetLines.sort), asc(s.targetLines.id));
  return rows.map((r) => ({
    lineId: r.id,
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    nameUr: r.nameUr,
    unit: r.unit,
    kind: r.kind,
    createdOn: todayIn(ctx.timeZone, r.createdAt),
  }));
}

async function loadTargets(ctx: Ctx, year: number, month: number): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ lineId: s.targets.lineId, amount: s.targets.amount })
    .from(s.targets)
    .where(
      and(
        eq(s.targets.companyId, ctx.companyId),
        eq(s.targets.userId, ctx.userId),
        eq(s.targets.year, year),
        eq(s.targets.month, month),
      ),
    );
  return new Map(rows.map((r) => [r.lineId, r.amount]));
}

/** Per-line sums over the rep's closes dated within [start, end], whatever their status. */
async function loadLineSums(ctx: Ctx, start: ISODate, end: ISODate): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ lineId: s.closeLines.lineId, total: sql<string>`sum(${s.closeLines.amount})`.mapWith(Number) })
    .from(s.closeLines)
    .innerJoin(s.dailyCloses, eq(s.closeLines.closeId, s.dailyCloses.id))
    .where(
      and(
        eq(s.closeLines.companyId, ctx.companyId),
        eq(s.dailyCloses.companyId, ctx.companyId),
        eq(s.dailyCloses.userId, ctx.userId),
        gte(s.dailyCloses.date, start),
        lte(s.dailyCloses.date, end),
      ),
    )
    .groupBy(s.closeLines.lineId);
  return new Map(rows.map((r) => [r.lineId, r.total]));
}

/** Focus items assigned to the rep whose window overlaps [start, end], with window-limited sums. */
async function loadFocus(ctx: Ctx, start: ISODate, end: ISODate): Promise<FocusTotal[]> {
  const items = await ctx.db
    .select({
      id: s.focusItems.id,
      name: s.focusItems.name,
      nameEn: s.focusItems.nameEn,
      nameUr: s.focusItems.nameUr,
      unit: s.focusItems.unit,
      target: s.focusItems.target,
      startsOn: s.focusItems.startsOn,
      endsOn: s.focusItems.endsOn,
    })
    .from(s.focusItems)
    .innerJoin(s.focusAssignments, eq(s.focusAssignments.focusItemId, s.focusItems.id))
    .where(
      and(
        eq(s.focusItems.companyId, ctx.companyId),
        eq(s.focusAssignments.companyId, ctx.companyId),
        eq(s.focusAssignments.userId, ctx.userId),
        lte(s.focusItems.startsOn, end),
        gte(s.focusItems.endsOn, start),
      ),
    )
    .orderBy(asc(s.focusItems.startsOn), asc(s.focusItems.id));
  if (items.length === 0) return [];

  const sums = await ctx.db
    .select({ id: s.closeFocus.focusItemId, total: sql<string>`sum(${s.closeFocus.amount})`.mapWith(Number) })
    .from(s.closeFocus)
    .innerJoin(s.dailyCloses, eq(s.closeFocus.closeId, s.dailyCloses.id))
    .innerJoin(s.focusItems, eq(s.closeFocus.focusItemId, s.focusItems.id))
    .where(
      and(
        eq(s.closeFocus.companyId, ctx.companyId),
        eq(s.dailyCloses.companyId, ctx.companyId),
        eq(s.dailyCloses.userId, ctx.userId),
        inArray(
          s.closeFocus.focusItemId,
          items.map((i) => i.id),
        ),
        gte(s.dailyCloses.date, s.focusItems.startsOn),
        lte(s.dailyCloses.date, s.focusItems.endsOn),
      ),
    )
    .groupBy(s.closeFocus.focusItemId);
  const byId = new Map(sums.map((r) => [r.id, r.total]));
  return items.map((i) => ({ ...i, achieved: byId.get(i.id) ?? 0 }));
}

/**
 * Lines, the rep's targets, his per-line sums for the month, and his focus items. A coverage line has
 * no target row and no close amounts: its target is the customers in his territory (`total`) and its
 * achieved the customers covered, from his latest coverage update of the month (0 and 0 without one).
 */
export async function loadMonthTotals(ctx: Ctx, year: number, month: number): Promise<MonthTotals> {
  const { start, end } = monthBounds(year, month);
  const [lines, targets, achieved, focus, coverage] = await Promise.all([
    loadLines(ctx),
    loadTargets(ctx, year, month),
    loadLineSums(ctx, start, end),
    loadFocus(ctx, start, end),
    latestCoverage(ctx, year, month),
  ]);
  for (const l of lines) {
    if (l.kind !== "coverage") continue;
    const c = coverage.get(l.lineId);
    targets.set(l.lineId, c?.total ?? 0);
    achieved.set(l.lineId, c?.covered ?? 0);
  }
  return { lines, targets, achieved, focus, coverage };
}

export function schemeInput(t: MonthTotals): SchemeInput {
  return {
    lines: Object.fromEntries(
      t.lines.map((l) => [
        l.lineId,
        {
          target: t.targets.get(l.lineId) ?? 0,
          achieved: t.achieved.get(l.lineId) ?? 0,
          // Coverage is a count as of a date, not a running total: the projection keeps it as entered.
          ...(l.kind === "coverage" ? { hold: true } : {}),
        },
      ]),
    ),
    focus: Object.fromEntries(t.focus.map((f) => [f.id, { achieved: f.achieved }])),
  };
}

/** The company's published scheme for the month, if any. */
export async function loadScheme(ctx: Ctx, year: number, month: number): Promise<Scheme | null> {
  const [row] = await ctx.db
    .select({ id: s.schemes.id, name: s.schemes.name, components: s.schemes.components })
    .from(s.schemes)
    .where(
      and(
        eq(s.schemes.companyId, ctx.companyId),
        eq(s.schemes.year, year),
        eq(s.schemes.month, month),
        eq(s.schemes.published, true),
      ),
    );
  return row ?? null;
}
