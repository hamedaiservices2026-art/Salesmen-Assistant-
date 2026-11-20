import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { attemptWithLockout } from "./lockout";
import { normalizeEmail, PASSWORD_MAX } from "./password";
import { normalizePin, verifySecret } from "./pin";
import { PASSWORD_ROLES, PIN_ROLES, type Role } from "./roles";
import { hashToken, newToken } from "./token";

export const SESSION_COOKIE = "session";
/** Rep and supervisor sessions: 90 days, sliding. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Admin and owner sessions: 7 days, sliding (a password role can change money and people). */
export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Browser cookie lifetime, the same for every role: the stored expiry (7 days for a password role) is the authority. */
export const SESSION_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

const isPasswordRole = (role: Role): boolean => (PASSWORD_ROLES as readonly Role[]).includes(role);

/** How long a session of `role` lives, and is renewed to, in milliseconds. */
export const sessionTtlMs = (role: Role): number => (isPasswordRole(role) ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS);
/**
 * Stored hash used to spend equal time when the login does not exist or may not use this path.
 * Precomputed (a hash of a throwaway string at the current cost), so the first unknown login of a
 * process costs one scrypt run like every other.
 */
export const DECOY_HASH =
  "scrypt$16384$8$1$8b536842b92f706bb3498ed8198087e9$014a7e8457a3b494c532e208798ab9e8eb0a67ba9ac33744a2ef173396005d88";

export async function createSession(db: Db, userId: string, now: Date = new Date()): Promise<string> {
  const [user] = await db.select({ companyId: s.users.companyId, role: s.users.role }).from(s.users).where(eq(s.users.id, userId));
  if (!user) throw new Error("Unknown user");
  const token = newToken();
  await db.insert(s.sessions).values({
    id: randomUUID(),
    companyId: user.companyId,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + sessionTtlMs(user.role)),
  });
  return token;
}

export async function getSessionUser(db: Db, token: string, now: Date = new Date()): Promise<Ctx | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      expiresAt: s.sessions.expiresAt,
      userId: s.users.id,
      companyId: s.users.companyId,
      role: s.users.role,
      locale: s.users.locale,
      active: s.users.active,
      timeZone: s.companies.timeZone,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .innerJoin(s.companies, eq(s.companies.id, s.users.companyId))
    .where(eq(s.sessions.tokenHash, hashToken(token)));
  if (!row || !row.active || row.expiresAt.getTime() <= now.getTime()) return null;
  const ttl = sessionTtlMs(row.role);
  const latest = now.getTime() + ttl;
  if (row.expiresAt.getTime() > latest) {
    // Longer than the role allows (a session made before the 7-day rule): clamped down on first use.
    row.expiresAt = new Date(latest);
    await db
      .update(s.sessions)
      .set({ expiresAt: row.expiresAt, updatedAt: now })
      .where(eq(s.sessions.tokenHash, hashToken(token)));
  } else if (row.expiresAt.getTime() - now.getTime() < ttl / 2) {
    // Sliding expiry: renewed once less than half the lifetime remains.
    await db
      .update(s.sessions)
      .set({ expiresAt: new Date(now.getTime() + ttl), updatedAt: now })
      // Only while still valid: a session that expires meanwhile is not brought back.
      .where(and(eq(s.sessions.tokenHash, hashToken(token)), gt(s.sessions.expiresAt, now)));
  }
  return {
    db,
    companyId: row.companyId,
    userId: row.userId,
    role: row.role,
    locale: row.locale,
    timeZone: row.timeZone,
  };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(s.sessions).where(eq(s.sessions.tokenHash, hashToken(token)));
}

export type SignInResult = { ok: true; sessionToken: string } | { ok: false; error: "invalid" | "locked" };

type UserRow = typeof s.users.$inferSelect;

/**
 * Shared by both sign-in paths. A user who is missing, inactive, of a role this path does not
 * admit, or without a stored secret gets `invalid` after checking a decoy hash, so the answer
 * and its timing do not tell an attacker which it was. The real check runs under the lockout.
 */
async function signInUser(
  db: Db,
  user: UserRow | undefined,
  roles: readonly Role[],
  storedHash: (u: UserRow) => string | null,
  secret: string,
  now: Date,
): Promise<SignInResult> {
  const hash = user && user.active && roles.includes(user.role) ? storedHash(user) : null;
  if (!user || !hash) {
    await verifySecret(secret, DECOY_HASH);
    return { ok: false, error: "invalid" };
  }
  const outcome = await attemptWithLockout(db, user.id, () => verifySecret(secret, hash), now);
  if (outcome !== "ok") return { ok: false, error: outcome };
  return { ok: true, sessionToken: await createSession(db, user.id, now) };
}

/** PIN sign-in for reps and supervisors. Unknown login and wrong PIN give the same `invalid`. */
export async function signIn(db: Db, login: string, rawPin: string, now: Date = new Date()): Promise<SignInResult> {
  const [user] = await db.select().from(s.users).where(eq(s.users.login, login.trim().toLowerCase()));
  return signInUser(db, user, PIN_ROLES, (u) => u.pinHash, normalizePin(rawPin), now);
}

/** Password sign-in for admins and owners. Unknown email and wrong password give the same `invalid`. */
export async function signInWithPassword(
  db: Db,
  email: string,
  password: string,
  now: Date = new Date(),
): Promise<SignInResult> {
  // No stored password is longer than the maximum; bound the work an oversized input can cause.
  const secret = password.slice(0, PASSWORD_MAX * 2);
  const [user] = await db.select().from(s.users).where(eq(s.users.login, normalizeEmail(email)));
  return signInUser(db, user, PASSWORD_ROLES, (u) => u.passwordHash, secret, now);
}
