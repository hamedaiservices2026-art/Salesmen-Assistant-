import { and, desc, eq, gte, lte, min } from "drizzle-orm";
import type { ISODate } from "@/domain/calendar";
import { evaluateScheme } from "@/domain/commission";
import { reconcile } from "@/domain/reconciliation";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { currentDay } from "@/server/today";
import {
  loadCalendar,
  loadMonthTotals,
  loadScheme,
  monthBounds,
  schemeInput,
} from "./month-data";

export type HistoryMonth = {
  year: number;
  month: number;
  lines: {
    lineId: string;
    pct: number | null;
  }[]; /** Null when the company has no published scheme for the month. */
  commission: number | null;
};
export type HistoryDay = {
  date: ISODate;
  lines: Record<string, number>;
  /** Lines an admin's Excel upload set, with what the rep typed himself (null when nothing). */
  admin: Record<string, { amount: number; repAmount: number | null }>;
  cashToHandOver: number;
  /** Created by an admin's upload and not yet confirmed by the rep: an open day. */
  draft: boolean;
};

/** Months in which the rep has a close or a target, newest first. */
async function activeMonths(
  ctx: Ctx,
): Promise<{ year: number; month: number }[]> {
  const [targetRows, closeRows] = await Promise.all([
    ctx.db
      .selectDistinct({ year: s.targets.year, month: s.targets.month })
      .from(s.targets)
      .where(
        and(
          eq(s.targets.companyId, ctx.companyId),
          eq(s.targets.userId, ctx.userId),
        ),
      ),
    ctx.db
      .selectDistinct({ date: s.dailyCloses.date })
      .from(s.dailyCloses)
      .where(
        and(
          eq(s.dailyCloses.companyId, ctx.companyId),
          eq(s.dailyCloses.userId, ctx.userId),
        ),
      ),
  ]);
  const keys = new Set<number>(targetRows.map((r) => r.year * 100 + r.month));
  for (const r of closeRows)
    keys.add(Number(r.date.slice(0, 4)) * 100 + Number(r.date.slice(5, 7)));
  return [...keys]
    .sort((a, b) => b - a)
    .map((k) => ({ year: Math.floor(k / 100), month: k % 100 }));
}

export async function getHistoryMonths(
  ctx: Ctx,
  opts: { today?: ISODate } = {},
): Promise<HistoryMonth[]> {
  const today = opts.today ?? currentDay(ctx.timeZone);
  const thisMonth = today.slice(0, 7);
  // A month later than today's has no history yet (a target set ahead of time is not listed).
  const months = (await activeMonths(ctx)).filter((m) => m.year * 100 + m.month <= Number(thisMonth.replace("-", "")));
  return Promise.all(
    months.map(async ({ year, month }) => {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const past = key < thisMonth;
      // A past month's published scheme is evaluated on all of the company's lines, the ones turned off
      // since included, so turning a line off never rewrites what that month paid (R23a).
      const [totals, scheme, allTotals] = await Promise.all([
        loadMonthTotals(ctx, year, month),
        loadScheme(ctx, year, month),
        past ? loadMonthTotals(ctx, year, month, { includeInactive: true }) : null,
      ]);
      const lines = totals.lines.map((l) => {
        const target = totals.targets.get(l.lineId) ?? 0;
        const achieved = totals.achieved.get(l.lineId) ?? 0;
        return {
          lineId: l.lineId,
          pct: target > 0 ? Math.floor((achieved * 100) / target) : null,
        };
      });
      const asOf = past ? monthBounds(year, month).end : today;
      const commission = scheme
        ? evaluateScheme(scheme, schemeInput(allTotals ?? totals), { asOf }).total
        : null;
      return { year, month, lines, commission };
    }),
  );
}

/** The rep's closes in a month, newest first, with per-line amounts and cash to hand over. */
export async function getHistoryDays(
  ctx: Ctx,
  year: number,
  month: number,
): Promise<HistoryDay[]> {
  const { start, end } = monthBounds(year, month);
  const closes = await ctx.db
    .select()
    .from(s.dailyCloses)
    .where(
      and(
        eq(s.dailyCloses.companyId, ctx.companyId),
        eq(s.dailyCloses.userId, ctx.userId),
        gte(s.dailyCloses.date, start),
        lte(s.dailyCloses.date, end),
      ),
    )
    .orderBy(desc(s.dailyCloses.date));
  if (closes.length === 0) return [];

  const lineRows = await ctx.db
    .select({
      closeId: s.closeLines.closeId,
      lineId: s.closeLines.lineId,
      amount: s.closeLines.amount,
      source: s.closeLines.source,
      repAmount: s.closeLines.repAmount,
    })
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
    );
  const byClose = new Map<string, Record<string, number>>();
  const adminByClose = new Map<string, HistoryDay["admin"]>();
  for (const r of lineRows) {
    const rec = byClose.get(r.closeId) ?? {};
    rec[r.lineId] = r.amount;
    byClose.set(r.closeId, rec);
    if (r.source === "excel") {
      const admin = adminByClose.get(r.closeId) ?? {};
      admin[r.lineId] = { amount: r.amount, repAmount: r.repAmount };
      adminByClose.set(r.closeId, admin);
    }
  }

  return closes.map((c) => ({
    date: c.date,
    lines: byClose.get(c.id) ?? {},
    admin: adminByClose.get(c.id) ?? {},
    cashToHandOver: reconcile(c).cashToHandOver,
    draft: c.status === "draft",
  }));
}

/**
 * The date of the rep's earliest confirmed close, or null. Upload-created drafts are open days
 * and never set the cutoff, so a draft cannot pull the gap rows back before the rep started.
 */
export async function getFirstCloseDate(ctx: Ctx): Promise<ISODate | null> {
  const [row] = await ctx.db
    .select({ first: min(s.dailyCloses.date) })
    .from(s.dailyCloses)
    .where(
      and(
        eq(s.dailyCloses.companyId, ctx.companyId),
        eq(s.dailyCloses.userId, ctx.userId),
        eq(s.dailyCloses.status, "confirmed"),
      ),
    );
  return row?.first ?? null;
}

/** The company's selling days of a month (weekdays minus holidays), ascending. */
export async function getMonthSellingDays(
  ctx: Ctx,
  year: number,
  month: number,
): Promise<ISODate[]> {
  return (await loadCalendar(ctx, year, month)).selling;
}
