import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { ISODate } from "@/domain/calendar";
import * as s from "@/db/schema";
import type { Db } from "@/db/client";
import type { Ctx } from "@/server/ctx";
import { currentDay } from "@/server/today";
import { loadCalendar, loadLines } from "./month-data";

export type ReturnReason = "expired" | "damaged" | "other";

export type CloseForm = {
  date: ISODate;
  lines: Record<string, number>;
  focus: Record<string, number>;
  cashSales: number;
  creditSales: number;
  collections: number;
  expenses: number;
  loaded: number;
  sold: number;
  returned: number;
  returns: { description: string; quantity: number; reason: ReturnReason }[];
  note: string;
};

export type SaveCloseResult = { ok: true } | { ok: false; errors: Record<string, string> };

const NUMBER_FIELDS = ["cashSales", "creditSales", "collections", "expenses", "loaded", "sold", "returned"] as const;
const REASONS: readonly string[] = ["expired", "damaged", "other"];

/** The rep's close for a date, or null. */
export async function getClose(ctx: Ctx, date: ISODate): Promise<CloseForm | null> {
  const [close] = await ctx.db
    .select()
    .from(s.dailyCloses)
    .where(
      and(eq(s.dailyCloses.companyId, ctx.companyId), eq(s.dailyCloses.userId, ctx.userId), eq(s.dailyCloses.date, date)),
    );
  if (!close) return null;
  const inClose = <T extends typeof s.closeLines | typeof s.closeFocus | typeof s.returns>(t: T) =>
    and(eq(t.closeId, close.id), eq(t.companyId, ctx.companyId));
  const [lines, focus, returns] = await Promise.all([
    ctx.db.select().from(s.closeLines).where(inClose(s.closeLines)),
    ctx.db.select().from(s.closeFocus).where(inClose(s.closeFocus)),
    ctx.db.select().from(s.returns).where(inClose(s.returns)).orderBy(asc(s.returns.createdAt), asc(s.returns.id)),
  ]);
  return {
    date: close.date,
    lines: Object.fromEntries(lines.map((l) => [l.lineId, l.amount])),
    focus: Object.fromEntries(focus.map((f) => [f.focusItemId, f.amount])),
    cashSales: close.cashSales,
    creditSales: close.creditSales,
    collections: close.collections,
    expenses: close.expenses,
    loaded: close.loaded,
    sold: close.sold,
    returned: close.returned,
    returns: returns.map((r) => ({ description: r.description, quantity: r.quantity, reason: r.reason })),
    note: close.note ?? "",
  };
}

function amountError(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) return "invalid";
  return n < 0 ? "negative" : null;
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

async function validate(ctx: Ctx, form: CloseForm, today: ISODate): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  if (!isRealDate(form.date)) errors.date = "invalid";
  else if (form.date > today) errors.date = "future";
  else {
    const [year, month] = form.date.split("-").map(Number) as [number, number];
    const cal = await loadCalendar(ctx, year, month);
    if (!cal.selling.includes(form.date)) errors.date = "not_selling_day";
  }

  const lineIds = new Set((await loadLines(ctx)).map((l) => l.lineId));
  for (const [id, n] of Object.entries(form.lines)) {
    const e = lineIds.has(id) ? amountError(n) : "unknown";
    if (e) errors[`lines.${id}`] = e;
  }

  const assigned = await ctx.db
    .select({ id: s.focusAssignments.focusItemId, startsOn: s.focusItems.startsOn, endsOn: s.focusItems.endsOn })
    .from(s.focusAssignments)
    .innerJoin(s.focusItems, eq(s.focusItems.id, s.focusAssignments.focusItemId))
    .where(
      and(
        eq(s.focusAssignments.companyId, ctx.companyId),
        eq(s.focusItems.companyId, ctx.companyId),
        eq(s.focusAssignments.userId, ctx.userId),
      ),
    );
  const focusById = new Map(assigned.map((a) => [a.id, a]));
  for (const [id, n] of Object.entries(form.focus)) {
    const item = focusById.get(id);
    const inWindow = item && errors.date === undefined ? form.date >= item.startsOn && form.date <= item.endsOn : true;
    const e = !item ? "unknown" : !inWindow ? "outside_window" : amountError(n);
    if (e) errors[`focus.${id}`] = e;
  }

  for (const f of NUMBER_FIELDS) {
    const e = amountError(form[f]);
    if (e) errors[f] = e;
  }

  form.returns.forEach((r, i) => {
    const e = amountError(r.quantity);
    if (e) errors[`returns.${i}.quantity`] = e;
    if (!REASONS.includes(r.reason)) errors[`returns.${i}.reason`] = "invalid";
  });

  return errors;
}

