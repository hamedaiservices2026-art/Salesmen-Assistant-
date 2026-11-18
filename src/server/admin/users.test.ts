import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { acceptAdminInvite, acceptInvite, invitePath, peekAdminInvite } from "@/server/auth/invites";
import { getSessionUser, signIn, createSession } from "@/server/auth/sessions";
import { getMonthView } from "@/server/repos/month-view";
import { repCtx } from "./rep-ctx";
import { assignSupervisor, createUser, issueInvite, listUsers, setActive } from "./users";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const admin = () => ctxOf(seed.adminId, "admin");
const sami = () => ctxOf("sami", "supervisor");
const ahmed = () => ctxOf("ahmed", "rep");

/** An admin of the other company, to forge ids in the opposite direction. */
async function otherAdmin(): Promise<Ctx> {
  await db.insert(s.users).values({
    id: "other-admin",
    companyId: "other-co",
    role: "admin",
    name: "Other Admin",
    login: "admin@other.test",
  });
  return ctxOf("other-admin", "admin", "other-co");
}

/** Every row a user action could touch, so "nothing changed in either company" is one comparison. */
async function snapshot() {
  const users = (await db.select().from(s.users)).map((u) => ({ ...u, updatedAt: null }));
  const invites = (await db.select().from(s.invites)).map((i) => ({ id: i.id, usedAt: i.usedAt }));
  const sessions = (await db.select().from(s.sessions)).map((x) => x.id);
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { users: byId(users), invites: byId(invites), sessions: [...sessions].sort() };
}

const userRow = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;

