import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { lineName } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { loadLines, type LineInfo } from "@/server/repos/month-data";

export type TargetGrid = {
  reps: { id: string; name: string; login: string }[];
  lines: LineInfo[];
  /** Keyed by `${userId}|${lineId}`; a missing key means no target. */
  amounts: Record<string, number>;
};

export type TargetEntry = { userId: string; lineId: string; amount: number | null };
export type ApplyTargetsInput = {
  year: number;
  month: number;
  entries: TargetEntry[];
  source: "form" | "excel";
  uploadId?: string;
};
export type ApplyTargetsResult = { ok: true; changed: number } | { ok: false; errors: Record<string, string> };

export type TargetChangeRow = {
  at: Date;
  repName: string;
  lineName: string;
  unit: Unit;
  year: number;
  month: number;
  oldAmount: number | null;
  newAmount: number | null;
  source: "form" | "excel";
  byName: string;
};

export const targetKey = (userId: string, lineId: string) => `${userId}|${lineId}`;

const TARGET_ROLES = ["rep", "supervisor"] as const;
const LOG_LIMIT_MAX = 200;

/** The reps (and supervisors, who also carry targets) and sales and collection lines of one month, with the amounts set. */
export async function getTargetGrid(ctx: Ctx, period: { year: number; month: number }): Promise<TargetGrid> {
  assertRole(ctx, ["admin"]);
  const [reps, lines, rows] = await Promise.all([
    ctx.db
      .select({ id: s.users.id, name: s.users.name, login: s.users.login })
      .from(s.users)
      .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.active, true), inArray(s.users.role, [...TARGET_ROLES])))
      .orderBy(asc(s.users.name), asc(s.users.id)),
    loadLines(ctx),
    ctx.db
      .select({ userId: s.targets.userId, lineId: s.targets.lineId, amount: s.targets.amount })
      .from(s.targets)
      .where(and(eq(s.targets.companyId, ctx.companyId), eq(s.targets.year, period.year), eq(s.targets.month, period.month))),
  ]);
  return {
    reps,
    lines: lines.filter((l) => l.kind !== "coverage"),
    amounts: Object.fromEntries(rows.map((r) => [targetKey(r.userId, r.lineId), r.amount])),
  };
}

/**
 * Sets or removes monthly targets in one go: all or nothing. `amount: null` removes a target. Only
 * entries that differ from what is stored are written, and each is logged once in `target_changes`.
 * Any entry with a problem returns `errors[userId|lineId]` (`not_found`, `coverage_line`, `invalid`)
 * and nothing is written. Several entries for one (user, line): the last one wins. With `tx` the
 * work joins that transaction (the Excel upload applies targets and its own rows together);
 * otherwise it opens its own.
 */
export async function applyTargets(ctx: Ctx, input: ApplyTargetsInput, tx?: Db): Promise<ApplyTargetsResult> {
  assertRole(ctx, ["admin"]);
  const { year, month } = input;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, errors: { period: "invalid" } };
  }
  const run = (db: Db) => applyIn(db, ctx, input);
  if (tx) return run(tx);
  return ctx.db.transaction((t) => run(t as unknown as Db));
}

