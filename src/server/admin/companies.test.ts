import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden } from "@/server/auth/roles";
import { acceptAdminInvite, invitePath, peekAdminInvite } from "@/server/auth/invites";
import { signInWithPassword } from "@/server/auth/sessions";
import { createOwner } from "./bootstrap";
import { createCompany, listCompanies, type NewCompany } from "./companies";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ownerCtx = (): Ctx => ({ db, companyId: "platform", userId: seed.ownerId, role: "owner", locale: "ar", timeZone: "Asia/Riyadh" });
const adminCtx = (): Ctx => ({ db, companyId: seed.companyId, userId: seed.adminId, role: "admin", locale: "ar", timeZone: "Asia/Riyadh" });

const input = (over: Partial<NewCompany> = {}): NewCompany => ({
  name: "Pilot Test Co.",
  currency: "SAR",
  timeZone: "Asia/Riyadh",
  defaultLocale: "ar",
  adminName: "مدير",
  adminEmail: " Boss@Pilot.Test ",
  ...over,
});

describe("createCompany", () => {
  it("creates the company, its admin and an invite the admin can accept", async () => {
    const r = await createCompany(ownerCtx(), input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [company] = await db.select().from(s.companies).where(eq(s.companies.id, r.companyId));
    expect(company).toMatchObject({
      name: "Pilot Test Co.",
      currency: "SAR",
      timeZone: "Asia/Riyadh",
      defaultLocale: "ar",
      sellingWeekdays: [6, 0, 1, 2, 3, 4],
      weekStartsOn: 6,
    });
    const [admin] = await db.select().from(s.users).where(eq(s.users.login, "boss@pilot.test"));
    expect(admin).toMatchObject({ companyId: r.companyId, role: "admin", name: "مدير", locale: "ar", passwordHash: null });
    expect(await peekAdminInvite(db, r.adminInviteToken)).toEqual({ name: "مدير", login: "boss@pilot.test" });

    const accepted = await acceptAdminInvite(db, r.adminInviteToken, "a-long-password-1");
    expect(accepted.ok).toBe(true);
    expect((await signInWithPassword(db, "boss@pilot.test", "a-long-password-1")).ok).toBe(true);
  });

  it("refuses the same email again and creates nothing", async () => {
    await createCompany(ownerCtx(), input());
    const before = (await db.select().from(s.companies)).length;
    const r = await createCompany(ownerCtx(), input({ name: "Second Co.", adminEmail: "BOSS@pilot.test" }));
    expect(r).toEqual({ ok: false, errors: { adminEmail: "taken" } });
    expect((await db.select().from(s.companies)).length).toBe(before);
  });

  it("refuses an email that is already a rep's login", async () => {
    const r = await createCompany(ownerCtx(), input({ adminEmail: "ahmed" }));
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown time zone, and reports every bad field", async () => {
    expect(await createCompany(ownerCtx(), input({ timeZone: "Mars/Base" }))).toEqual({
      ok: false,
      errors: { timeZone: "invalid" },
    });
    const r = await createCompany(
      ownerCtx(),
      input({ name: "  ", adminName: "", adminEmail: "not-an-email", currency: "XXX" as never, defaultLocale: "fr" as never }),
    );
    expect(r).toEqual({
      ok: false,
      errors: { name: "required", adminName: "required", adminEmail: "invalid", currency: "invalid", defaultLocale: "invalid" },
    });
    expect((await db.select().from(s.companies)).length).toBe(3);
  });

  it("throws Forbidden for an admin, and writes nothing", async () => {
    await expect(createCompany(adminCtx(), input())).rejects.toBeInstanceOf(Forbidden);
    expect((await db.select().from(s.companies)).length).toBe(3);
  });
});

describe("listCompanies", () => {
  it("lists demo-co and other-co with counts, not the platform company", async () => {
    const list = await listCompanies(ownerCtx());
    expect(list.map((c) => c.id).sort()).toEqual(["demo-co", "other-co"]);
    expect(list.find((c) => c.id === "demo-co")).toMatchObject({ name: "Demo Distribution Co.", currency: "SAR", adminCount: 1, repCount: 1 });
    expect(list.find((c) => c.id === "other-co")).toMatchObject({ adminCount: 0, repCount: 1 });
  });

  it("includes a company created through createCompany", async () => {
    await createCompany(ownerCtx(), input());
    expect((await listCompanies(ownerCtx())).map((c) => c.name)).toContain("Pilot Test Co.");
  });

  it("throws Forbidden for an admin", async () => {
    await expect(listCompanies(adminCtx())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("invitePath", () => {
  it("uses the rep route for rep and supervisor, the admin route otherwise", () => {
    expect(invitePath("rep", "t")).toBe("/invite/t");
    expect(invitePath("supervisor", "t")).toBe("/invite/t");
    expect(invitePath("admin", "t")).toBe("/admin/invite/t");
    expect(invitePath("owner", "t")).toBe("/admin/invite/t");
  });
});

describe("createOwner", () => {
  it("creates the platform company and the owner, with an invite that works", async () => {
    const fresh = await createTestDb();
    const r = await createOwner(fresh, { email: " Me@Example.com ", name: "Me" });
    const [owner] = await fresh.select().from(s.users).where(eq(s.users.login, "me@example.com"));
    expect(owner).toMatchObject({ role: "owner", companyId: "platform", name: "Me", passwordHash: null });
    expect((await acceptAdminInvite(fresh, r.inviteToken, "a-long-password-1")).ok).toBe(true);
  });

  it("issues a fresh invite for an existing owner, without a second row", async () => {
    const first = await createOwner(db, { email: "owner@platform.test", name: "Platform Owner" });
    const second = await createOwner(db, { email: "OWNER@platform.test", name: "Platform Owner" });
    expect(second.inviteToken).not.toBe(first.inviteToken);
    expect((await db.select().from(s.users).where(eq(s.users.role, "owner"))).length).toBe(1);
    expect(await peekAdminInvite(db, second.inviteToken)).toMatchObject({ login: "owner@platform.test" });
  });

  it("refuses an email that belongs to a user who is not an owner", async () => {
    await expect(createOwner(db, { email: "admin@demo.test", name: "x" })).rejects.toThrow();
  });
});
