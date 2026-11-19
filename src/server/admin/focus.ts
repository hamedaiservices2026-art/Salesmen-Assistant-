import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { monthBounds } from "@/server/repos/month-data";
import { isISODate, referencedFocusIds } from "@/domain/commission";
import type { ISODate } from "@/domain/calendar";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { AMOUNT_MAX } from "./targets";

export type FocusRow = {
  id: string;
  name: string;
  nameEn: string | null;
  nameUr: string | null;
  sku: string | null;
  unit: "cases" | "value";
  target: number;
  startsOn: ISODate;
  endsOn: ISODate;
  repIds: string[];
  /** A published scheme's bonus or gate names this item: its window and unit are fixed. */
  inScheme: boolean;
};

export type FocusInput = {
  /** The item to change; omitted to create one. */
  id?: string;
  name: string;
  nameEn?: string;
  nameUr?: string;
  sku?: string;
  unit: "cases" | "value";
  /** In the stored unit: cases, or halalas for a value item. */
  target: number;
  startsOn: ISODate;
  endsOn: ISODate;
  repIds: string[];
};

export type SaveFocusResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

const NAME_MAX = 80;
const SKU_MAX = 40;
const REPS_MAX = 1000;

/**
 * What names a focus item, as ids of the company's `focus_items`. A focus item named here is "in
 * the scheme": its window and unit are fixed, because the scheme's bonus is valid only for exactly
 * that window. Reads the published components (a draft that names the item is checked when it is
 * published); to make another source count, add one entry. Publishing a scheme locks the items it
 * names (`loadSchemeRefs`) and `saveFocusItem` locks the item before this check, so the two take turns.
 */
const FOCUS_REFERENCES: ReadonlyArray<(db: Db, companyId: string) => Promise<string[]>> = [
  async (db, companyId) => {
    const rows = await db
      .select({ components: s.schemes.components })
      .from(s.schemes)
      .where(and(eq(s.schemes.companyId, companyId), eq(s.schemes.published, true)));
    return rows.flatMap((r) => referencedFocusIds(r.components));
  },
];

async function focusInScheme(db: Db, companyId: string): Promise<Set<string>> {
  const found = await Promise.all(FOCUS_REFERENCES.map((query) => query(db, companyId)));
  return new Set(found.flat());
}

/** The company's focus items whose window overlaps the month, with their reps. */
export async function listFocusItems(ctx: Ctx, period: { year: number; month: number }): Promise<FocusRow[]> {
  assertRole(ctx, ["admin"]);
  const { year, month } = period;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const { start, end } = monthBounds(year, month);
  const items = await ctx.db
    .select()
    .from(s.focusItems)
    .where(and(eq(s.focusItems.companyId, ctx.companyId), lte(s.focusItems.startsOn, end), gte(s.focusItems.endsOn, start)))
    .orderBy(asc(s.focusItems.startsOn), asc(s.focusItems.id));
  if (items.length === 0) return [];
  const [assigned, named] = await Promise.all([
    ctx.db
      .select({ itemId: s.focusAssignments.focusItemId, userId: s.focusAssignments.userId })
      .from(s.focusAssignments)
      .where(
        and(
          eq(s.focusAssignments.companyId, ctx.companyId),
          inArray(s.focusAssignments.focusItemId, items.map((i) => i.id)),
        ),
      )
      .orderBy(asc(s.focusAssignments.userId)),
    focusInScheme(ctx.db, ctx.companyId),
  ]);
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    nameEn: i.nameEn,
    nameUr: i.nameUr,
    sku: i.sku,
    unit: i.unit,
    target: i.target,
    startsOn: i.startsOn,
    endsOn: i.endsOn,
    repIds: assigned.filter((a) => a.itemId === i.id).map((a) => a.userId),
    inScheme: named.has(i.id),
  }));
}

