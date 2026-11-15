import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { ISODate } from "@/domain/calendar";
import { evaluateScheme } from "@/domain/commission";
import { reconcile } from "@/domain/reconciliation";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
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
  cashToHandOver: number;
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

export async function getHistoryMonths(ctx: Ctx): Promise<HistoryMonth[]> {
  const months = await activeMonths(ctx);
  return Promise.all(
    months.map(async ({ year, month }) => {
      const [totals, scheme] = await Promise.all([
        loadMonthTotals(ctx, year, month),
        loadScheme(ctx, year, month),
      ]);
      const lines = totals.lines.map((l) => {
        const target = totals.targets.get(l.lineId) ?? 0;
        const achieved = totals.achieved.get(l.lineId) ?? 0;
        return {
          lineId: l.lineId,
          pct: target > 0 ? Math.floor((achieved * 100) / target) : null,
        };
      });
      const commission = scheme
        ? evaluateScheme(scheme, schemeInput(totals)).total
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
  for (const r of lineRows) {
    const rec = byClose.get(r.closeId) ?? {};
    rec[r.lineId] = r.amount;
    byClose.set(r.closeId, rec);
  }

  return closes.map((c) => ({
    date: c.date,
    lines: byClose.get(c.id) ?? {},
    cashToHandOver: reconcile(c).cashToHandOver,
  }));
}

/** The company's selling days of a month (weekdays minus holidays), ascending. */
export async function getMonthSellingDays(
  ctx: Ctx,
  year: number,
  month: number,
): Promise<ISODate[]> {
  return (await loadCalendar(ctx, year, month)).selling;
}
