import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { hashSecret, isStrongPin } from "./pin";
import { createSession } from "./sessions";
import { hashToken, newToken } from "./token";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AcceptInviteResult =
  | { ok: true; sessionToken: string }
  | { ok: false; error: "invalid" | "expired" | "used" | "weak_pin" };

/** Creates an invite for a user and returns the raw token (only its hash is stored). */
export async function createInvite(db: Db, userId: string, now: Date = new Date()): Promise<string> {
  const [user] = await db.select({ companyId: s.users.companyId }).from(s.users).where(eq(s.users.id, userId));
  if (!user) throw new Error("Unknown user");
  const token = newToken();
  await db.insert(s.invites).values({
    id: randomUUID(),
    companyId: user.companyId,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  });
  return token;
}

/** Reads an invite without consuming it, to show the rep's name on the page. */
export async function peekInvite(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ name: string } | null> {
  const [row] = await db
    .select({ name: s.users.name, usedAt: s.invites.usedAt, expiresAt: s.invites.expiresAt, active: s.users.active })
    .from(s.invites)
    .innerJoin(s.users, eq(s.users.id, s.invites.userId))
    .where(eq(s.invites.tokenHash, hashToken(token)));
  if (!row || !row.active || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return null;
  return { name: row.name };
}

export async function acceptInvite(
  db: Db,
  token: string,
  pin: string,
  now: Date = new Date(),
): Promise<AcceptInviteResult> {
  const [invite] = await db
    .select({ invite: s.invites, active: s.users.active })
    .from(s.invites)
    .innerJoin(s.users, eq(s.users.id, s.invites.userId))
    .where(eq(s.invites.tokenHash, hashToken(token)));
  if (!invite || !invite.active) return { ok: false, error: "invalid" };
  if (invite.invite.usedAt) return { ok: false, error: "used" };
  if (invite.invite.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  if (!isStrongPin(pin)) return { ok: false, error: "weak_pin" };

  const pinHash = await hashSecret(pin);
  // Claim the invite with a conditional update so two concurrent submissions cannot both win.
  const claimed = await db
    .update(s.invites)
    .set({ usedAt: now, updatedAt: now })
    .where(and(eq(s.invites.id, invite.invite.id), isNull(s.invites.usedAt)))
    .returning({ id: s.invites.id });
  if (claimed.length === 0) return { ok: false, error: "used" };

  await db
    .update(s.users)
    .set({ pinHash, failedAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(eq(s.users.id, invite.invite.userId));
  return { ok: true, sessionToken: await createSession(db, invite.invite.userId, now) };
}
