import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import { isLocale, type Locale } from "@/i18n/config";
import { createInvite } from "@/server/auth/invites";
import { isEmail, normalizeEmail } from "@/server/auth/password";
import { assertRole, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { isUniqueViolation } from "@/server/db-errors";

/** The roles an admin can create and list; owners live in the platform company and are not managed here. */
const MANAGED_ROLES = ["rep", "supervisor", "admin"] as const satisfies readonly Role[];
const roleSchema = z.enum(MANAGED_ROLES);

/** Rep and supervisor logins: 3 to 32 of lowercase letters, digits, dot, underscore, hyphen. */
const PIN_LOGIN = /^[a-z0-9._-]{3,32}$/;

export type UserRow = {
  id: string;
  name: string;
  login: string;
  role: Role;
  active: boolean;
  supervisorId: string | null;
  supervisorName: string | null;
  /** Whether he has set his PIN (reps, supervisors) or password (admins). */
  hasSecret: boolean;
  lastClose: ISODate | null;
};

export type NewUser = {
  name: string;
  login: string;
  role: "rep" | "supervisor" | "admin";
  supervisorId?: string | null;
  locale?: Locale;
};

export type CreateUserResult =
  | { ok: true; userId: string; inviteToken: string }
  | { ok: false; errors: Record<string, string> };

const ROLE_ORDER: Record<Role, number> = { admin: 0, supervisor: 1, rep: 2, owner: 3 };

/** The company's admins, supervisors and reps, with who supervises whom and when each last closed a day. */
export async function listUsers(ctx: Ctx): Promise<UserRow[]> {
  assertRole(ctx, ["admin"]);
  const users = await ctx.db
    .select()
    .from(s.users)
    .where(and(eq(s.users.companyId, ctx.companyId), inArray(s.users.role, [...MANAGED_ROLES])));
  const lastCloses = await ctx.db
    .select({ userId: s.dailyCloses.userId, last: max(s.dailyCloses.date) })
    .from(s.dailyCloses)
    .where(and(eq(s.dailyCloses.companyId, ctx.companyId), eq(s.dailyCloses.status, "confirmed")))
    .groupBy(s.dailyCloses.userId);
  const lastOf = new Map(lastCloses.map((r) => [r.userId, r.last]));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return users
    .map<UserRow>((u) => ({
      id: u.id,
      name: u.name,
      login: u.login,
      role: u.role,
      active: u.active,
      supervisorId: u.supervisorId,
      supervisorName: u.supervisorId ? (nameOf.get(u.supervisorId) ?? null) : null,
      hasSecret: Boolean(u.role === "admin" ? u.passwordHash : u.pinHash),
      lastClose: lastOf.get(u.id) ?? null,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id));
}

/**
 * Creates a rep, supervisor or admin of the caller's company with a first invite link (the token is
 * shown once). Field problems come back as `errors[field] = code`. Logins are unique across all
 * companies, so the unique index has the last word when two admins submit the same one at once.
 */
export async function createUser(ctx: Ctx, input: NewUser): Promise<CreateUserResult> {
  assertRole(ctx, ["admin"]);
  const errors: Record<string, string> = {};
  const name = String(input.name ?? "").trim();
  if (!name) errors.name = "required";

  const role = roleSchema.safeParse(input.role);
  let login = "";
  if (!role.success) {
    errors.role = "invalid";
  } else {
    login = role.data === "admin" ? normalizeEmail(String(input.login ?? "")) : String(input.login ?? "").trim().toLowerCase();
    const valid = role.data === "admin" ? isEmail(login) : PIN_LOGIN.test(login);
    if (!valid) errors.login = "invalid";
  }

  if (input.locale !== undefined && !isLocale(input.locale)) errors.locale = "invalid";

  const wantsSupervisor = role.success && role.data === "rep" && input.supervisorId;
  if (wantsSupervisor) {
    const [sup] = await ctx.db
      .select({ id: s.users.id })
      .from(s.users)
      .where(
        and(
          eq(s.users.id, String(input.supervisorId)),
          eq(s.users.companyId, ctx.companyId),
          eq(s.users.role, "supervisor"),
          eq(s.users.active, true),
        ),
      );
    if (!sup) errors.supervisorId = "invalid";
  }
  if (Object.keys(errors).length > 0 || !role.success) return { ok: false, errors };

  const [existing] = await ctx.db.select({ id: s.users.id }).from(s.users).where(eq(s.users.login, login));
  if (existing) return { ok: false, errors: { login: "taken" } };

  let locale = input.locale;
  if (!locale) {
    const [company] = await ctx.db
      .select({ defaultLocale: s.companies.defaultLocale })
      .from(s.companies)
      .where(eq(s.companies.id, ctx.companyId));
    locale = company?.defaultLocale ?? "ar";
  }

  const userId = randomUUID();
  try {
    const inviteToken = await ctx.db.transaction(async (tx) => {
      await tx.insert(s.users).values({
        id: userId,
        companyId: ctx.companyId,
        role: role.data,
        name,
        login,
        locale,
        supervisorId: wantsSupervisor ? String(input.supervisorId) : null,
      });
      return createInvite(tx as unknown as Db, userId);
    });
    return { ok: true, userId, inviteToken };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, errors: { login: "taken" } };
    throw e;
  }
}

/**
 * A new link for a user of the caller's company. It is also the PIN (or password) reset: his
 * earlier unused links are voided, the current secret keeps working until the new link is used,
 * and using it voids his sessions. Another company's id, an owner's and an inactive user's are `not_found`.
 */
export async function issueInvite(
  ctx: Ctx,
  userId: string,
): Promise<{ ok: true; token: string; role: Role } | { ok: false; error: "not_found" }> {
  assertRole(ctx, ["admin"]);
  return ctx.db.transaction(async (tx) => {
    // The row lock makes two links issued at once take turns, so the first is voided by the second.
    const [user] = await tx
      .select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(
        and(
          eq(s.users.id, userId),
          eq(s.users.companyId, ctx.companyId),
          eq(s.users.active, true),
          inArray(s.users.role, [...MANAGED_ROLES]),
        ),
      )
      .for("update");
    if (!user) return { ok: false as const, error: "not_found" as const };
    const now = new Date();
    await tx
      .update(s.invites)
      .set({ usedAt: now, updatedAt: now })
      .where(and(eq(s.invites.userId, user.id), eq(s.invites.companyId, ctx.companyId), isNull(s.invites.usedAt)));
    const token = await createInvite(tx as unknown as Db, user.id, now);
    return { ok: true as const, token, role: user.role };
  });
}

/**
 * Turns a user of the caller's company off or on. Turning off deletes his sessions and voids his
 * unused links, so a reactivation does not bring an old link back. Turning a supervisor off also clears
 * the supervisor of his reps (they stay active, with no supervisor), so nobody keeps a team that is
 * not led. An admin cannot turn himself off.
 */
export async function setActive(
  ctx: Ctx,
  userId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "self" | "last_admin" }> {
  assertRole(ctx, ["admin"]);
  return ctx.db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: s.users.id, role: s.users.role, active: s.users.active })
      .from(s.users)
      .where(and(eq(s.users.id, userId), eq(s.users.companyId, ctx.companyId), inArray(s.users.role, [...MANAGED_ROLES])));
    if (!user) return { ok: false as const, error: "not_found" as const };
    if (user.id === ctx.userId) return { ok: false as const, error: "self" as const };
    if (!active && user.role === "admin") {
      // Lock the company's active admins so two admins stopping each other at once take turns:
      // the second sees one admin left and is refused, and the company always keeps a way in.
      const admins = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.role, "admin"), eq(s.users.active, true)))
        .for("update");
      const others = admins.filter((a) => a.id !== user.id);
      if (admins.some((a) => a.id === user.id) && others.length === 0) {
        return { ok: false as const, error: "last_admin" as const };
      }
    }
    const now = new Date();
    await tx
      .update(s.users)
      .set({ active, updatedAt: now })
      .where(and(eq(s.users.id, user.id), eq(s.users.companyId, ctx.companyId)));
    if (!active) {
      await tx.delete(s.sessions).where(and(eq(s.sessions.userId, user.id), eq(s.sessions.companyId, ctx.companyId)));
      await tx
        .update(s.invites)
        .set({ usedAt: now, updatedAt: now })
        .where(and(eq(s.invites.userId, user.id), eq(s.invites.companyId, ctx.companyId), isNull(s.invites.usedAt)));
      if (user.role === "supervisor") {
        await tx
          .update(s.users)
          .set({ supervisorId: null, updatedAt: now })
          .where(and(eq(s.users.supervisorId, user.id), eq(s.users.companyId, ctx.companyId)));
      }
    }
    return { ok: true as const };
  });
}

