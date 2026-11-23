import { and, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@/domain/calendar";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { assertOwnContext } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import type { AiKind } from "./config";
import { DEFAULT_LIMITS, type AiLimits } from "./limits";

export type QuotaResult = "ok" | "rate_limited" | "user_quota" | "company_quota" | "global_quota";

const KINDS: readonly AiKind[] = ["vision", "stt", "chat"];
const COUNTER_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Rows a sweep deletes per call (callers loop up to 5 batches; R67; retention sweeps run in bounded batches). */
const SWEEP_BATCH = 1000;

/** `YYYY-MM-DDTHH:MM` in UTC. */
const minuteBucket = (now: Date) => now.toISOString().slice(0, 16);
/** `YYYY-MM-DD` in UTC (the `global` day). */
const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const userScope = (userId: string) => `user:${userId}`;
const companyScope = (companyId: string) => `company:${companyId}`;
const GLOBAL = "global";

/**
 * The reservation as one statement, exposed so a test can check its shape:
 * `INSERT … VALUES (…, 1) ON CONFLICT (scope, bucket, kind) DO UPDATE SET count = count + 1,
 * updated_at = now() WHERE ai_counters.count < $limit RETURNING count`. A full counter makes the
 * DO UPDATE's WHERE false, so no row comes back. Postgres locks the conflicting row and re-checks
 * the WHERE on the latest version, so parallel requests cannot pass the limit. There is no read
 * before the write.
 */
export function reserveStatement(db: Db, scope: string, bucket: string, kind: string, limit: number, companyId: string | null) {
  return db
    .insert(s.aiCounters)
    .values({ scope, bucket, kind, companyId, count: 1 })
    .onConflictDoUpdate({
      target: [s.aiCounters.scope, s.aiCounters.bucket, s.aiCounters.kind],
      set: { count: sql`${s.aiCounters.count} + 1`, updatedAt: sql`now()` },
      setWhere: sql`${s.aiCounters.count} < ${limit}`,
    })
    .returning({ count: s.aiCounters.count });
}

/**
 * Takes one slot of the counter (scope, bucket, kind) if fewer than `limit` are taken. One
 * statement, no read first. A limit that is not a positive whole number refuses without writing.
 */
export async function reserve(
  db: Db,
  scope: string,
  bucket: string,
  kind: string,
  limit: number,
  companyId: string | null,
): Promise<boolean> {
  if (!Number.isSafeInteger(limit) || limit <= 0) return false;
  const rows = await reserveStatement(db, scope, bucket, kind, limit, companyId);
  return rows.length > 0;
}

class Refused extends Error {
  constructor(readonly reason: Exclude<QuotaResult, "ok">) {
    super(reason);
  }
}

/**
 * Reserves one AI request for the caller, in one transaction, in this fixed order: user minute,
 * global minute (skipped when `globalLimit.minute` is null; R65), user day, company day, global
 * day. The first refusal rolls the transaction back, so a refused request consumes nothing, and
 * names the reason (a minute refusal is `rate_limited`). The fixed order also keeps concurrent
 * transactions from locking the shared rows in opposite orders.
 *
 * The `global` rows are the one documented cross-company write: they hold a count and nothing else.
 */
export async function reserveAi(
  ctx: Ctx,
  kind: AiKind,
  now: Date,
  globalLimit: { day: number; minute: number | null },
  limits: AiLimits = DEFAULT_LIMITS,
): Promise<QuotaResult> {
  assertOwnContext(ctx);
  const minute = minuteBucket(now);
  const day = todayIn(ctx.timeZone, now);
  const steps: [scope: string, bucket: string, limit: number, companyId: string | null, refusal: Exclude<QuotaResult, "ok">][] = [
    [userScope(ctx.userId), minute, limits.userMinute[kind], ctx.companyId, "rate_limited"],
    ...(globalLimit.minute === null
      ? []
      : [[GLOBAL, minute, globalLimit.minute, null, "rate_limited"] as [string, string, number, null, "rate_limited"]]),
    [userScope(ctx.userId), day, limits.userDay[kind], ctx.companyId, "user_quota"],
    [companyScope(ctx.companyId), day, limits.companyDay[kind], ctx.companyId, "company_quota"],
    [GLOBAL, utcDay(now), globalLimit.day, null, "global_quota"],
  ];
  try {
    await ctx.db.transaction(async (tx) => {
      for (const [scope, bucket, limit, companyId, refusal] of steps) {
        if (!(await reserve(tx as unknown as Db, scope, bucket, kind, limit, companyId))) throw new Refused(refusal);
      }
    });
    return "ok";
  } catch (e) {
    if (e instanceof Refused) return e.reason;
    throw e;
  }
}

/** Today's day counters (company time zone) of the caller and of his company, per kind. */
export async function quotaToday(ctx: Ctx, now: Date): Promise<Record<AiKind, { user: number; company: number }>> {
  const day = todayIn(ctx.timeZone, now);
  const user = userScope(ctx.userId);
  const company = companyScope(ctx.companyId);
  const rows = await ctx.db
    .select({ scope: s.aiCounters.scope, kind: s.aiCounters.kind, count: s.aiCounters.count })
    .from(s.aiCounters)
    .where(and(eq(s.aiCounters.companyId, ctx.companyId), eq(s.aiCounters.bucket, day), inArray(s.aiCounters.scope, [user, company])));
  const out = Object.fromEntries(KINDS.map((k) => [k, { user: 0, company: 0 }])) as Record<AiKind, { user: number; company: number }>;
  for (const r of rows) {
    const slot = (KINDS as readonly string[]).includes(r.kind) ? out[r.kind as AiKind] : undefined;
    if (!slot) continue;
    if (r.scope === user) slot.user = r.count;
    else slot.company = r.count;
  }
  return out;
}

/**
 * Deletes counters not updated for more than 3 days, at most 1000 per call (system maintenance,
 * across companies; counters hold no rep data). Returns the number deleted (R28). A call that
 * returns 1000 may have left more: the maintenance caller loops while the result equals the batch
 * size, at most 5 batches per run (R67). Each call is independent, so looping is safe.
 */
export async function sweepCounters(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - COUNTER_TTL_MS);
  const deleted = await db
    .delete(s.aiCounters)
    .where(
      sql`(${s.aiCounters.scope}, ${s.aiCounters.bucket}, ${s.aiCounters.kind}) in (
        select ${s.aiCounters.scope}, ${s.aiCounters.bucket}, ${s.aiCounters.kind} from ${s.aiCounters}
        where ${s.aiCounters.updatedAt} < ${cutoff.toISOString()}::timestamptz limit ${SWEEP_BATCH})`,
    )
    .returning({ scope: s.aiCounters.scope });
  return deleted.length;
}
