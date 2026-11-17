import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { isStrongPassword } from "./password";
import { hashSecret, isStrongPin, normalizePin } from "./pin";
import { PASSWORD_ROLES, PIN_ROLES, type Role } from "./roles";
import { createSession } from "./sessions";
import { hashToken, newToken } from "./token";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AcceptInviteResult =
  | { ok: true; sessionToken: string; login: string }
  | { ok: false; error: "invalid" | "expired" | "used" | "weak_pin" };

export type AcceptAdminInviteResult =
  | { ok: true; sessionToken: string; login: string }
  | { ok: false; error: "invalid" | "expired" | "used" | "weak_password" };

/** The page that accepts an invite for a user of `role`: PIN roles use `/invite`, password roles `/admin/invite`. */
export function invitePath(role: Role, token: string): string {
  return (PIN_ROLES as readonly Role[]).includes(role) ? `/invite/${token}` : `/admin/invite/${token}`;
}

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

/**
 * Reads an invite without consuming it, to show the name and login on the page. Only invites of
 * users with one of `roles` are visible, so a rep's link opens nothing on the admin route and
 * the reverse.
 */
async function peek(
  db: Db,
  token: string,
  roles: readonly Role[],
  now: Date,
): Promise<{ name: string; login: string } | null> {
  const [row] = await db
    .select({
      name: s.users.name,
      login: s.users.login,
      role: s.users.role,
      usedAt: s.invites.usedAt,
      expiresAt: s.invites.expiresAt,
      active: s.users.active,
    })
    .from(s.invites)
    .innerJoin(s.users, eq(s.users.id, s.invites.userId))
    .where(eq(s.invites.tokenHash, hashToken(token)));
  if (!row || !row.active || !roles.includes(row.role) || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return { name: row.name, login: row.login };
}

/** A rep's or supervisor's invite, for `/invite/[token]`. */
export function peekInvite(db: Db, token: string, now: Date = new Date()) {
  return peek(db, token, PIN_ROLES, now);
}

/** An admin's or owner's invite, for `/admin/invite/[token]`. */
export function peekAdminInvite(db: Db, token: string, now: Date = new Date()) {
  return peek(db, token, PASSWORD_ROLES, now);
}

type Secret = { pinHash: string } | { passwordHash: string };

/**
 * Claims an invite of a user with one of `roles` and stores the new secret, in one transaction:
 * the claim is a conditional update, so two concurrent submissions cannot both win; every other
 * invite of the user is voided and all his sessions are ended; if anything fails, the invite stays
 * unused. `weak` is checked before the claim so a weak secret does not use up the invite.
 */
async function claimInvite<W extends string>(
  db: Db,
  token: string,
  roles: readonly Role[],
  now: Date,
  weak: W | null,
  makeSecret: () => Promise<Secret>,
): Promise<{ ok: true; sessionToken: string; login: string } | { ok: false; error: "invalid" | "expired" | "used" | W }> {
  const [invite] = await db
    .select({ invite: s.invites, active: s.users.active, login: s.users.login, role: s.users.role })
    .from(s.invites)
    .innerJoin(s.users, eq(s.users.id, s.invites.userId))
    .where(eq(s.invites.tokenHash, hashToken(token)));
  if (!invite || !invite.active || !roles.includes(invite.role)) return { ok: false, error: "invalid" };
  if (invite.invite.usedAt) return { ok: false, error: "used" };
  if (invite.invite.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  if (weak) return { ok: false, error: weak };

  const secret = await makeSecret();
  const userId = invite.invite.userId;
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(s.invites)
      .set({ usedAt: now, updatedAt: now })
      .where(and(eq(s.invites.id, invite.invite.id), isNull(s.invites.usedAt)))
      .returning({ id: s.invites.id });
    if (claimed.length === 0) return { ok: false as const, error: "used" as const };

    // Setting a secret voids every other way in: other invites and all existing sessions.
    await tx
      .update(s.invites)
      .set({ usedAt: now, updatedAt: now })
      .where(and(eq(s.invites.userId, userId), isNull(s.invites.usedAt)));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, userId));
    await tx
      .update(s.users)
      .set({ ...secret, failedAttempts: 0, failedAt: null, lockedUntil: null, updatedAt: now })
      .where(eq(s.users.id, userId));
    return { ok: true as const, sessionToken: await createSession(tx as unknown as Db, userId, now), login: invite.login };
  });
}

/** A rep or supervisor sets his PIN. Invites of admins and owners are `invalid` here. */
export async function acceptInvite(
  db: Db,
  token: string,
  rawPin: string,
  now: Date = new Date(),
): Promise<AcceptInviteResult> {
  const pin = normalizePin(rawPin);
  return claimInvite(db, token, PIN_ROLES, now, isStrongPin(pin) ? null : "weak_pin", async () => ({
    pinHash: await hashSecret(pin),
  }));
}

/** An admin or owner sets his password. Invites of reps and supervisors are `invalid` here. */
export async function acceptAdminInvite(
  db: Db,
  token: string,
  password: string,
  now: Date = new Date(),
): Promise<AcceptAdminInviteResult> {
  return claimInvite(db, token, PASSWORD_ROLES, now, isStrongPassword(password) ? null : "weak_password", async () => ({
    passwordHash: await hashSecret(password),
  }));
}