/**
 * Sets (or with `null` clears) the supervisor of the given reps. The supervisor must be an active
 * supervisor of the caller's company and every id a rep of it; otherwise nothing changes.
 */
export async function assignSupervisor(
  ctx: Ctx,
  repIds: string[],
  supervisorId: string | null,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertRole(ctx, ["admin"]);
  const ids = [...new Set(repIds)];
  return ctx.db.transaction(async (tx) => {
    if (supervisorId !== null) {
      const [sup] = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(
          and(
            eq(s.users.id, supervisorId),
            eq(s.users.companyId, ctx.companyId),
            eq(s.users.role, "supervisor"),
            eq(s.users.active, true),
          ),
        )
        .for("share");
      if (!sup) return { ok: false as const, error: "not_found" as const };
    }
    if (ids.length === 0) return { ok: true as const };
    const reps = await tx
      .select({ id: s.users.id })
      .from(s.users)
      .where(and(inArray(s.users.id, ids), eq(s.users.companyId, ctx.companyId), eq(s.users.role, "rep")))
      .orderBy(asc(s.users.id));
    if (reps.length !== ids.length) return { ok: false as const, error: "not_found" as const };
    await tx
      .update(s.users)
      .set({ supervisorId, updatedAt: new Date() })
      .where(and(inArray(s.users.id, ids), eq(s.users.companyId, ctx.companyId), eq(s.users.role, "rep")));
    return { ok: true as const };
  });
}
