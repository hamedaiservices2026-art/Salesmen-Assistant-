import { and, eq, ne } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { attemptWithLockout } from "./lockout";
import { hashSecret, isStrongPin, normalizePin, verifySecret } from "./pin";
import { assertOwnContext, PIN_ROLES, type Role } from "./roles";
import { DECOY_HASH } from "./sessions";
import { hashToken } from "./token";

export type ChangePinResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "locked" | "weak_pin" | "same" };

/**
 * A rep or supervisor changes his own PIN. The current PIN is checked first, through the same
 * lockout and verify routine as sign-in (a missing or non-PIN account checks the decoy), so wrong
 * guesses count toward the five-try lock and no answer about the new PIN (`weak_pin`, `same`) is
 * given to someone who does not know the current one. On success, in one transaction: the new
 * hash is stored, the failure counters are cleared and every session of the user except the one
 * whose token is `keepToken` is deleted (compared by hash).
 */
export async function changePin(
  ctx: Ctx,
  input: { currentPin: string; newPin: string; keepToken: string },
  now: Date = new Date(),
): Promise<ChangePinResult> {
  assertOwnContext(ctx);
  const current = normalizePin(input.currentPin);
  const next = normalizePin(input.newPin);
  const [user] = await ctx.db
    .select()
    .from(s.users)
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  const hash = user && user.active && (PIN_ROLES as readonly Role[]).includes(user.role) ? user.pinHash : null;
  if (!user || !hash) {
    await verifySecret(current, DECOY_HASH);
    return { ok: false, error: "invalid" };
  }
  const outcome = await attemptWithLockout(ctx.db, user.id, () => verifySecret(current, hash), now);
  if (outcome !== "ok") return { ok: false, error: outcome };

  if (!isStrongPin(next)) return { ok: false, error: "weak_pin" };
  if (next === current) return { ok: false, error: "same" };

  const newHash = await hashSecret(next);
  const keep = hashToken(input.keepToken);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(s.users)
      .set({ pinHash: newHash, failedAttempts: 0, failedAt: null, lockedUntil: null, updatedAt: now })
      .where(and(eq(s.users.id, user.id), eq(s.users.companyId, ctx.companyId)));
    await tx
      .delete(s.sessions)
      .where(and(eq(s.sessions.userId, user.id), eq(s.sessions.companyId, ctx.companyId), ne(s.sessions.tokenHash, keep)));
  });
  return { ok: true };
}
