// The rep's assistant conversation (decision 7): one rolling conversation per rep, his own rows only,
// kept 30 days, deletable by him at any time. No admin or supervisor path reads it: every function
// here takes the rep's own context (a `repCtx` context made for someone else is refused).
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export const RETENTION_DAYS = 30;
/** Stored rows sent back to the model with a new question. */
export const HISTORY_TURNS = 6;
/** Rows the screen lists. */
export const LIST_MAX = 60;
const SWEEP_BATCH = 1000;

export type Citation = { title: string; label: string };
export type Verdict = NonNullable<(typeof s.assistantMessages.$inferSelect)["verdict"]>;
export type MessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  verdict: Verdict | null;
  citations: Citation[];
  createdAt: Date;
};

export const retentionCutoff = (now: Date) => new Date(now.getTime() - RETENTION_DAYS * 86_400_000);

const own = (ctx: Ctx) => and(eq(s.assistantMessages.companyId, ctx.companyId), eq(s.assistantMessages.userId, ctx.userId));

function guard(ctx: Ctx): void {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
}

/** The caller's newest rows of the last 30 days (`limit`), oldest first; a user row before its answer. */
export async function recentMessages(ctx: Ctx, limit: number, now: Date): Promise<MessageView[]> {
  guard(ctx);
  const rows = await ctx.db
    .select()
    .from(s.assistantMessages)
    // R81: an `unavailable` row (a failed request) is neither listed nor sent back as history.
    .where(
      and(
        own(ctx),
        gt(s.assistantMessages.createdAt, retentionCutoff(now)),
        or(isNull(s.assistantMessages.verdict), ne(s.assistantMessages.verdict, "unavailable")),
      ),
    )
    .orderBy(desc(s.assistantMessages.createdAt), asc(s.assistantMessages.role), desc(s.assistantMessages.id))
    .limit(limit);
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    text: r.text,
    verdict: r.verdict,
    citations: Array.isArray(r.citations) ? r.citations : [],
    createdAt: r.createdAt,
  }));
}

/** The caller's own conversation: the last 60 rows, oldest first, never older than 30 days. */
export async function listMessages(ctx: Ctx, opts: { now?: Date } = {}): Promise<MessageView[]> {
  return recentMessages(ctx, LIST_MAX, opts.now ?? new Date());
}

/** Deletes the caller's whole conversation, in batches of 1000 (R81), and returns how many rows went. */
export async function clearConversation(ctx: Ctx): Promise<{ deleted: number }> {
  guard(ctx);
  let deleted = 0;
  for (;;) {
    const batch = ctx.db.select({ id: s.assistantMessages.id }).from(s.assistantMessages).where(own(ctx)).limit(SWEEP_BATCH);
    const gone = await ctx.db
      .delete(s.assistantMessages)
      .where(and(own(ctx), inArray(s.assistantMessages.id, batch)))
      .returning({ id: s.assistantMessages.id });
    deleted += gone.length;
    if (gone.length < SWEEP_BATCH) return { deleted };
  }
}

/** Deletes the caller's own rows past retention (at most 1000 per call). */
export async function deleteOwnExpired(ctx: Ctx, now: Date): Promise<number> {
  guard(ctx);
  const batch = ctx.db
    .select({ id: s.assistantMessages.id })
    .from(s.assistantMessages)
    .where(and(own(ctx), lt(s.assistantMessages.createdAt, retentionCutoff(now))))
    .limit(SWEEP_BATCH);
  const gone = await ctx.db
    .delete(s.assistantMessages)
    .where(and(own(ctx), inArray(s.assistantMessages.id, batch)))
    .returning({ id: s.assistantMessages.id });
  return gone.length;
}

/**
 * Deletes rows older than 30 days, at most 1000 per call (system maintenance, across companies),
 * and returns the number deleted (R28). The maintenance caller loops while it returns 1000.
 */
export async function sweepMessages(db: Db, now: Date): Promise<number> {
  const batch = db
    .select({ id: s.assistantMessages.id })
    .from(s.assistantMessages)
    .where(lt(s.assistantMessages.createdAt, retentionCutoff(now)))
    .limit(SWEEP_BATCH);
  const gone = await db.delete(s.assistantMessages).where(inArray(s.assistantMessages.id, batch)).returning({ id: s.assistantMessages.id });
  return gone.length;
}
