import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
    return { inviteToken: await createInvite(db, existing.id) };
  }
  const ownerId = randomUUID();
  const inviteToken = await db.transaction(async (tx) => {
    await tx
      .insert(s.companies)
      .values({ id: PLATFORM_ID, name: "Platform", sellingWeekdays: [6, 0, 1, 2, 3, 4], weekStartsOn: 6 })
      .onConflictDoNothing();
    await tx
      .insert(s.users)
      .values({ id: ownerId, companyId: PLATFORM_ID, role: "owner", name: input.name.trim() || email, login: email });
    return createInvite(tx as unknown as Db, ownerId);
  });
  return { inviteToken };
}
