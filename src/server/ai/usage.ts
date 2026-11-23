import { randomUUID } from "node:crypto";
import { inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import type { AiKind, ProviderName } from "./config";
import type { Usage } from "./types";

export type AiFeature = (typeof s.aiUsage.feature.enumValues)[number];
export type UsageOutcome = (typeof s.aiUsage.outcome.enumValues)[number];

export type UsageRow = {
  kind: AiKind;
  feature: AiFeature;
  provider: ProviderName | null;
  model: string | null;
  outcome: UsageOutcome;
  attempts: number;
  fallback: boolean;
  latencyMs: number;
  usage: Usage;
  topic?: string | null;
  /** A deterministic id makes the write idempotent (R67); omitted → a random one. */
  id?: string;
};

const USAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 1000;
const INT_MAX = 2_147_483_647;
/** A topic is a short code from a closed list (Task 15), never free text. */
const TOPIC = /^[a-z][a-z0-9_]{0,39}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/** A whole number that fits the integer column, clamped; anything else becomes `fallback`. */
function int(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), INT_MAX);
}
/** Token counts: a count the column can hold, else unknown. */
function tokens(n: unknown): number | null {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= INT_MAX ? n : null;
}

/**
 * Writes one usage row: codes and counts only (no question, transcript, reply, file name or
 * amount). A failure to write is swallowed after a detail-free `console.error`: the feature must
 * not fail because of the log, and the log must not leak what failed.
 */
export async function logUsage(ctx: Ctx, row: UsageRow): Promise<void> {
  try {
    await ctx.db.insert(s.aiUsage).values({
      id: row.id ?? randomUUID(),
      companyId: ctx.companyId,
      userId: ctx.userId,
      kind: row.kind,
      feature: row.feature,
      provider: row.provider,
      model: row.model !== null && MODEL.test(row.model) ? row.model : null,
      outcome: row.outcome,
      attempts: int(row.attempts, 0),
      fallback: row.fallback === true,
      latencyMs: int(row.latencyMs, 0),
      tokensIn: tokens(row.usage?.tokensIn),
      tokensOut: tokens(row.usage?.tokensOut),
      topic: typeof row.topic === "string" && TOPIC.test(row.topic) ? row.topic : null,
    }).onConflictDoNothing();
  } catch {
    console.error("ai usage log failed");
  }
}

/**
 * Deletes usage rows older than 90 days, at most 1000 per call (system maintenance, across
 * companies). Returns the number deleted (R28). A call that returns 1000 may have left more: the
 * maintenance caller loops while the result equals the batch size, at most 5 batches per run (R67).
 */
export async function sweepUsage(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - USAGE_TTL_MS);
  const batch = db.select({ id: s.aiUsage.id }).from(s.aiUsage).where(lt(s.aiUsage.createdAt, cutoff)).limit(SWEEP_BATCH);
  const deleted = await db.delete(s.aiUsage).where(inArray(s.aiUsage.id, batch)).returning({ id: s.aiUsage.id });
  return deleted.length;
}
