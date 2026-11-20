import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import { coverageErrors } from "@/domain/coverage";
import { repCtx } from "@/server/admin/rep-ctx";
import { assertOwnContext, assertRole, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { currentDay } from "@/server/today";

export type CoverageInfo = {
  lineId: string;
  covered: number;
  total: number;
  asOf: ISODate;
  enteredByName: string;
  enteredRole: Role;
};

export type CoverageInput = { repId: string; lineId: string; covered: number; total: number; asOf: ISODate };
export type AddCoverageResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** First day of the month and of the next one, as the half-open range `[start, next)` of ISO dates. */
function monthRange(year: number, month: number): { start: ISODate; next: ISODate } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${year}-${pad(month)}-01`, next: `${nextYear}-${pad(nextMonth)}-01` };
}

/**
 * Records a coverage count for the rep `input.repId`. The caller's permission is `repCtx`: a rep for
 * himself, a supervisor for his reps, an admin for any rep of his company; anyone else gets
 * `errors.repId = "not_found"` and nothing is written. The line must be an active coverage line of the
 * company; field problems come back as `errors[field] = code` (see `coverageErrors`).
 */
export async function addCoverageUpdate(
  ctx: Ctx,
  input: CoverageInput,
  opts?: { today?: ISODate },
): Promise<AddCoverageResult> {
  assertOwnContext(ctx);
  const target = await repCtx(ctx, String(input.repId ?? ""));
  if (!target) return { ok: false, errors: { repId: "not_found" } };
  // A deactivated rep or supervisor takes no new figures.
  const [live] = await ctx.db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, target.userId), eq(s.users.companyId, ctx.companyId), eq(s.users.active, true)));
  if (!live) return { ok: false, errors: { repId: "not_found" } };

  const errors = coverageErrors({
    covered: input.covered,
    total: input.total,
    asOf: String(input.asOf ?? ""),
    today: opts?.today ?? currentDay(ctx.timeZone),
  });
  const [line] = await ctx.db
    .select({ id: s.targetLines.id })
    .from(s.targetLines)
    .where(
      and(
        eq(s.targetLines.id, String(input.lineId ?? "")),
        eq(s.targetLines.companyId, ctx.companyId),
        eq(s.targetLines.kind, "coverage"),
        eq(s.targetLines.active, true),
      ),
    );
  if (!line) errors.lineId = "not_coverage";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  await ctx.db.insert(s.coverageUpdates).values({
    id: randomUUID(),
    companyId: ctx.companyId,
    userId: target.userId,
    lineId: line!.id,
    covered: input.covered,
    total: input.total,
    asOf: input.asOf,
    enteredBy: ctx.userId,
    enteredRole: ctx.role,
  });
  return { ok: true };
}

/** The latest coverage of each coverage line per rep in `userIds`, among updates dated within the month. */
async function latestFor(
  ctx: Ctx,
  userIds: string[],
  year: number,
  month: number,
): Promise<Map<string, Map<string, CoverageInfo>>> {
  const out = new Map<string, Map<string, CoverageInfo>>(userIds.map((id) => [id, new Map()]));
  if (userIds.length === 0) return out;
  const { start, next } = monthRange(year, month);
  const rows = await ctx.db
    .select({
      userId: s.coverageUpdates.userId,
      lineId: s.coverageUpdates.lineId,
      covered: s.coverageUpdates.covered,
      total: s.coverageUpdates.total,
      asOf: s.coverageUpdates.asOf,
      enteredRole: s.coverageUpdates.enteredRole,
      enteredByName: s.users.name,
    })
    .from(s.coverageUpdates)
    .innerJoin(s.users, eq(s.users.id, s.coverageUpdates.enteredBy))
    .where(
      and(
        eq(s.coverageUpdates.companyId, ctx.companyId),
        inArray(s.coverageUpdates.userId, userIds),
        gte(s.coverageUpdates.asOf, start),
        lt(s.coverageUpdates.asOf, next),
      ),
    )
    .orderBy(desc(s.coverageUpdates.asOf), desc(s.coverageUpdates.createdAt), desc(s.coverageUpdates.id));
  for (const r of rows) {
    const byLine = out.get(r.userId)!;
    if (byLine.has(r.lineId)) continue; // rows come newest first
    byLine.set(r.lineId, {
      lineId: r.lineId,
      covered: r.covered,
      total: r.total,
      asOf: r.asOf,
      enteredByName: r.enteredByName,
      enteredRole: r.enteredRole,
    });
  }
  return out;
}

/** The rep's latest coverage per coverage line for the month: latest `as_of`, then latest `created_at`. */
export async function latestCoverage(ctx: Ctx, year: number, month: number): Promise<Map<string, CoverageInfo>> {
  return (await latestFor(ctx, [ctx.userId], year, month)).get(ctx.userId)!;
}

export type CoverageRep = { id: string; name: string; coverage: Map<string, CoverageInfo> };

/**
 * The reps a supervisor (his own) or an admin (all of the company) can update coverage for, active
 * ones only, by name, each with his latest coverage of the month.
 */
export async function listCoverageReps(ctx: Ctx, year: number, month: number): Promise<CoverageRep[]> {
  assertRole(ctx, ["supervisor", "admin"]);
  const reps = await ctx.db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.users)
    .where(
      and(
        eq(s.users.companyId, ctx.companyId),
        eq(s.users.role, "rep"),
        eq(s.users.active, true),
        ctx.role === "supervisor" ? eq(s.users.supervisorId, ctx.userId) : undefined,
      ),
    )
    .orderBy(asc(s.users.name), asc(s.users.id));
  const latest = await latestFor(ctx, reps.map((r) => r.id), year, month);
  return reps.map((r) => ({ ...r, coverage: latest.get(r.id)! }));
}