const optional = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Creates a focus item or changes one of the caller's company, and replaces its assignments with
 * `repIds`, all in one transaction. Field problems come back as `errors[field] = code`: `required`,
 * `invalid`, `window_order` (on `endsOn`), `not_found` (`repIds` holds an id that is not an active
 * rep of the company, same answer for a missing id and another company's; `id` is not the
 * company's), `in_scheme` (a published bonus names the item: its window and unit are fixed) and
 * `in_use` (the unit of an item with recorded sales). The item's row is locked while it is saved, so
 * two saves, or a save and a publish, take turns.
 */
export async function saveFocusItem(ctx: Ctx, input: FocusInput): Promise<SaveFocusResult> {
  assertRole(ctx, ["admin"]);
  const errors: Record<string, string> = {};
  const name = optional(input.name);
  const nameEn = optional(input.nameEn);
  const nameUr = optional(input.nameUr);
  const sku = optional(input.sku);
  if (!name) errors.name = "required";
  for (const [field, value, max] of [["name", name, NAME_MAX], ["nameEn", nameEn, NAME_MAX], ["nameUr", nameUr, NAME_MAX], ["sku", sku, SKU_MAX]] as const) {
    if (value.length > max) errors[field] = "invalid";
  }
  if (input.unit !== "cases" && input.unit !== "value") errors.unit = "invalid";
  if (!Number.isSafeInteger(input.target) || input.target < 1 || input.target > AMOUNT_MAX) errors.target = "invalid";
  const datesOk = [input.startsOn, input.endsOn].map((d) => typeof d === "string" && isISODate(d));
  if (!datesOk[0]) errors.startsOn = "invalid";
  if (!datesOk[1]) errors.endsOn = "invalid";
  if (datesOk[0] && datesOk[1] && input.startsOn > input.endsOn) errors.endsOn = "window_order";
  const repIds = Array.isArray(input.repIds) ? [...new Set(input.repIds.map(String))] : null;
  if (repIds === null || repIds.length > REPS_MAX) errors.repIds = "invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as Db;
    let id: string;
    if (input.id === undefined) {
      id = randomUUID();
    } else {
      // The row lock makes a publish that names this item wait, so "in scheme" cannot change under this check.
      const [item] = await tx
        .select()
        .from(s.focusItems)
        .where(and(eq(s.focusItems.id, String(input.id)), eq(s.focusItems.companyId, ctx.companyId)))
        .for("update");
      if (!item) return { ok: false as const, errors: { id: "not_found" } };
      id = item.id;
      const windowMoved = item.startsOn !== input.startsOn || item.endsOn !== input.endsOn;
      const unitChanged = item.unit !== input.unit;
      if (windowMoved || unitChanged) {
        const locked: Record<string, string> = {};
        if ((await focusInScheme(tx, ctx.companyId)).has(id)) {
          if (item.startsOn !== input.startsOn) locked.startsOn = "in_scheme";
          if (item.endsOn !== input.endsOn) locked.endsOn = "in_scheme";
          if (unitChanged) locked.unit = "in_scheme";
        }
        if (unitChanged && !locked.unit) {
          const [used] = await tx
            .select({ id: s.closeFocus.id })
            .from(s.closeFocus)
            .where(and(eq(s.closeFocus.companyId, ctx.companyId), eq(s.closeFocus.focusItemId, id)))
            .limit(1);
          if (used) locked.unit = "in_use";
        }
        if (Object.keys(locked).length > 0) return { ok: false as const, errors: locked };
      }
    }

    // Reps: an assignment that already exists stays as it is, even when the rep has been turned off
    // since the form loaded; only ids being added must be active reps of this company. A missing id
    // and another company's give the same answer.
    const ids = repIds!;
    const existing =
      input.id === undefined
        ? new Set<string>()
        : new Set(
            (
              await tx
                .select({ userId: s.focusAssignments.userId })
                .from(s.focusAssignments)
                .where(and(eq(s.focusAssignments.focusItemId, id), eq(s.focusAssignments.companyId, ctx.companyId)))
            ).map((a) => a.userId),
          );
    const added = ids.filter((r) => !existing.has(r));
    if (added.length > 0) {
      const found = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.role, "rep"), eq(s.users.active, true), inArray(s.users.id, added)));
      if (found.length !== added.length) return { ok: false as const, errors: { repIds: "not_found" } };
    }

    const values = {
      name,
      nameEn: nameEn || null,
      nameUr: nameUr || null,
      sku: sku || null,
      unit: input.unit,
      target: input.target,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    };
    if (input.id === undefined) {
      await tx.insert(s.focusItems).values({ id, companyId: ctx.companyId, ...values });
    } else {
      await tx
        .update(s.focusItems)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(s.focusItems.id, id), eq(s.focusItems.companyId, ctx.companyId)));
    }
    // Unticked assignments go; new ones are added. An assignment to a rep who is turned off is never
    // touched (the form does not offer him, so it cannot say whether he was meant to stay).
    const keep = new Set(ids);
    const unticked = [...existing].filter((r) => !keep.has(r));
    const drop =
      unticked.length === 0
        ? []
        : (
            await tx
              .select({ id: s.users.id })
              .from(s.users)
              .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.active, true), inArray(s.users.id, unticked)))
          ).map((u) => u.id);
    if (drop.length > 0) {
      await tx
        .delete(s.focusAssignments)
        .where(and(eq(s.focusAssignments.focusItemId, id), eq(s.focusAssignments.companyId, ctx.companyId), inArray(s.focusAssignments.userId, drop)));
    }
    if (added.length > 0) {
      await tx.insert(s.focusAssignments).values(added.map((userId) => ({ id: randomUUID(), companyId: ctx.companyId, focusItemId: id, userId })));
    }
    return { ok: true as const, id };
  });
}

/** The active reps of the company a focus item can be given to, by name. */
export async function listAssignableReps(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  assertRole(ctx, ["admin"]);
  return ctx.db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.users)
    .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.role, "rep"), eq(s.users.active, true)))
    .orderBy(asc(s.users.name), asc(s.users.id));
}