describe("createUser", () => {
  it("trims and lowercases a rep's login and returns an invite that sets his PIN", async () => {
    const r = await createUser(admin(), { name: " ماجد ", login: "  Majed.K ", role: "rep" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await userRow(r.userId);
    expect(row).toMatchObject({
      login: "majed.k",
      name: "ماجد",
      role: "rep",
      companyId: "demo-co",
      active: true,
      supervisorId: null,
      pinHash: null,
      locale: "ar",
    });
    expect((await acceptInvite(db, r.inviteToken, "482915")).ok).toBe(true);
    expect((await signIn(db, "Majed.K", "482915")).ok).toBe(true);
  });

  it("creates a supervisor and an admin (an email login, accepted on the admin route)", async () => {
    const sup = await createUser(admin(), { name: "نبيل", login: "nabil_s", role: "supervisor" });
    expect(sup.ok && (await userRow(sup.userId)).role).toBe("supervisor");
    const a = await createUser(admin(), { name: "مدير ثان", login: "  Boss2@Demo.TEST ", role: "admin", locale: "en" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(await userRow(a.userId)).toMatchObject({ login: "boss2@demo.test", role: "admin", companyId: "demo-co", locale: "en" });
    expect(await peekAdminInvite(db, a.inviteToken)).toEqual({ name: "مدير ثان", login: "boss2@demo.test" });
    expect((await acceptAdminInvite(db, a.inviteToken, "a-long-password-1")).ok).toBe(true);
  });

  it("takes the company language when none is given", async () => {
    await db.update(s.companies).set({ defaultLocale: "ur" }).where(eq(s.companies.id, "demo-co"));
    const r = await createUser(admin(), { name: "نمائندہ", login: "urdu.rep", role: "rep" });
    expect(r.ok && (await userRow(r.userId)).locale).toBe("ur");
  });

  it("refuses a login that is taken, in either case, in any company", async () => {
    expect(await createUser(admin(), { name: "x", login: "AHMED", role: "rep" })).toEqual({
      ok: false,
      errors: { login: "taken" },
    });
    expect(await createUser(admin(), { name: "x", login: "other-rep", role: "rep" })).toEqual({
      ok: false,
      errors: { login: "taken" },
    });
    expect(await createUser(admin(), { name: "x", login: "ADMIN@demo.test", role: "admin" })).toEqual({
      ok: false,
      errors: { login: "taken" },
    });
  });

  it("refuses a malformed login", async () => {
    for (const login of ["a b", "ab", "x".repeat(33), "ماجد", "a@b.c"]) {
      expect(await createUser(admin(), { name: "x", login, role: "rep" })).toEqual({
        ok: false,
        errors: { login: "invalid" },
      });
    }
    expect(await createUser(admin(), { name: "x", login: "not-an-email", role: "admin" })).toEqual({
      ok: false,
      errors: { login: "invalid" },
    });
    expect(await createUser(admin(), { name: "x", login: "   ", role: "rep" })).toEqual({
      ok: false,
      errors: { login: "invalid" },
    });
  });

  it("requires a name, and reports every bad field", async () => {
    expect(await createUser(admin(), { name: "  ", login: "fine.login", role: "rep" })).toEqual({
      ok: false,
      errors: { name: "required" },
    });
    const r = await createUser(admin(), { name: "", login: "a b", role: "rep", locale: "fr" as never });
    expect(r).toEqual({ ok: false, errors: { name: "required", login: "invalid", locale: "invalid" } });
  });

  it("rejects the owner role and any other unknown role", async () => {
    for (const role of ["owner", "root", ""]) {
      expect(await createUser(admin(), { name: "x", login: "valid.login", role: role as never })).toEqual({
        ok: false,
        errors: { role: "invalid" },
      });
    }
    expect((await db.select().from(s.users).where(eq(s.users.login, "valid.login"))).length).toBe(0);
  });

  it("assigns a supervisor of the company to a rep, and refuses anyone else", async () => {
    const ok = await createUser(admin(), { name: "تابع", login: "under.sami", role: "rep", supervisorId: "sami" });
    expect(ok.ok && (await userRow(ok.userId)).supervisorId).toBe("sami");
    const other = await otherAdmin();
    await db.insert(s.users).values({ id: "other-sup", companyId: "other-co", role: "supervisor", name: "S", login: "other-sup" });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "khaled"));
    for (const supervisorId of ["other-sup", "other-rep", "ahmed", seed.adminId, "nobody", "khaled"]) {
      expect(await createUser(admin(), { name: "x", login: `t.${supervisorId}`, role: "rep", supervisorId })).toEqual({
        ok: false,
        errors: { supervisorId: "invalid" },
      });
    }
    // The other company's admin cannot use demo-co's supervisor either.
    expect(await createUser(other, { name: "x", login: "t.cross", role: "rep", supervisorId: "sami" })).toEqual({
      ok: false,
      errors: { supervisorId: "invalid" },
    });
  });

  it("ignores a supervisor on a supervisor or an admin", async () => {
    const r = await createUser(admin(), { name: "x", login: "sup.two", role: "supervisor", supervisorId: "sami" });
    expect(r.ok && (await userRow(r.userId)).supervisorId).toBeNull();
  });

  it("is refused for a rep, a supervisor and an owner", async () => {
    const input = { name: "x", login: "valid.login", role: "rep" as const };
    await expect(createUser(ahmed(), input)).rejects.toBeInstanceOf(Forbidden);
    await expect(createUser(sami(), input)).rejects.toBeInstanceOf(Forbidden);
    await expect(createUser(ctxOf(seed.ownerId, "owner", "platform"), input)).rejects.toBeInstanceOf(Forbidden);
    expect((await db.select().from(s.users).where(eq(s.users.login, "valid.login"))).length).toBe(0);
  });

  it("creates the user in the caller's company even when two admins race for the same login", async () => {
    const other = await otherAdmin();
    const [a, b] = await Promise.all([
      createUser(admin(), { name: "x", login: "same.login", role: "rep" }),
      createUser(other, { name: "y", login: "same.login", role: "rep" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await db.select().from(s.users).where(eq(s.users.login, "same.login"))).length).toBe(1);
  });
});

describe("listUsers", () => {
  it("lists the company's reps, supervisor and admin, never another company's or the owner", async () => {
    const rows = await listUsers(admin());
    expect(rows.map((r) => r.id).sort()).toEqual(["ahmed", "demo-admin", "khaled", "omar", "sami", "yousef"]);
    const ahmedRow = rows.find((r) => r.id === "ahmed")!;
    expect(ahmedRow).toEqual({
      id: "ahmed",
      name: "أحمد",
      login: "ahmed",
      role: "rep",
      active: true,
      supervisorId: "sami",
      supervisorName: "سامي",
      hasSecret: false,
      lastClose: "2026-11-12",
    });
    expect(rows.find((r) => r.id === "yousef")).toMatchObject({ supervisorId: null, supervisorName: null, lastClose: null });
    expect(rows.find((r) => r.id === "demo-admin")).toMatchObject({ hasSecret: true, role: "admin" });
  });

  it("shows hasSecret once a PIN is set, and the other company sees only its own", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    expect((await listUsers(admin())).find((r) => r.id === "ahmed")!.hasSecret).toBe(true);
    const other = await otherAdmin();
    expect((await listUsers(other)).map((r) => r.id).sort()).toEqual(["other-admin", "other-rep"]);
  });

  it("is refused for a rep and a supervisor", async () => {
    await expect(listUsers(ahmed())).rejects.toBeInstanceOf(Forbidden);
    await expect(listUsers(sami())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("issueInvite", () => {
  it("a second link voids the first: the first token's acceptInvite is `used`", async () => {
    const first = await issueInvite(admin(), "ahmed");
    const second = await issueInvite(admin(), "ahmed");
    expect(first).toMatchObject({ ok: true, role: "rep" });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.token).not.toBe(second.token);
    expect(await acceptInvite(db, first.token, "482915")).toEqual({ ok: false, error: "used" });
    expect((await acceptInvite(db, second.token, "482915")).ok).toBe(true);
    // The seeded invite from `seedDemo` was voided too.
    expect(await acceptInvite(db, seed.inviteToken, "482915")).toEqual({ ok: false, error: "used" });
  });

  it("is a PIN reset: the old PIN works until the new link is used, then it and its sessions stop", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    const session = await createSession(db, "ahmed");
    const link = await issueInvite(admin(), "ahmed");
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect((await signIn(db, "ahmed", "482915")).ok).toBe(true);
    expect(await getSessionUser(db, session)).not.toBeNull();
    expect((await acceptInvite(db, link.token, "739154")).ok).toBe(true);
    expect(await signIn(db, "ahmed", "482915")).toEqual({ ok: false, error: "invalid" });
    expect(await getSessionUser(db, session)).toBeNull();
    expect((await signIn(db, "ahmed", "739154")).ok).toBe(true);
  });

  it("issues an admin's link on the admin route, and a supervisor's on the PIN route", async () => {
    const a = await issueInvite(admin(), seed.adminId);
    const sup = await issueInvite(admin(), "sami");
    expect(a).toMatchObject({ ok: true, role: "admin" });
    expect(sup).toMatchObject({ ok: true, role: "supervisor" });
    if (a.ok && sup.ok) {
      expect(invitePath(a.role, a.token)).toBe(`/admin/invite/${a.token}`);
      expect(invitePath(sup.role, sup.token)).toBe(`/invite/${sup.token}`);
    }
  });

  it("refuses an unknown id, an inactive user and any caller who is not an admin", async () => {
    expect(await issueInvite(admin(), "nobody")).toEqual({ ok: false, error: "not_found" });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "omar"));
    expect(await issueInvite(admin(), "omar")).toEqual({ ok: false, error: "not_found" });
    await expect(issueInvite(ahmed(), "ahmed")).rejects.toBeInstanceOf(Forbidden);
    await expect(issueInvite(sami(), "ahmed")).rejects.toBeInstanceOf(Forbidden);
    await expect(issueInvite(ctxOf(seed.ownerId, "owner", "platform"), "ahmed")).rejects.toBeInstanceOf(Forbidden);
  });

  it("a forged id from another company is not_found and nothing changes in either company (Review Focus 1)", async () => {
    const other = await otherAdmin();
    const before = await snapshot();
    expect(await issueInvite(admin(), "other-rep")).toEqual({ ok: false, error: "not_found" });
    expect(await issueInvite(admin(), "other-admin")).toEqual({ ok: false, error: "not_found" });
    expect(await issueInvite(other, "ahmed")).toEqual({ ok: false, error: "not_found" });
    expect(await issueInvite(other, seed.adminId)).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
    // The owner of the platform is outside every company's admin reach.
    expect(await issueInvite(admin(), seed.ownerId)).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("two links issued at once leave only one usable", async () => {
    const [a, b] = await Promise.all([issueInvite(admin(), "omar"), issueInvite(admin(), "omar")]);
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    const results = [await acceptInvite(db, a.token, "482915"), await acceptInvite(db, b.token, "739154")];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("setActive", () => {
  it("deactivating ends the user's sessions and blocks sign-in and invites", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    const session = await createSession(db, "ahmed");
    const link = await issueInvite(admin(), "ahmed");
    expect(await getSessionUser(db, session)).not.toBeNull();
    expect(await setActive(admin(), "ahmed", false)).toEqual({ ok: true });
    expect(await getSessionUser(db, session)).toBeNull();
    expect((await userRow("ahmed")).active).toBe(false);
    expect(await signIn(db, "ahmed", "482915")).toEqual({ ok: false, error: "invalid" });
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, "ahmed"))).toHaveLength(0);
    // A link issued before the deactivation does not come back to life with a reactivation.
    expect(await setActive(admin(), "ahmed", true)).toEqual({ ok: true });
    if (link.ok) expect(await acceptInvite(db, link.token, "739154")).toEqual({ ok: false, error: "used" });
    expect(await signIn(db, "ahmed", "482915")).toMatchObject({ ok: true });
  });

  it("deactivating a supervisor clears the supervisor of his reps, who stay active", async () => {
    expect((await userRow("ahmed")).supervisorId).toBe("sami");
    expect(await setActive(admin(), "sami", false)).toEqual({ ok: true });
    for (const id of ["ahmed", "khaled"]) expect(await userRow(id)).toMatchObject({ supervisorId: null, active: true });
    expect(await repCtx(sami(), "ahmed")).toBeNull();
    // reactivating him does not bring the team back; the admin assigns it again
    expect(await setActive(admin(), "sami", true)).toEqual({ ok: true });
    expect((await userRow("ahmed")).supervisorId).toBeNull();
  });

  it("deactivating a supervisor leaves reps of other supervisors and of other companies alone", async () => {
    await db.insert(s.users).values({ id: "sup2", companyId: "demo-co", role: "supervisor", name: "S2", login: "sup2" });
    await db.update(s.users).set({ supervisorId: "sup2" }).where(eq(s.users.id, "omar"));
    await setActive(admin(), "sami", false);
    expect((await userRow("omar")).supervisorId).toBe("sup2");
  });

  it("refuses the caller himself", async () => {
    expect(await setActive(admin(), seed.adminId, false)).toEqual({ ok: false, error: "self" });
    expect((await userRow(seed.adminId)).active).toBe(true);
  });

  it("a forged id from another company is not_found and nothing changes in either company (Review Focus 1)", async () => {
    const other = await otherAdmin();
    await createSession(db, "other-rep");
    await createSession(db, "ahmed");
    const before = await snapshot();
    expect(await setActive(admin(), "other-rep", false)).toEqual({ ok: false, error: "not_found" });
    expect(await setActive(admin(), "other-admin", false)).toEqual({ ok: false, error: "not_found" });
    expect(await setActive(other, "ahmed", false)).toEqual({ ok: false, error: "not_found" });
    expect(await setActive(other, seed.adminId, false)).toEqual({ ok: false, error: "not_found" });
    expect(await setActive(admin(), seed.ownerId, false)).toEqual({ ok: false, error: "not_found" });
    expect(await setActive(admin(), "nobody", true)).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("keeps at least one active admin: the last one cannot be stopped (F3)", async () => {
    const second = await createUser(admin(), { name: "مدير ثان", login: "second@demo.test", role: "admin" });
    if (!second.ok) throw new Error("setup");
    const third = await createUser(admin(), { name: "مدير ثالث", login: "third@demo.test", role: "admin" });
    if (!third.ok) throw new Error("setup");
    expect(await setActive(admin(), second.userId, false)).toEqual({ ok: true });
    expect(await setActive(admin(), third.userId, false)).toEqual({ ok: true });
    // Only the seeded admin is active now; a third context (the stopped second admin's) cannot stop him.
    const ghost = ctxOf(second.userId, "admin");
    expect(await setActive(ghost, seed.adminId, false)).toEqual({ ok: false, error: "last_admin" });
    expect((await userRow(seed.adminId)).active).toBe(true);
    // A rep or an already stopped admin is never "the last admin".
    expect(await setActive(admin(), third.userId, false)).toEqual({ ok: true });
    expect(await setActive(admin(), "omar", false)).toEqual({ ok: true });
  });

  it("two admins stopping each other at once leave one active (F3)", async () => {
    const second = await createUser(admin(), { name: "مدير ثان", login: "second@demo.test", role: "admin" });
    if (!second.ok) throw new Error("setup");
    const results = await Promise.all([
      setActive(admin(), second.userId, false),
      setActive(ctxOf(second.userId, "admin"), seed.adminId, false),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "last_admin" }]);
    const active = (await db.select().from(s.users).where(eq(s.users.role, "admin"))).filter((u) => u.companyId === "demo-co" && u.active);
    expect(active).toHaveLength(1);
  });

  it("takes a FOR UPDATE lock on the company's active admin rows (what serializes real Postgres)", async () => {
    const second = await createUser(admin(), { name: "مدير ثان", login: "second@demo.test", role: "admin" });
    if (!second.ok) throw new Error("setup");
    const proto = Object.getPrototypeOf(db.select().from(s.users));
    const original = proto.for;
    const locked: { sql: string; params: unknown[] }[] = [];
    const spy = vi.spyOn(proto, "for").mockImplementation(function (this: { toSQL(): { sql: string; params: unknown[] } }, ...args: unknown[]) {
      const q = original.apply(this, args);
      locked.push(q.toSQL());
      return q;
    });
    try {
      expect(await setActive(admin(), second.userId, false)).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }
    const adminLock = locked.find((q) => /for update/i.test(q.sql) && q.sql.includes('"users"') && q.params.includes("admin"));
    expect(adminLock).toBeDefined();
    expect(adminLock!.params).toContain("demo-co");
  });

  it("is refused for a rep and a supervisor", async () => {
    await expect(setActive(ahmed(), "omar", false)).rejects.toBeInstanceOf(Forbidden);
    await expect(setActive(sami(), "ahmed", false)).rejects.toBeInstanceOf(Forbidden);
    expect((await userRow("omar")).active).toBe(true);
  });
});

describe("assignSupervisor", () => {
  it("assigns several reps to a supervisor and clears them with null", async () => {
    expect(await assignSupervisor(admin(), ["omar", "yousef"], "sami")).toEqual({ ok: true });
    expect((await userRow("omar")).supervisorId).toBe("sami");
    expect((await userRow("yousef")).supervisorId).toBe("sami");
    expect(await assignSupervisor(admin(), ["omar", "ahmed"], null)).toEqual({ ok: true });
    expect((await userRow("omar")).supervisorId).toBeNull();
    expect((await userRow("ahmed")).supervisorId).toBeNull();
    expect((await userRow("yousef")).supervisorId).toBe("sami");
  });

  it("needs an active supervisor of the company, and every id a rep of the company, or changes nothing", async () => {
    const before = await snapshot();
    await db.insert(s.users).values({ id: "other-sup", companyId: "other-co", role: "supervisor", name: "S", login: "other-sup" });
    const beforeAll = await snapshot();
    expect(beforeAll.users.length).toBe(before.users.length + 1);
    for (const supervisorId of ["other-sup", "ahmed", seed.adminId, "nobody"]) {
      expect(await assignSupervisor(admin(), ["omar"], supervisorId)).toEqual({ ok: false, error: "not_found" });
    }
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "sami"));
    expect(await assignSupervisor(admin(), ["omar"], "sami")).toEqual({ ok: false, error: "not_found" });
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, "sami"));
    for (const bad of ["other-rep", seed.adminId, "sami", "nobody"]) {
      expect(await assignSupervisor(admin(), ["omar", bad], "sami")).toEqual({ ok: false, error: "not_found" });
    }
    expect(await snapshot()).toEqual(beforeAll);
  });

  it("a forged rep id from another company is not_found and nothing changes in either company (Review Focus 1)", async () => {
    const other = await otherAdmin();
    await db.insert(s.users).values({ id: "other-sup", companyId: "other-co", role: "supervisor", name: "S", login: "other-sup" });
    const before = await snapshot();
    expect(await assignSupervisor(admin(), ["other-rep"], "sami")).toEqual({ ok: false, error: "not_found" });
    expect(await assignSupervisor(admin(), ["omar", "other-rep"], "sami")).toEqual({ ok: false, error: "not_found" });
    expect(await assignSupervisor(admin(), ["other-rep"], null)).toEqual({ ok: false, error: "not_found" });
    expect(await assignSupervisor(other, ["ahmed"], "other-sup")).toEqual({ ok: false, error: "not_found" });
    expect(await assignSupervisor(other, ["other-rep"], "sami")).toEqual({ ok: false, error: "not_found" });
    expect(await assignSupervisor(admin(), ["omar"], "other-sup")).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("an empty list is a no-op, and callers who are not admins are refused", async () => {
    expect(await assignSupervisor(admin(), [], "sami")).toEqual({ ok: true });
    await expect(assignSupervisor(ahmed(), ["ahmed"], null)).rejects.toBeInstanceOf(Forbidden);
    await expect(assignSupervisor(sami(), ["omar"], "sami")).rejects.toBeInstanceOf(Forbidden);
    expect((await userRow("omar")).supervisorId).toBeNull();
  });
});

describe("repCtx", () => {
  it("lets a supervisor reach himself and his own reps, and nobody else", async () => {
    expect(await repCtx(sami(), "ahmed")).toMatchObject({ userId: "ahmed", role: "rep", companyId: "demo-co" });
    expect(await repCtx(sami(), "khaled")).toMatchObject({ userId: "khaled", role: "rep" });
    expect(await repCtx(sami(), "sami")).toMatchObject({ userId: "sami", role: "rep" });
    expect(await repCtx(sami(), "omar")).toBeNull();
    expect(await repCtx(sami(), "yousef")).toBeNull();
    expect(await repCtx(sami(), "other-rep")).toBeNull();
    expect(await repCtx(sami(), seed.adminId)).toBeNull();
    expect(await repCtx(sami(), "nobody")).toBeNull();
  });

  it("lets an admin reach any rep or supervisor of his company, and no one else", async () => {
    expect(await repCtx(admin(), "omar")).toMatchObject({ userId: "omar", role: "rep", companyId: "demo-co" });
    expect(await repCtx(admin(), "ahmed")).not.toBeNull();
    expect(await repCtx(admin(), "sami")).toMatchObject({ userId: "sami", role: "rep" });
    expect(await repCtx(admin(), "other-rep")).toBeNull();
    expect(await repCtx(admin(), seed.adminId)).toBeNull();
    expect(await repCtx(admin(), seed.ownerId)).toBeNull();
    expect(await repCtx(admin(), "nobody")).toBeNull();
    const other = await otherAdmin();
    expect(await repCtx(other, "ahmed")).toBeNull();
    expect(await repCtx(other, "other-rep")).not.toBeNull();
  });

  it("lets a rep reach only himself, and an owner nobody", async () => {
    expect(await repCtx(ahmed(), "ahmed")).toMatchObject({ userId: "ahmed", role: "rep" });
    expect(await repCtx(ahmed(), "khaled")).toBeNull();
    expect(await repCtx(ahmed(), "sami")).toBeNull();
    expect(await repCtx(ctxOf(seed.ownerId, "owner", "platform"), "ahmed")).toBeNull();
  });

  it("keeps the caller's language and time zone, and hands the rep loaders that rep's rows", async () => {
    const c = await repCtx({ ...admin(), locale: "en" }, "khaled");
    expect(c).toMatchObject({ locale: "en", timeZone: "Asia/Riyadh" });
    const view = await getMonthView(c!, { year: 2026, month: 11, today: "2026-11-14" });
    const bev = view.lines.find((l) => l.code === "bev")!;
    expect(bev.achieved).toBe(1320);
    const own = await getMonthView((await repCtx(admin(), "ahmed"))!, { year: 2026, month: 11, today: "2026-11-14" });
    expect(own.lines.find((l) => l.code === "bev")!.achieved).toBe(1140);
  });
});
