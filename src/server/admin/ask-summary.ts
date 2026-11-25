import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { TOPICS, type Topic } from "@/domain/assistant/topics";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

/** A topic is listed only when at least this many different reps asked it. */
export const ASK_K = 3;
/** The window, in days back from `now`. */
export const ASK_DAYS = 30;
const ASK_MAX_TOPICS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The closed list a topic is read from; `other` is never shown. */
const LISTED: readonly Topic[] = TOPICS.filter((t) => t !== "other");

export type AskSummary = { state: "ok"; topics: { topic: Topic; reps: number; questions: number }[] } | { state: "too_few" };

/**
 * What reps ask the assistant most, without who asked. Counts only: the select returns a topic
 * code and two numbers per topic, never a user id, and the k-anonymity threshold is applied in SQL
 * (`HAVING count(distinct user_id) >= ASK_K`), so a topic asked by fewer reps never leaves the
 * database. Own company only; rows of features `assistant` and `explain` with outcome `ok` in the
 * last 30 days; a stored topic outside the closed list is ignored.
 *
 * Residual risk: with a small team a listed topic still says "at least 3 of you asked this", and a
 * team of 3 to 4 reps can be partly inferred (every rep asked it). The threshold stops a single
 * rep's question being shown; it does not make a tiny team anonymous.
 */
export async function getAskSummary(ctx: Ctx, opts: { now: Date }): Promise<AskSummary> {
  assertRole(ctx, ["admin"]);
  const since = new Date(opts.now.getTime() - ASK_DAYS * DAY_MS);
  const reps = sql<number>`count(distinct ${s.aiUsage.userId})::int`;
  const questions = sql<number>`count(*)::int`;
  const rows = await ctx.db
    .select({ topic: s.aiUsage.topic, reps, questions })
    .from(s.aiUsage)
    .where(
      and(
        eq(s.aiUsage.companyId, ctx.companyId),
        inArray(s.aiUsage.feature, ["assistant", "explain"]),
        eq(s.aiUsage.outcome, "ok"),
        gte(s.aiUsage.createdAt, since),
        inArray(s.aiUsage.topic, [...LISTED]),
      ),
    )
    .groupBy(s.aiUsage.topic)
    .having(sql`count(distinct ${s.aiUsage.userId}) >= ${ASK_K}`)
    .orderBy(desc(reps), desc(questions), s.aiUsage.topic)
    .limit(ASK_MAX_TOPICS);
  const topics = rows.flatMap((r) => (LISTED as readonly (string | null)[]).includes(r.topic) ? [{ topic: r.topic as Topic, reps: r.reps, questions: r.questions }] : []);
  return topics.length === 0 ? { state: "too_few" } : { state: "ok", topics };
}