/** Validates and upserts the rep's close for form.date, replacing its line, focus and return rows. */
export async function saveClose(ctx: Ctx, form: CloseForm, opts?: { today?: ISODate }): Promise<SaveCloseResult> {
  const today = opts?.today ?? currentDay(ctx.timeZone);
  const values = {
    source: "manual" as const,
    status: "confirmed" as const,
    cashSales: form.cashSales,
    creditSales: form.creditSales,
    collections: form.collections,
    expenses: form.expenses,
    loaded: form.loaded,
    sold: form.sold,
    returned: form.returned,
    note: form.note === "" ? null : form.note,
  };
  const companyId = ctx.companyId;

  return ctx.db.transaction(async (tx): Promise<SaveCloseResult> => {
    // Validated inside the transaction so what is checked is what is written.
    const errors = await validate({ ...ctx, db: tx as unknown as Db }, form, today);
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    const [close] = await tx
      .insert(s.dailyCloses)
      .values({ id: randomUUID(), companyId, userId: ctx.userId, date: form.date, ...values })
      .onConflictDoUpdate({
        target: [s.dailyCloses.userId, s.dailyCloses.date],
        set: { ...values, updatedAt: new Date() },
        setWhere: eq(s.dailyCloses.companyId, companyId),
      })
      .returning({ id: s.dailyCloses.id });
    if (!close) throw new Error("close upsert matched no row of the caller's company");
    const closeId = close.id;

    // Only the rows being submitted are replaced: amounts of since-deactivated lines or
    // no-longer-offered focus items on an older day stay as they were.
    const lineIds = Object.keys(form.lines);
    if (lineIds.length) {
      await tx
        .delete(s.closeLines)
        .where(
          and(eq(s.closeLines.closeId, closeId), eq(s.closeLines.companyId, companyId), inArray(s.closeLines.lineId, lineIds)),
        );
    }
    const focusIds = Object.keys(form.focus);
    if (focusIds.length) {
      await tx
        .delete(s.closeFocus)
        .where(
          and(
            eq(s.closeFocus.closeId, closeId),
            eq(s.closeFocus.companyId, companyId),
            inArray(s.closeFocus.focusItemId, focusIds),
          ),
        );
    }
    await tx.delete(s.returns).where(and(eq(s.returns.closeId, closeId), eq(s.returns.companyId, companyId)));

    const lines = Object.entries(form.lines).map(([lineId, amount]) => ({
      id: randomUUID(),
      companyId,
      closeId,
      lineId,
      amount,
    }));
    if (lines.length) await tx.insert(s.closeLines).values(lines);
    const focus = Object.entries(form.focus).map(([focusItemId, amount]) => ({
      id: randomUUID(),
      companyId,
      closeId,
      focusItemId,
      amount,
    }));
    if (focus.length) await tx.insert(s.closeFocus).values(focus);
    if (form.returns.length) {
      // One batch shares created_at, so the ids carry the position and getClose keeps the given order.
      await tx
        .insert(s.returns)
        .values(form.returns.map((r, i) => ({ id: `${closeId}-r${String(i).padStart(3, "0")}`, companyId, closeId, ...r })));
    }
    return { ok: true };
  });
}
