import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { ISODate } from "@/domain/calendar";
import * as s from "@/db/schema";
import type { Db } from "@/db/client";
import { assertOwnContext } from "@/server/auth/roles";
import { AMOUNT_MAX, maxAmountFor, type Unit } from "@/domain/money";
import type { Ctx } from "@/server/ctx";
import { currentDay } from "@/server/today";
import { isDailyLine } from "@/domain/lines";
import { loadCalendar, loadLines } from "./month-data";
import { isFileId } from "@/domain/files";
import { CLOSE_PHOTOS_MAX, RETURN_PHOTOS_MAX, attachFiles, inRetention } from "@/server/files/files";
import { consumeDraftReceipt } from "@/server/ai/drafts";

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
  returns: CloseReturn[];
  note: string;
};

/** A returned item. `photos` are file ids of the rep's return photos; absent means none (R52). */
export type CloseReturn = { description: string; quantity: number; reason: ReturnReason; photos?: string[] };

/** What the rep sees for a line an admin's Excel upload set: the admin's amount and, when he typed his own, his. */
export type AdminLine = { amount: number; repAmount: number | null };
/** `draft`: created by an admin's upload and not yet confirmed by the rep (its money and stock fields are not his entries). */
export type SavedClose = Omit<CloseForm, "returns"> & {
  /** Each return with the ids of its photos that are not deleted, oldest first (always set; R52). */
  returns: (Omit<CloseReturn, "photos"> & { photos: string[] })[];
  admin: Record<string, AdminLine>;
  draft: boolean;
};

export type SaveCloseResult = { ok: true } | { ok: false; errors: Record<string, string> };

const NUMBER_FIELDS = ["cashSales", "creditSales", "collections", "expenses", "loaded", "sold", "returned"] as const;
const REASONS: readonly string[] = ["expired", "damaged", "other"];

/** The rep's close for a date, or null. */
export async function getClose(ctx: Ctx, date: ISODate): Promise<SavedClose | null> {
  const [close] = await ctx.db
    .select()
    .from(s.dailyCloses)
    .where(
      and(eq(s.dailyCloses.companyId, ctx.companyId), eq(s.dailyCloses.userId, ctx.userId), eq(s.dailyCloses.date, date)),
    );
  if (!close) return null;
  const inClose = <T extends typeof s.closeLines | typeof s.closeFocus | typeof s.returns>(t: T) =>
    and(eq(t.closeId, close.id), eq(t.companyId, ctx.companyId));
  const [lines, focus, returns, photos] = await Promise.all([
    ctx.db.select().from(s.closeLines).where(inClose(s.closeLines)),
    ctx.db.select().from(s.closeFocus).where(inClose(s.closeFocus)),
    ctx.db.select().from(s.returns).where(inClose(s.returns)).orderBy(asc(s.returns.createdAt), asc(s.returns.id)),
    ctx.db
      .select({ id: s.files.id, pos: s.files.returnPos })
      .from(s.files)
      .where(
        and(
          eq(s.files.closeId, close.id),
          eq(s.files.companyId, ctx.companyId),
          eq(s.files.userId, ctx.userId),
          eq(s.files.kind, "return"),
          isNull(s.files.deletedAt),
          inRetention(new Date()),
        ),
      )
      .orderBy(asc(s.files.createdAt), asc(s.files.id)),
  ]);
  const photosAt = (i: number) => photos.filter((p) => p.pos === i).map((p) => p.id);
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
    returns: returns.map((r, i) => ({ description: r.description, quantity: r.quantity, reason: r.reason, photos: photosAt(i) })),
    note: close.note ?? "",
    draft: close.status === "draft",
    admin: Object.fromEntries(
      lines.filter((l) => l.source === "excel").map((l) => [l.lineId, { amount: l.amount, repAmount: l.repAmount }]),
    ),
  };
}

function amountError(n: unknown, max: number = AMOUNT_MAX): string | null {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) return "invalid";
  if (n > max) return "invalid";
  return n < 0 ? "negative" : null;
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * Why a close cannot be made for `date`, or null: not a real `YYYY-MM-DD` date (`invalid`), after
 * `today` (`future`), or not a selling day of the caller's company (`not_selling_day`). The same
 * checks for a typed close and for a photo or voice draft (Task 11).
 */
