import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { hashSecret, normalizePin, verifySecret } from "./pin";
import { hashToken, newToken } from "./token";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Browser cookie lifetime; the stored expiry is the authority and is renewed while the rep keeps using the app. */
export const SESSION_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Stored hash used to spend equal time when the login does not exist. */
let decoy: Promise<string> | undefined;

export async function createSession(db: Db, userId: string, now: Date = new Date()): Promise<string> {
  const [user] = await db.select({ companyId: s.users.companyId }).from(s.users).where(eq(s.users.id, userId));
  if (!user) throw new Error("Unknown user");
  const token = newToken();
  await db.insert(s.sessions).values({
    id: randomUUID(),
    companyId: user.companyId,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
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
  if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
    // Sliding expiry: renewed once less than half the lifetime remains.
    await db
      .update(s.sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), updatedAt: now })
      .where(eq(s.sessions.tokenHash, hashToken(token)));
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

/**
 * Unknown login and wrong PIN give the same `invalid`. Five consecutive failures lock for 15 minutes.
 *
 * Every attempt first reserves one of the five tries in a single conditional UPDATE that also
 * checks the lock, so a burst of parallel requests can reach the (slow) PIN check at most five
 * times. A failure at the limit sets the lock; a success clears the counter only while unlocked.
 */
export async function signIn(db: Db, login: string, rawPin: string, now: Date = new Date()): Promise<SignInResult> {
  const pin = normalizePin(rawPin);
  const [user] = await db.select().from(s.users).where(eq(s.users.login, login.trim().toLowerCase()));
  if (!user || !user.pinHash || !user.active) {
    decoy ??= hashSecret("000000");
    await verifySecret(pin, await decoy);
    return { ok: false, error: "invalid" };
  }

  const unlocked = or(isNull(s.users.lockedUntil), lte(s.users.lockedUntil, now));
  const reserved = await db
    .update(s.users)
    .set({
      // A counter left at the limit with no lock (the lock write was lost) restarts once the window has passed.
      failedAttempts: sql`CASE WHEN ${s.users.failedAttempts} >= ${MAX_FAILURES} THEN 1 ELSE ${s.users.failedAttempts} + 1 END`,
      updatedAt: now,
    })
    .where(
      and(
        eq(s.users.id, user.id),
        unlocked,
        or(lt(s.users.failedAttempts, MAX_FAILURES), lte(s.users.updatedAt, new Date(now.getTime() - LOCK_MS))),
      ),
    )
    .returning({ id: s.users.id });
  if (reserved.length === 0) {
    // Either locked, or the counter sits at the limit with the lock about to be written
    // (its last update is less than the lock window old).
    return { ok: false, error: "locked" };
  }

  if (!(await verifySecret(pin, user.pinHash))) {
    await db
      .update(s.users)
      .set({ failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS), updatedAt: now })
      .where(and(eq(s.users.id, user.id), unlocked, gte(s.users.failedAttempts, MAX_FAILURES)));
    return { ok: false, error: "invalid" };
  }

  const cleared = await db
    .update(s.users)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(and(eq(s.users.id, user.id), unlocked, eq(s.users.active, true)))
    .returning({ id: s.users.id });
  if (cleared.length === 0) return { ok: false, error: "locked" };
  return { ok: true, sessionToken: await createSession(db, user.id, now) };
}
