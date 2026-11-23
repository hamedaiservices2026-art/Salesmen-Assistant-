import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { AI_NOTICE_VERSION, aiAvailability, type AiUnavailable } from "./availability";
import { readAiConfig, type AiConfig, type AiKind } from "./config";

/** Turns the AI features on or off for the admin's own company (company from the session only). */
export async function setCompanyAi(ctx: Ctx, enabled: boolean): Promise<{ ok: true }> {
  assertRole(ctx, ["admin"]);
  await ctx.db.update(s.companies).set({ aiEnabled: enabled }).where(eq(s.companies.id, ctx.companyId));
  return { ok: true };
}

/** The company's switch and whether the deployment's kill switch overrides it. */
export async function getCompanyAi(
  ctx: Ctx,
  config: AiConfig = readAiConfig(process.env),
): Promise<{ enabled: boolean; envDisabled: boolean }> {
  assertRole(ctx, ["admin"]);
  const [c] = await ctx.db
    .select({ aiEnabled: s.companies.aiEnabled })
    .from(s.companies)
    .where(eq(s.companies.id, ctx.companyId));
  return { enabled: c?.aiEnabled === true, envDisabled: config.mode === "off" };
}

/**
 * The signed-in rep accepts the notice. There is no user parameter: consent is recorded for
 * `ctx.userId` only, and a context made on someone's behalf (`repCtx`) or any role other than
 * rep or supervisor is refused.
 */
export async function acceptAiNotice(
  ctx: Ctx,
  version: number,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: "stale_version" }> {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
  if (version !== AI_NOTICE_VERSION) return { ok: false, error: "stale_version" };
  await ctx.db
    .update(s.users)
    .set({ aiNoticeVersion: AI_NOTICE_VERSION, aiNoticeAt: now })
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  return { ok: true };
}

/** The signed-in rep takes his consent back: the notice must be accepted again. */
export async function withdrawAiNotice(ctx: Ctx): Promise<{ ok: true }> {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
  await ctx.db
    .update(s.users)
    .set({ aiNoticeVersion: 0, aiNoticeAt: null })
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  return { ok: true };
}

/** For pages: whether a request of `kind` would be allowed, and why not. */
export async function aiStatus(
  ctx: Ctx,
  kind: AiKind = "chat",
  config?: AiConfig,
): Promise<{ available: boolean; reason: AiUnavailable | null }> {
  const r = await aiAvailability(ctx, kind, config);
  return r.ok ? { available: true, reason: null } : { available: false, reason: r.reason };
}

/** Whether the signed-in rep has accepted the current notice (for the settings row). */
export async function aiNoticeAccepted(ctx: Ctx): Promise<boolean> {
  assertRole(ctx, ["rep", "supervisor"]);
  const [u] = await ctx.db
    .select({ v: s.users.aiNoticeVersion })
    .from(s.users)
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  return u !== undefined && u.v >= AI_NOTICE_VERSION;
}
