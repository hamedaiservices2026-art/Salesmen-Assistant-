import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { readAiConfig, type AiConfig, type AiKind } from "./config";
import { getProviders } from "./providers";
import type { AiProvider } from "./types";

/** The version of the one-time notice a rep accepts before his first AI request (3: the storage wording names no owner; R83). */
export const AI_NOTICE_VERSION = 3;

export type AiUnavailable = "disabled" | "company_off" | "no_notice" | "no_provider";

/**
 * Whether the caller may make an AI request of this kind, checked in this order: the deployment's
 * switch (`mode "off"`) → `disabled`; the company's switch → `company_off`; the caller's accepted
 * notice → `no_notice`; a provider for the kind → `no_provider`. Only a rep or supervisor acting
 * as himself gets an answer: any other role, or a `repCtx` context, throws `Forbidden`.
 * `providers` is for tests only and replaces `getProviders(kind, config)` (R27).
 */
export async function aiAvailability(
  ctx: Ctx,
  kind: AiKind,
  config: AiConfig = readAiConfig(process.env),
  providers?: AiProvider[],
): Promise<{ ok: true } | { ok: false; reason: AiUnavailable }> {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
  if (config.mode === "off") return { ok: false, reason: "disabled" };

  const [company] = await ctx.db
    .select({ aiEnabled: s.companies.aiEnabled })
    .from(s.companies)
    .where(eq(s.companies.id, ctx.companyId));
  if (company?.aiEnabled !== true) return { ok: false, reason: "company_off" };

  const [user] = await ctx.db
    .select({ notice: s.users.aiNoticeVersion })
    .from(s.users)
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  if (user === undefined || user.notice < AI_NOTICE_VERSION) return { ok: false, reason: "no_notice" };

  if ((providers ?? getProviders(kind, config)).length === 0) return { ok: false, reason: "no_provider" };
  return { ok: true };
}
