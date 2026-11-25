import { and, eq, gte, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { getCompanyAi } from "@/server/ai/consent";
import type { AiKind } from "@/server/ai/config";
import { COMPANY_DAY } from "@/server/ai/limits";
import type { UsageOutcome } from "@/server/ai/usage";

const KINDS: readonly AiKind[] = ["vision", "stt", "chat"];
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

export type AiUsageView = {
  days: { date: ISODate; kind: AiKind; ok: number; failed: number }[];
  today: { kind: AiKind; used: number; limit: number }[];
  failures: { outcome: UsageOutcome; count: number }[];
  enabled: boolean;
  envDisabled: boolean;
};

/** `date` shifted by whole days (UTC arithmetic on a calendar date). */
function shift(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * AI use of the admin's own company, as counts only: no user id, name or text is selected. `today`
 * reads the company's day counters (the same rows `reserveAi` limits against, so it is what the
 * limit sees), not the log. The day table groups the usage log by day in the company time zone;
 * `failed` is every outcome other than `ok`, including quota refusals logged as `rejected` (once
 * per rep, kind, day and reason; a rep's own day limit is not logged; R67).
 */
export async function getAiUsage(ctx: Ctx, opts: { today: ISODate; days?: number }): Promise<AiUsageView> {
  assertRole(ctx, ["admin"]);
  const n = Math.min(Math.max(Math.floor(opts.days ?? DEFAULT_DAYS), 1), MAX_DAYS);
  const first = shift(opts.today, -(n - 1));
  const day = sql<string>`to_char(${s.aiUsage.createdAt} at time zone ${ctx.timeZone}, 'YYYY-MM-DD')`;
  const inWindow = and(
    eq(s.aiUsage.companyId, ctx.companyId),
    gte(s.aiUsage.createdAt, sql`(${first}::timestamp at time zone ${ctx.timeZone})`),
  );

  const [usage, failures, counters, ai] = await Promise.all([
    ctx.db
      .select({
        date: day,
        kind: s.aiUsage.kind,
        ok: sql<number>`(count(*) filter (where ${s.aiUsage.outcome} = 'ok'))::int`,
        failed: sql<number>`(count(*) filter (where ${s.aiUsage.outcome} <> 'ok'))::int`,
      })
      .from(s.aiUsage)
      .where(inWindow)
      .groupBy(sql`1`, sql`2`),
    ctx.db
      .select({ outcome: s.aiUsage.outcome, count: sql<number>`count(*)::int` })
      .from(s.aiUsage)
      .where(and(inWindow, sql`${s.aiUsage.outcome} <> 'ok'`))
      .groupBy(s.aiUsage.outcome),
    ctx.db
      .select({ kind: s.aiCounters.kind, count: s.aiCounters.count })
      .from(s.aiCounters)
      .where(
        and(
          eq(s.aiCounters.companyId, ctx.companyId),
          eq(s.aiCounters.scope, `company:${ctx.companyId}`),
          eq(s.aiCounters.bucket, opts.today),
        ),
      ),
    getCompanyAi(ctx),
  ]);

  const days: AiUsageView["days"] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = shift(opts.today, -i);
    for (const kind of KINDS) {
      const row = usage.find((u) => u.date === date && u.kind === kind);
      days.push({ date, kind, ok: row?.ok ?? 0, failed: row?.failed ?? 0 });
    }
  }
  return {
    days,
    today: KINDS.map((kind) => ({ kind, used: counters.find((c) => c.kind === kind)?.count ?? 0, limit: COMPANY_DAY[kind] })),
    failures: failures.map((f) => ({ outcome: f.outcome as UsageOutcome, count: f.count })).sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
    enabled: ai.enabled,
    envDisabled: ai.envDisabled,
  };
}
