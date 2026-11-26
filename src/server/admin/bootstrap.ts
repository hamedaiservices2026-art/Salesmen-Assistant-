import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { createInvite } from "@/server/auth/invites";
import { normalizeEmail } from "@/server/auth/password";

const PLATFORM_ID = "platform";

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
  const inviteToken = await db.transaction((tx) => insertOwnerWithInvite(tx as unknown as Db, email, input.name));
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
