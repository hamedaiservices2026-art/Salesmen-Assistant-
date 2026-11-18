import { randomUUID } from "node:crypto";
import { and, asc, eq, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { referencedLineIds } from "@/domain/commission";
import { isLineCode, lineShapeError, type LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { isUniqueViolation } from "@/server/db-errors";
import type { LineInfo } from "@/server/repos/month-data";

export type LineRow = LineInfo & { sort: number; active: boolean; inUse: boolean };

export type LineInput = {
  /** The line to change; omitted to create one. */
  id?: string;
  code: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  unit: Unit;
  kind: LineKind;
  sort: number;
  active: boolean;
};

export type SaveLineResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };
export type LineActionResult = { ok: true } | { ok: false; error: "not_found" };

const NAME_MAX = 80;
const UNITS = ["cases", "value", "outlets"] as const satisfies readonly Unit[];
const KINDS = ["sales", "collection", "coverage"] as const satisfies readonly LineKind[];
const SORT_MAX = 100_000;

/**
 * Everything that refers to a `target_lines.id`: the tables that point at it, and the line ids that
 * scheme components name in their JSON (published components and saved drafts; not a foreign key).
 * A line named here is "in use": its code, unit and kind are fixed, because changing them would
 * change what the stored figures or a scheme mean. To make another table count (coverage updates),
 * add one entry; nothing else needs to change. Saving or publishing a scheme locks the lines it
 * names before validating, and `saveLine` locks the line before this check, so the two take turns.
 */
const LINE_REFERENCES: ReadonlyArray<(db: Db, companyId: string) => Promise<{ lineId: string }[]>> = [
  (db, companyId) =>
    db.selectDistinct({ lineId: s.targets.lineId }).from(s.targets).where(eq(s.targets.companyId, companyId)),
  (db, companyId) =>
    db.selectDistinct({ lineId: s.closeLines.lineId }).from(s.closeLines).where(eq(s.closeLines.companyId, companyId)),
  async (db, companyId) => {
    const rows = await db
      .select({ components: s.schemes.components, draft: s.schemes.draft })
      .from(s.schemes)
      .where(eq(s.schemes.companyId, companyId));
    return rows
      .flatMap((r) => [...referencedLineIds(r.components), ...referencedLineIds(r.draft)])
      .map((lineId) => ({ lineId }));
  },
];

/** The ids of the company's lines that something refers to. */
async function linesInUse(db: Db, companyId: string): Promise<Set<string>> {
  const found = await Promise.all(LINE_REFERENCES.map((query) => query(db, companyId)));
  return new Set(found.flat().map((r) => r.lineId));
}

/** All of the company's lines, active or not, in display order. */
export async function listAllLines(ctx: Ctx): Promise<LineRow[]> {
  assertRole(ctx, ["admin"]);
  const [rows, used] = await Promise.all([
    ctx.db
      .select()
      .from(s.targetLines)
      .where(eq(s.targetLines.companyId, ctx.companyId))
      .orderBy(asc(s.targetLines.sort), asc(s.targetLines.id)),
    linesInUse(ctx.db, ctx.companyId),
  ]);
  return rows.map((r) => ({
    lineId: r.id,
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    nameUr: r.nameUr,
    unit: r.unit,
    kind: r.kind,
    sort: r.sort,
    active: r.active,
    inUse: used.has(r.id),
  }));
}

/**
 * Creates a line or changes one of the caller's company. Field problems come back as
 * `errors[field] = code`; a line id outside the company is `errors.id = "not_found"`.
 * `unit` carries the shape errors of `lineShapeError`. Once a line is in use its code, unit and kind
 * are fixed (`in_use`); names, order and the active flag can always change.
 */
export async function saveLine(ctx: Ctx, input: LineInput): Promise<SaveLineResult> {
  assertRole(ctx, ["admin"]);
  const errors: Record<string, string> = {};
  const code = String(input.code ?? "").trim().toLowerCase();
  if (!isLineCode(code)) errors.code = "invalid";
  const nameAr = String(input.nameAr ?? "").trim();
  const nameEn = String(input.nameEn ?? "").trim();
  const nameUr = String(input.nameUr ?? "").trim();
  if (!nameAr) errors.nameAr = "required";
  for (const [field, value] of [["nameAr", nameAr], ["nameEn", nameEn], ["nameUr", nameUr]] as const) {
    if (value.length > NAME_MAX) errors[field] = "invalid";
  }
  const unitOk = UNITS.includes(input.unit);
  const kindOk = KINDS.includes(input.kind);
  if (!unitOk) errors.unit = "invalid";
  if (!kindOk) errors.kind = "invalid";
  if (unitOk && kindOk) {
    const shape = lineShapeError({ unit: input.unit, kind: input.kind });
    if (shape) errors.unit = shape;
  }
  if (!Number.isInteger(input.sort) || input.sort < 0 || input.sort > SORT_MAX) errors.sort = "invalid";
  if (typeof input.active !== "boolean") errors.active = "invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  try {
    return await ctx.db.transaction(async (tx) => {
      const db = tx as unknown as Db;
      const [clash] = await tx
        .select({ id: s.targetLines.id })
        .from(s.targetLines)
        .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.code, code)));

      if (input.id === undefined) {
        if (clash) return { ok: false as const, errors: { code: "taken" } };
        // `target_lines.id` is one global key across companies, so the id is qualified by the company;
        // inside a company a line is addressed by its code. A code that was changed away from the one
        // its id carries leaves that id behind, so a later line with the old code gets a unique suffix.
        const qualified = `${ctx.companyId}-${code}`;
        const [idTaken] = await tx.select({ id: s.targetLines.id }).from(s.targetLines).where(eq(s.targetLines.id, qualified));
        const id = idTaken ? `${qualified}-${randomUUID()}` : qualified;
        await tx.insert(s.targetLines).values({
          id,
          companyId: ctx.companyId,
          code,
          nameAr,
          nameEn,
          nameUr,
          unit: input.unit,
          kind: input.kind,
          sort: input.sort,
          active: input.active,
        });
        return { ok: true as const, id };
      }

      // The row lock makes a close that is being saved wait, so "in use" cannot change under this check.
      const [line] = await tx
        .select()
        .from(s.targetLines)
        .where(and(eq(s.targetLines.id, String(input.id)), eq(s.targetLines.companyId, ctx.companyId)))
        .for("update");
      if (!line) return { ok: false as const, errors: { id: "not_found" } };
      if (clash && clash.id !== line.id) return { ok: false as const, errors: { code: "taken" } };

      const shapeChanged = code !== line.code || input.unit !== line.unit || input.kind !== line.kind;
      if (shapeChanged && (await linesInUse(db, ctx.companyId)).has(line.id)) {
        const locked: Record<string, string> = {};
        if (code !== line.code) locked.code = "in_use";
        if (input.unit !== line.unit) locked.unit = "in_use";
        if (input.kind !== line.kind) locked.kind = "in_use";
        return { ok: false as const, errors: locked };
      }
      await tx
        .update(s.targetLines)
        .set({
          code,
          nameAr,
          nameEn,
          nameUr,
          unit: input.unit,
          kind: input.kind,
          sort: input.sort,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(and(eq(s.targetLines.id, line.id), eq(s.targetLines.companyId, ctx.companyId)));
      return { ok: true as const, id: line.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, errors: { code: "taken" } };
    throw e;
  }
}

/** Turns a line of the caller's company off or on. Its figures stay; reps stop seeing it while it is off. */
export async function setLineActive(ctx: Ctx, id: string, active: boolean): Promise<LineActionResult> {
  assertRole(ctx, ["admin"]);
  const changed = await ctx.db
    .update(s.targetLines)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(s.targetLines.id, String(id)), eq(s.targetLines.companyId, ctx.companyId)))
    .returning({ id: s.targetLines.id });
  return changed.length === 1 ? { ok: true } : { ok: false, error: "not_found" };
}

