import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { invitePath } from "@/server/auth/invites";
import { isEmail, normalizeEmail } from "@/server/auth/password";
import { insertOwnerWithInvite, lockOwnerCreation } from "./bootstrap";

/**
 * The one-time `/setup` page: creates the first platform owner for someone who cannot run
 * `pnpm admin:create-owner`. It exists only while `SETUP_TOKEN` holds at least 32 characters AND
 * no user with role `owner` exists; otherwise the page and its action answer a plain 404.
 */

export const SETUP_TOKEN_MIN = 32;
export const SETUP_MAX_FAILURES = 5;
/** The window the five tries are counted in, and how long the page stays locked after them. */
export const SETUP_LOCK_MS = 15 * 60 * 1000;
/** Every refusal of a token (wrong, or during the lock) waits this long before it answers. */
export const SETUP_FAIL_DELAY_MS = 1000;
const EMAIL_MAX = 254;
const EMAIL_LOCAL_MAX = 64;
const NAME_MAX = 100;
const ROW_ID = 1;

type Env = Record<string, string | undefined>;

export type SetupInput = { token: string; email: string; name: string };
export type SetupResult =
  | { status: "closed" }
  | { status: "refused" }
  | { status: "invalid"; field: "email" | "name" }
  | { status: "created"; invitePath: string };

/** The configured setup token, trimmed, or null when it is unset or shorter than 32 characters (feature off). */
export function configuredSetupToken(env: Env): string | null {
  const token = (env.SETUP_TOKEN ?? "").trim();
  return token.length >= SETUP_TOKEN_MIN ? token : null;
}

async function ownerExists(db: Db): Promise<boolean> {
  const rows = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, "owner")).limit(1);
  return rows.length > 0;
}

/** Whether `/setup` exists right now: a long enough token is set and there is no owner yet. */
export async function isSetupOpen(db: Db, env: Env): Promise<boolean> {
  return configuredSetupToken(env) !== null && !(await ownerExists(db));
}

/** Constant-time comparison over fixed-length hashes, so neither the length nor a prefix leaks. */
function tokenMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Control characters, line and paragraph separators, and bidi controls (marks, embeddings,
// overrides, isolates, the Arabic letter mark).
const UNSAFE = /[\p{Cc}\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** A plain owner name of 1 to 100 characters after trimming, or null. */
export function validOwnerName(raw: string): string | null {
  const name = raw.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > NAME_MAX || UNSAFE.test(name)) return null;
  return name;
}

/** A normalized (trimmed, lowercased) email of basic shape and length, printable ASCII only, or null. */
export function validOwnerEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email.length > EMAIL_MAX || !/^[\x21-\x7e]+$/.test(email) || !isEmail(email)) return null;
  if (email.split("@")[0]!.length > EMAIL_LOCAL_MAX) return null;
  return email;
}

/**
 * Reserves one of the five tries in a single conditional UPDATE that also checks the lock, so a
 * burst of parallel requests reaches the comparison at most five times per window. The window
 * restarts when its first try is older than 15 minutes. Returns the count after this try, or
 * null while locked (or while five tries of the current window are already used).
 */
async function reserveTry(db: Db, now: Date): Promise<number | null> {
  await db.insert(s.setupAttempts).values({ id: ROW_ID }).onConflictDoNothing();
  // Times go into the raw SQL as ISO strings with a cast: postgres-js (production) cannot serialize
  // a Date handed to it as an untyped parameter (PGlite can, so only real Postgres would fail).
  const at = sql`${now.toISOString()}::timestamptz`;
  const stale = sql`${new Date(now.getTime() - SETUP_LOCK_MS).toISOString()}::timestamptz`;
  const restart = sql`(${s.setupAttempts.windowStartedAt} IS NULL OR ${s.setupAttempts.windowStartedAt} <= ${stale})`;
  const [row] = await db
    .update(s.setupAttempts)
    .set({
      failures: sql`CASE WHEN ${restart} THEN 1 ELSE ${s.setupAttempts.failures} + 1 END`,
      windowStartedAt: sql`CASE WHEN ${restart} THEN ${at} ELSE ${s.setupAttempts.windowStartedAt} END`,
    })
    .where(
      and(
        eq(s.setupAttempts.id, ROW_ID),
        or(isNull(s.setupAttempts.lockedUntil), lte(s.setupAttempts.lockedUntil, now)),
        or(lt(s.setupAttempts.failures, SETUP_MAX_FAILURES), restart),
      ),
    )
    .returning({ failures: s.setupAttempts.failures });
  return row ? row.failures : null;
}

async function lock(db: Db, now: Date): Promise<void> {
  await db
    .update(s.setupAttempts)
    .set({ failures: 0, windowStartedAt: null, lockedUntil: new Date(now.getTime() + SETUP_LOCK_MS) })
    .where(eq(s.setupAttempts.id, ROW_ID));
}

async function clearTries(db: Db): Promise<void> {
  await db
    .update(s.setupAttempts)
    .set({ failures: 0, windowStartedAt: null, lockedUntil: null })
    .where(eq(s.setupAttempts.id, ROW_ID));
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Creates the first owner and returns his `/admin/invite/<token>` path (shown once, never logged;
 * only the token's hash is stored, as for every invite).
 *
 * Order: closed (no token configured, or an owner exists) -> field shape (reveals nothing about
 * the token) -> reserve a try (locked: refuse without comparing) -> constant-time comparison ->
 * one transaction under an advisory lock that re-checks for an owner and the email, then creates
 * the owner and invite exactly as `pnpm admin:create-owner` does.
 */
export async function setupFirstOwner(
  db: Db,
  input: SetupInput,
  opts: { env: Env; now?: Date; sleep?: (ms: number) => Promise<void> },
): Promise<SetupResult> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? realSleep;
  const expected = configuredSetupToken(opts.env);
  if (!expected || (await ownerExists(db))) return { status: "closed" };

  const email = validOwnerEmail(input.email);
  if (!email) return { status: "invalid", field: "email" };
  const name = validOwnerName(input.name);
  if (!name) return { status: "invalid", field: "name" };

  const tries = await reserveTry(db, now);
  if (tries === null) {
    await sleep(SETUP_FAIL_DELAY_MS);
    return { status: "refused" };
  }
  if (!tokenMatches(input.token.trim(), expected)) {
    if (tries >= SETUP_MAX_FAILURES) await lock(db, now);
    await sleep(SETUP_FAIL_DELAY_MS);
    return { status: "refused" };
  }
  await clearTries(db);

  const inviteToken = await db.transaction(async (tx) => {
    // The owner-creation lock, shared with `pnpm admin:create-owner`: a second submission (or the
    // command) waits here, then the re-check below takes a fresh snapshot and sees the owner.
    await lockOwnerCreation(tx as unknown as Db);
    const [taken] = await tx
      .select({ role: s.users.role })
      .from(s.users)
      .where(or(eq(s.users.role, "owner"), eq(s.users.login, email)))
      .limit(1);
    if (taken) return null;
    return insertOwnerWithInvite(tx as unknown as Db, email, name);
  });
  if (!inviteToken) return { status: "refused" };
  return { status: "created", invitePath: invitePath("owner", inviteToken) };
}
