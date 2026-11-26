import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { createInvite } from "@/server/auth/invites";
import { normalizeEmail } from "@/server/auth/password";

const PLATFORM_ID = "platform";

/**
 * Fixed key of the advisory lock that serializes every creation of an owner (`/setup` and
 * `pnpm admin:create-owner`) across instances and processes. Outside the int4 range on purpose,
 * so it never meets a `hashtext(...)` key of the other advisory locks.
 */
export const OWNER_CREATION_LOCK_KEY = 7_311_000_019;

/**
 * Takes the owner-creation lock for the rest of the caller's transaction. Transaction-scoped
 * (`pg_advisory_xact_lock`), so it holds behind a transaction-mode pooler and is released on
 * commit or rollback; never a session lock that could stay on a pooled connection.
 */
export async function lockOwnerCreation(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(`${OWNER_CREATION_LOCK_KEY}::bigint`)})`);
}

/**
 * First-run setup for the platform owner (no signed-in user exists yet, so this takes a `Db`):
 * creates the `platform` company and the owner when missing, and returns a fresh invite token
 * that sets his password. For an existing owner it only issues a new invite (password recovery).
 */
export async function createOwner(db: Db, input: { email: string; name: string }): Promise<{ inviteToken: string }> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("An email is required");
  const [existing] = await db
    .select({ id: s.users.id, role: s.users.role })
    .from(s.users)
    .where(eq(s.users.login, email));
  if (existing) {
    if (existing.role !== "owner") throw new Error(`${email} already belongs to a user who is not an owner`);
    // Recovery: any invite still unused is voided in the same transaction that issues the new one, so
    // a link that leaked earlier cannot be opened after the owner asked for a fresh one.
    return db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(s.invites)
        .set({ usedAt: now, updatedAt: now })
        .where(and(eq(s.invites.userId, existing.id), isNull(s.invites.usedAt)));
      return { inviteToken: await createInvite(tx as unknown as Db, existing.id, now) };
    });
  }
  // The same lock as /setup: a /setup submission running at this moment either finishes first
  // (and this adds a second owner, which the command allows) or waits and then sees this owner.
  const inviteToken = await db.transaction(async (tx) => {
    await lockOwnerCreation(tx as unknown as Db);
    return insertOwnerWithInvite(tx as unknown as Db, email, input.name);
  });
  return { inviteToken };
}

/**
 * Inside the caller's transaction: creates the `platform` company when missing and a new owner
 * with `email` (already normalized), and returns his invite token (only its hash is stored).
 * Shared by `createOwner` and the one-time `/setup` page.
 */
export async function insertOwnerWithInvite(tx: Db, email: string, name: string): Promise<string> {
  const ownerId = randomUUID();
  await tx
    .insert(s.companies)
    .values({ id: PLATFORM_ID, name: "Platform", sellingWeekdays: [6, 0, 1, 2, 3, 4], weekStartsOn: 6 })
    .onConflictDoNothing();
  await tx
    .insert(s.users)
    .values({ id: ownerId, companyId: PLATFORM_ID, role: "owner", name: name.trim() || email, login: email });
  return createInvite(tx, ownerId);
}
