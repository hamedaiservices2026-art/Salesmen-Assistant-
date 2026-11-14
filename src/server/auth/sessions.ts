import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { hashSecret, verifySecret } from "./pin";
import { hashToken, newToken } from "./token";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
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

/** Unknown login and wrong PIN give the same `invalid`. Five consecutive failures lock for 15 minutes. */
export async function signIn(db: Db, login: string, pin: string, now: Date = new Date()): Promise<SignInResult> {
  const [user] = await db.select().from(s.users).where(eq(s.users.login, login.trim()));
  if (!user || !user.pinHash || !user.active) {
    decoy ??= hashSecret("000000");
    await verifySecret(pin, await decoy);
    return { ok: false, error: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { ok: false, error: "locked" };
  }
  if (!(await verifySecret(pin, user.pinHash))) {
    // Count atomically so parallel guesses cannot dodge the limit.
    const [updated] = await db
      .update(s.users)
      .set({ failedAttempts: sql`${s.users.failedAttempts} + 1`, updatedAt: now })
      .where(eq(s.users.id, user.id))
      .returning({ failedAttempts: s.users.failedAttempts });
    if (updated && updated.failedAttempts >= MAX_FAILURES) {
      await db
        .update(s.users)
        .set({ failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS), updatedAt: now })
        .where(eq(s.users.id, user.id));
    }
    return { ok: false, error: "invalid" };
  }
  await db
    .update(s.users)
    .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(eq(s.users.id, user.id));
  return { ok: true, sessionToken: await createSession(db, user.id, now) };
}