export async function closeDateError(ctx: Ctx, date: string, today: ISODate): Promise<"invalid" | "future" | "not_selling_day" | null> {
  if (typeof date !== "string" || !isRealDate(date)) return "invalid";
  if (date > today) return "future";
  const [year, month] = date.split("-").map(Number) as [number, number];
  const cal = await loadCalendar(ctx, year, month);
  return cal.selling.includes(date) ? null : "not_selling_day";
}

async function validate(ctx: Ctx, form: CloseForm, today: ISODate, now: Date): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  const dateError = await closeDateError(ctx, form.date, today);
  if (dateError) errors.date = dateError;

  const lineUnits = new Map<string, Unit>((await loadLines(ctx)).filter(isDailyLine).map((l) => [l.lineId, l.unit]));
  for (const [id, n] of Object.entries(form.lines)) {
    const unit = lineUnits.get(id);
    const e = unit ? amountError(n, maxAmountFor(unit)) : "unknown";
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

  if (errors.date === undefined) Object.assign(errors, await photoErrors(ctx, form, now));
  return errors;
}

/**
 * The return photos of a form: at most `RETURN_PHOTOS_MAX` per return and `CLOSE_PHOTOS_MAX` per
 * close (`too_many`, on the return that passes the limit); then each id must be a well-formed id,
 * listed once, of a `return` photo of the caller's company and user, unattached or on this day's
 * close (`unknown` otherwise: the same code for another rep's photo and for one that does not
 * exist). His own photo that is deleted or past its retention is `expired`, and also named on its
 * own (`photo.<id>`) so the screen can mark it (R70).
 */
async function photoErrors(ctx: Ctx, form: CloseForm, now: Date): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  let total = 0;
  form.returns.forEach((r, i) => {
    const n = r.photos?.length ?? 0;
    total += n;
    if (n > RETURN_PHOTOS_MAX || total > CLOSE_PHOTOS_MAX) errors[`returns.${i}.photos`] = "too_many";
  });
  if (Object.keys(errors).length > 0) return errors;

  const ids = form.returns.flatMap((r) => (r.photos ?? []).filter(isFileId));
  if (ids.length === 0 && !form.returns.some((r) => (r.photos?.length ?? 0) > 0)) return errors;
  const [close] = await ctx.db
    .select({ id: s.dailyCloses.id })
    .from(s.dailyCloses)
    .where(and(eq(s.dailyCloses.companyId, ctx.companyId), eq(s.dailyCloses.userId, ctx.userId), eq(s.dailyCloses.date, form.date)));
  const rows = ids.length
    ? await ctx.db
        .select({
          id: s.files.id,
          kind: s.files.kind,
          closeId: s.files.closeId,
          deleted: sql<boolean>`${s.files.deletedAt} is not null`,
          kept: sql<boolean>`${inRetention(now)}`,
        })
        .from(s.files)
        .where(and(inArray(s.files.id, ids), eq(s.files.companyId, ctx.companyId), eq(s.files.userId, ctx.userId)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  form.returns.forEach((r, i) => {
    let code: "unknown" | "expired" | null = null;
    for (const id of r.photos ?? []) {
      const row = isFileId(id) && !seen.has(id) ? byId.get(id) : undefined;
      seen.add(id);
      if (!row || row.kind !== "return") {
        code = "unknown";
      } else if (row.closeId !== null && row.closeId !== close?.id) {
        // His own photo, on another day's close: also named on its own, so the screen can mark it.
        errors[`photo.${id}`] = "unknown";
        code = "unknown";
      } else if (row.deleted || !row.kept) {
        errors[`photo.${id}`] = "expired";
        code ??= "expired";
      }
    }
    if (code) errors[`returns.${i}.photos`] = code;
  });
  return errors;
}

/** Thrown inside the save's transaction to roll it back when a photo could not be attached. */
class PhotosMissing extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("photos missing");
  }
}