/** Moves a line one place up or down among the caller's company lines (the order reps see). */
export async function moveLine(ctx: Ctx, id: string, direction: "up" | "down"): Promise<LineActionResult> {
  assertRole(ctx, ["admin"]);
  return ctx.db.transaction(async (tx) => {
    // Lock the company's lines so two moves at once take turns instead of overwriting each other.
    const rows = await tx
      .select({ id: s.targetLines.id, sort: s.targetLines.sort })
      .from(s.targetLines)
      .where(eq(s.targetLines.companyId, ctx.companyId))
      .orderBy(asc(s.targetLines.sort), asc(s.targetLines.id))
      .for("update");
    const index = rows.findIndex((r) => r.id === String(id));
    if (index < 0) return { ok: false as const, error: "not_found" as const };
    const order = rows.map((r) => r.id);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith >= 0 && swapWith < order.length) [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];
    // Renumber 1..n so equal or gappy order values cannot make a move do nothing.
    for (const [position, lineId] of order.entries()) {
      const sort = position + 1;
      if (rows.find((r) => r.id === lineId)!.sort === sort) continue;
      await tx
        .update(s.targetLines)
        .set({ sort, updatedAt: new Date() })
        .where(and(eq(s.targetLines.id, lineId), eq(s.targetLines.companyId, ctx.companyId)));
    }
    return { ok: true as const };
  });
}

/** The next free order value, for a new line. */
export async function nextLineSort(ctx: Ctx): Promise<number> {
  assertRole(ctx, ["admin"]);
  const [row] = await ctx.db
    .select({ top: max(s.targetLines.sort) })
    .from(s.targetLines)
    .where(eq(s.targetLines.companyId, ctx.companyId));
  return (row?.top ?? 0) + 1;
}
