import { and, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

/**
 * Runs `check` (a slow secret comparison) under the shared lockout: five consecutive failures lock
 * the user for 15 minutes.
 *
 * Every attempt first reserves one of the five tries in a single conditional UPDATE that also
 * checks the lock, so a burst of parallel requests can reach `check` at most five times. The
 * reservation stamps `failed_at`; a counter left at the limit with no lock (the lock write was
 * lost) restarts once `failed_at` is older than the lock window. A failure at the limit writes
 * the lock; a success clears the counter only while unlocked, so it cannot undo a lock that
 * parallel failures set meanwhile.
 */
export async function attemptWithLockout(
  db: Db,
  userId: string,
  check: () => Promise<boolean>,
  now: Date,
): Promise<"ok" | "invalid" | "locked"> {
  const unlocked = or(isNull(s.users.lockedUntil), lte(s.users.lockedUntil, now));
  const stale = new Date(now.getTime() - LOCK_MS);
  const reserved = await db
    .update(s.users)
    .set({
      failedAttempts: sql`CASE WHEN ${s.users.failedAttempts} >= ${MAX_FAILURES} THEN 1 ELSE ${s.users.failedAttempts} + 1 END`,
      failedAt: now,
    })
    .where(
      and(
        eq(s.users.id, userId),
        unlocked,
        or(lt(s.users.failedAttempts, MAX_FAILURES), isNull(s.users.failedAt), lte(s.users.failedAt, stale)),
      ),
    )
    .returning({ id: s.users.id });
  if (reserved.length === 0) {
    // Either locked, or the counter sits at the limit with the lock about to be written
    // (its last reservation is less than the lock window old).
    return "locked";
  }

  if (!(await check())) {
    await db
      .update(s.users)
      .set({ failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) })
      .where(and(eq(s.users.id, userId), unlocked, gte(s.users.failedAttempts, MAX_FAILURES)));
    return "invalid";
  }

  const cleared = await db
    .update(s.users)
    .set({ failedAttempts: 0, failedAt: null, lockedUntil: null })
    .where(and(eq(s.users.id, userId), unlocked, eq(s.users.active, true)))
    .returning({ id: s.users.id });
  return cleared.length === 0 ? "locked" : "ok";
}