async function applyIn(db: Db, ctx: Ctx, input: ApplyTargetsInput): Promise<ApplyTargetsResult> {
  const { year, month } = input;
  const wanted = new Map<string, TargetEntry>();
  for (const e of input.entries) wanted.set(targetKey(String(e.userId), String(e.lineId)), { ...e, userId: String(e.userId), lineId: String(e.lineId) });
  if (wanted.size === 0) return { ok: true, changed: 0 };

  const userIds = [...new Set([...wanted.values()].map((e) => e.userId))];
  const lineIds = [...new Set([...wanted.values()].map((e) => e.lineId))];
  const [users, lines] = await Promise.all([
    db
      .select({ id: s.users.id })
      .from(s.users)
      .where(
        and(
          eq(s.users.companyId, ctx.companyId),
          eq(s.users.active, true),
          inArray(s.users.role, [...TARGET_ROLES]),
          inArray(s.users.id, userIds),
        ),
      ),
    db
      .select({ id: s.targetLines.id, kind: s.targetLines.kind })
      .from(s.targetLines)
      .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.active, true), inArray(s.targetLines.id, lineIds))),
  ]);
  const userOk = new Set(users.map((u) => u.id));
  const kindOf = new Map(lines.map((l) => [l.id, l.kind]));

  const errors: Record<string, string> = {};
  for (const [key, e] of wanted) {
    if (!userOk.has(e.userId) || !kindOf.has(e.lineId)) errors[key] = "not_found";
    else if (kindOf.get(e.lineId) === "coverage") errors[key] = "coverage_line";
    else if (e.amount !== null && (typeof e.amount !== "number" || !Number.isSafeInteger(e.amount) || e.amount < 0)) errors[key] = "invalid";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // Lock the month's rows of these reps so two saves at once take turns and each logs the right old amount.
  const existing = await db
    .select({ id: s.targets.id, userId: s.targets.userId, lineId: s.targets.lineId, amount: s.targets.amount })
    .from(s.targets)
    .where(
      and(
        eq(s.targets.companyId, ctx.companyId),
        eq(s.targets.year, year),
        eq(s.targets.month, month),
        inArray(s.targets.userId, userIds),
        inArray(s.targets.lineId, lineIds),
      ),
    )
    .for("update");
  const current = new Map(existing.map((r) => [targetKey(r.userId, r.lineId), r]));

  let changed = 0;
  for (const [key, e] of wanted) {
    const old = current.get(key);
    const oldAmount = old?.amount ?? null;
    if (oldAmount === e.amount) continue;
    if (e.amount === null) {
      await db.delete(s.targets).where(and(eq(s.targets.id, old!.id), eq(s.targets.companyId, ctx.companyId)));
    } else if (old) {
      await db
        .update(s.targets)
        .set({ amount: e.amount, updatedAt: new Date() })
        .where(and(eq(s.targets.id, old.id), eq(s.targets.companyId, ctx.companyId)));
    } else {
      await db.insert(s.targets).values({
        id: randomUUID(),
        companyId: ctx.companyId,
        userId: e.userId,
        lineId: e.lineId,
        year,
        month,
        amount: e.amount,
      });
    }
    await db.insert(s.targetChanges).values({
      id: randomUUID(),
      companyId: ctx.companyId,
      userId: e.userId,
      lineId: e.lineId,
      year,
      month,
      oldAmount,
      newAmount: e.amount,
      source: input.source,
      changedBy: ctx.userId,
      uploadId: input.uploadId ?? null,
    });
    changed += 1;
  }
  return { ok: true, changed };
}

/** The newest target changes of the caller's company, newest first. */
export async function listTargetChanges(ctx: Ctx, opts: { limit: number }): Promise<TargetChangeRow[]> {
  assertRole(ctx, ["admin"]);
  const limit = Math.min(LOG_LIMIT_MAX, Math.max(1, Math.trunc(Number(opts.limit)) || 1));
  const rep = alias(s.users, "rep");
  const by = alias(s.users, "by");
  const rows = await ctx.db
    .select({
      at: s.targetChanges.createdAt,
      repName: rep.name,
      line: s.targetLines,
      year: s.targetChanges.year,
      month: s.targetChanges.month,
      oldAmount: s.targetChanges.oldAmount,
      newAmount: s.targetChanges.newAmount,
      source: s.targetChanges.source,
      byName: by.name,
    })
    .from(s.targetChanges)
    .innerJoin(rep, and(eq(rep.id, s.targetChanges.userId), eq(rep.companyId, ctx.companyId)))
    .innerJoin(by, and(eq(by.id, s.targetChanges.changedBy), eq(by.companyId, ctx.companyId)))
    .innerJoin(s.targetLines, and(eq(s.targetLines.id, s.targetChanges.lineId), eq(s.targetLines.companyId, ctx.companyId)))
    .where(eq(s.targetChanges.companyId, ctx.companyId))
    .orderBy(desc(s.targetChanges.createdAt), desc(s.targetChanges.id))
    .limit(limit);
  return rows.map((r) => ({
    at: r.at,
    repName: r.repName,
    lineName: lineName(r.line, ctx.locale),
    unit: r.line.unit,
    year: r.year,
    month: r.month,
    oldAmount: r.oldAmount,
    newAmount: r.newAmount,
    source: r.source,
    byName: r.byName,
  }));
}