/**
 * Validates and upserts the rep's close for form.date, replacing its line, focus and return rows.
 * `draftId` names the receipt of an AI draft the rep reviewed (Task 11): it is used inside the same
 * transaction, after the form has passed exactly the checks a typed close passes (a receipt adds no
 * trust), and only stamps the close's `source`; any miss saves the close as `manual`.
 */
export async function saveClose(
  ctx: Ctx,
  form: CloseForm,
  opts?: { today?: ISODate; now?: Date; draftId?: string | null },
): Promise<SaveCloseResult> {
  assertOwnContext(ctx);
  const today = opts?.today ?? currentDay(ctx.timeZone);
  const now = opts?.now ?? new Date();
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
  try {
    return await saveInTransaction(ctx, form, today, now, values, opts?.draftId ?? null);
  } catch (e) {
    if (e instanceof PhotosMissing) return { ok: false, errors: e.errors };
    throw e;
  }
}

async function saveInTransaction(
  ctx: Ctx,
  form: CloseForm,
  today: ISODate,
  now: Date,
  base: Omit<typeof s.dailyCloses.$inferInsert, "id" | "companyId" | "userId" | "date">,
  draftId: string | null,
): Promise<SaveCloseResult> {
  const companyId = ctx.companyId;
  return ctx.db.transaction(async (tx): Promise<SaveCloseResult> => {
    // Validated inside the transaction so what is checked is what is written.
    const errors = await validate({ ...ctx, db: tx as unknown as Db }, form, today, now);
    if (Object.keys(errors).length > 0) return { ok: false, errors };

    // The receipt is used only once the form is valid, in this transaction: a save that is rolled
    // back (a return photo gone) leaves it unused. A miss is silent; the close is then `manual`.
    const receipt = draftId !== null && isFileId(draftId) ? await consumeDraftReceipt(tx as unknown as Db, ctx, { id: draftId, date: form.date }, now) : null;
    const values = receipt ? { ...base, source: receipt.source } : base;

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
    // no-longer-offered focus items on an older day stay as they were. A line an admin's upload set
    // (`source 'excel'`) keeps its amount; what the rep typed goes to `rep_amount`. The close row is
    // locked by the upsert above, so an upload applying at the same moment waits and then sees this.
    const lineIds = Object.keys(form.lines);
    const excel = new Map<string, number>();
    if (lineIds.length) {
      const stored = await tx
        .select({ lineId: s.closeLines.lineId, amount: s.closeLines.amount, source: s.closeLines.source })
        .from(s.closeLines)
        .where(and(eq(s.closeLines.closeId, closeId), eq(s.closeLines.companyId, companyId), inArray(s.closeLines.lineId, lineIds)));
      for (const r of stored) if (r.source === "excel") excel.set(r.lineId, r.amount);
      const repIds = lineIds.filter((id) => !excel.has(id));
      if (repIds.length) {
        await tx
          .delete(s.closeLines)
          .where(and(eq(s.closeLines.closeId, closeId), eq(s.closeLines.companyId, companyId), inArray(s.closeLines.lineId, repIds)));
      }
      for (const [lineId, adminAmount] of excel) {
        // What he typed is kept only when it differs from the admin's figure; an untouched prefill
        // leaves any earlier value of his as it was.
        if (form.lines[lineId] === adminAmount) continue;
        await tx
          .update(s.closeLines)
          .set({ repAmount: form.lines[lineId]!, updatedAt: new Date() })
          .where(and(eq(s.closeLines.closeId, closeId), eq(s.closeLines.companyId, companyId), eq(s.closeLines.lineId, lineId)));
      }
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

    // Inserted in line id order (like the focus rows below): the foreign-key checks take row locks in
    // the same order everywhere, so two closes and a scheme publish cannot wait on each other.
    const lines = Object.entries(form.lines)
      .filter(([lineId]) => !excel.has(lineId))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([lineId, amount]) => ({
      id: randomUUID(),
      companyId,
      closeId,
      lineId,
      amount,
    }));
    if (lines.length) await tx.insert(s.closeLines).values(lines);
    await syncCollections(tx as unknown as Db, companyId, closeId);
    // Inserted in focus id order: the foreign-key checks take row locks in the same order as a scheme publish.
    const focus = Object.entries(form.focus)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([focusItemId, amount]) => ({
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
        .values(
          form.returns.map((r, i) => ({
            id: `${closeId}-r${String(i).padStart(3, "0")}`,
            companyId,
            closeId,
            description: r.description,
            quantity: r.quantity,
            reason: r.reason,
          })),
        );
    }
    await syncReturnPhotos(tx as unknown as Db, ctx, closeId, form, now);
    if (receipt?.source === "photo" && receipt.fileId !== null) {
      // The report photo goes with the close (one conditional UPDATE: his, a report, not deleted,
      // inside retention, unattached or on this close). If it is gone (swept or removed), the close
      // is still saved: it is the rep's own reviewed figures, and the photo is only its evidence.
      const { missing } = await attachFiles(tx as unknown as Db, ctx, closeId, [{ id: receipt.fileId, kind: "report", returnPos: null }], now);
      if (missing.length > 0) console.error("report photo not attached: gone before the close was confirmed");
      else {
        // One report photo per close: the one the figures were last read from. Earlier ones are
        // soft-deleted and the sweep removes them (R74).
        await tx
          .update(s.files)
          .set({ deletedAt: now })
          .where(
            and(
              eq(s.files.closeId, closeId),
              eq(s.files.companyId, ctx.companyId),
              eq(s.files.userId, ctx.userId),
              eq(s.files.kind, "report"),
              isNull(s.files.deletedAt),
              ne(s.files.id, receipt.fileId),
            ),
          );
      }
    }
    return { ok: true };
  });
}

/**
 * Links the listed photos to their return rows (by close and position, as the return rows are
 * replaced on every save) and soft-deletes this close's other return photos, which the sweep then
 * removes. A photo that cannot be attached any more (removed or swept since the check) rolls the
 * whole save back with `expired` for it: a photo is never dropped silently (R70).
 */
async function syncReturnPhotos(tx: Db, ctx: Ctx, closeId: string, form: CloseForm, now: Date): Promise<void> {
  const items = form.returns.flatMap((r, i) => (r.photos ?? []).map((id) => ({ id, kind: "return" as const, returnPos: i })));
  if (items.length > 0) {
    const { missing } = await attachFiles(tx, ctx, closeId, items, now);
    if (missing.length > 0) {
      const errors: Record<string, string> = {};
      for (const id of missing) {
        errors[`photo.${id}`] = "expired";
        const at = items.find((it) => it.id === id)!.returnPos;
        errors[`returns.${at}.photos`] = "expired";
      }
      throw new PhotosMissing(errors);
    }
  }
  const listed = items.map((it) => it.id);
  await tx
    .update(s.files)
    .set({ deletedAt: now })
    .where(
      and(
        eq(s.files.closeId, closeId),
        eq(s.files.companyId, ctx.companyId),
        eq(s.files.userId, ctx.userId),
        eq(s.files.kind, "return"),
        isNull(s.files.deletedAt),
        ...(listed.length > 0 ? [notInArray(s.files.id, listed)] : []),
      ),
    );
}

/**
 * `collections` always equals the sum of the close's stored collection-line amounts (the admin's
 * where an upload set the line, the rep's otherwise). The form derives it from what was typed, so
 * when any collection line is admin-set it is recomputed from what is stored, whatever was posted.
 */
async function syncCollections(db: Db, companyId: string, closeId: string): Promise<void> {
  const rows = await db
    .select({ amount: s.closeLines.amount, source: s.closeLines.source })
    .from(s.closeLines)
    .innerJoin(s.targetLines, eq(s.targetLines.id, s.closeLines.lineId))
    .where(
      and(
        eq(s.closeLines.closeId, closeId),
        eq(s.closeLines.companyId, companyId),
        eq(s.targetLines.companyId, companyId),
        eq(s.targetLines.active, true),
        eq(s.targetLines.kind, "collection"),
      ),
    );
  if (!rows.some((r) => r.source === "excel")) return;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  await db
    .update(s.dailyCloses)
    .set({ collections: total })
    .where(and(eq(s.dailyCloses.id, closeId), eq(s.dailyCloses.companyId, companyId)));
}
