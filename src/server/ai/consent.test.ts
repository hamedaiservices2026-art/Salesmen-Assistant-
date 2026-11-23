import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { repCtx } from "@/server/admin/rep-ctx";
import { aiAvailability } from "./availability";
import { readAiConfig } from "./config";
import { acceptAiNotice, acceptAiNoticeFromForm, aiNoticeAccepted, aiStatus, getCompanyAi, setCompanyAi, withdrawAiNotice } from "./consent";

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
const FAKE = readAiConfig({ AI_PROVIDER: "fake" });
const ahmed = () => ctxOf("ahmed", "rep");
const admin = () => ctxOf(seed.adminId, "admin");

describe("company switch", () => {
  it("an admin turning it off makes Ahmed's availability company_off", async () => {
    expect(await setCompanyAi(admin(), false)).toEqual({ ok: true });
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: false, reason: "company_off" });
    expect((await getCompanyAi(admin(), FAKE)).enabled).toBe(false);
    await setCompanyAi(admin(), true);
    expect((await getCompanyAi(admin(), FAKE)).enabled).toBe(true);
  });

  it("a rep, a supervisor and an owner are refused", async () => {
    await expect(setCompanyAi(ahmed(), false)).rejects.toBeInstanceOf(Forbidden);
    await expect(setCompanyAi(ctxOf("sami", "supervisor"), false)).rejects.toBeInstanceOf(Forbidden);
    await expect(getCompanyAi(ahmed())).rejects.toBeInstanceOf(Forbidden);
    await expect(setCompanyAi(ctxOf("x", "owner"), false)).rejects.toBeInstanceOf(Forbidden);
  });

  it("another company's admin does not change demo-co", async () => {
    const [otherAdmin] = await db
      .insert(s.users)
      .values({ id: "other-admin", companyId: "other-co", role: "admin", name: "Other Admin", login: "other-admin@test", locale: "ar" })
      .returning();
    await setCompanyAi(ctxOf(otherAdmin!.id, "admin", "other-co"), true);
    const [demo] = await db.select().from(s.companies).where(eq(s.companies.id, "demo-co"));
    const [other] = await db.select().from(s.companies).where(eq(s.companies.id, "other-co"));
    expect(demo!.aiEnabled).toBe(true);
    expect(other!.aiEnabled).toBe(true);
    await setCompanyAi(ctxOf(otherAdmin!.id, "admin", "other-co"), false);
    const [demo2] = await db.select().from(s.companies).where(eq(s.companies.id, "demo-co"));
    expect(demo2!.aiEnabled).toBe(true);
  });

  it("reports the deployment kill switch", async () => {
    expect((await getCompanyAi(admin(), FAKE)).envDisabled).toBe(false);
    expect((await getCompanyAi(admin(), readAiConfig({ AI_DISABLED: "1" }))).envDisabled).toBe(true);
  });
});

describe("rep notice", () => {
  it("accepting the current version makes the rep available; withdrawing takes it back", async () => {
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: false, reason: "no_notice" });
    const now = new Date("2026-11-14T07:00:00Z");
    expect(await acceptAiNotice(ahmed(), 1, now)).toEqual({ ok: true });
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: true });
    const [u] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(u!.aiNoticeVersion).toBe(1);
    expect(u!.aiNoticeAt).toEqual(now);
    expect(await withdrawAiNotice(ahmed())).toEqual({ ok: true });
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: false, reason: "no_notice" });
    const [u2] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(u2!.aiNoticeVersion).toBe(0);
  });

  it("a stale or future version is refused and records nothing", async () => {
    expect(await acceptAiNotice(ahmed(), 0)).toEqual({ ok: false, error: "stale_version" });
    expect(await acceptAiNotice(ahmed(), 2)).toEqual({ ok: false, error: "stale_version" });
    const [u] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(u!.aiNoticeVersion).toBe(0);
  });

  it("consent cannot be recorded for someone else: acting contexts, admins and owners are refused", async () => {
    const acting = await repCtx(admin(), "ahmed");
    expect(acting).not.toBeNull();
    await expect(acceptAiNotice(acting!, 1)).rejects.toBeInstanceOf(Forbidden);
    await expect(withdrawAiNotice(acting!)).rejects.toBeInstanceOf(Forbidden);
    await expect(acceptAiNotice(admin(), 1)).rejects.toBeInstanceOf(Forbidden);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(u!.aiNoticeVersion).toBe(0);
  });

  it("accepting touches only the signed-in rep", async () => {
    await acceptAiNotice(ahmed(), 1);
    const [k] = await db.select().from(s.users).where(eq(s.users.id, "khaled"));
    expect(k!.aiNoticeVersion).toBe(0);
  });
});

describe("supervisor and form wrapper", () => {
  it("a supervisor can accept for himself", async () => {
    const sami = ctxOf("sami", "supervisor");
    expect(await acceptAiNotice(sami, 1)).toEqual({ ok: true });
    expect(await aiNoticeAccepted(sami)).toBe(true);
  });

  it("a malformed or missing form version is stale and records nothing", async () => {
    for (const v of ["abc", "", "1.5", "-1", "99999", "1 ", null]) {
      const f = new FormData();
      if (v !== null) f.set("version", v);
      expect(await acceptAiNoticeFromForm(ahmed(), f)).toEqual({ ok: false, error: "stale_version" });
    }
    expect(await aiNoticeAccepted(ahmed())).toBe(false);
    const good = new FormData();
    good.set("version", "1");
    expect(await acceptAiNoticeFromForm(ahmed(), good)).toEqual({ ok: true });
    expect(await aiNoticeAccepted(ahmed())).toBe(true);
  });
});

describe("aiNoticeAccepted", () => {
  it("is false for a lower stored version than the current one", async () => {
    // With the current version at 1, 0 is the only lower value; a stored 0 with a timestamp still counts as not accepted.
    await db.update(s.users).set({ aiNoticeVersion: 0, aiNoticeAt: new Date() }).where(eq(s.users.id, "ahmed"));
    expect(await aiNoticeAccepted(ahmed())).toBe(false);
  });

  it("follows accept and withdraw", async () => {
    expect(await aiNoticeAccepted(ahmed())).toBe(false);
    await acceptAiNotice(ahmed(), 1);
    expect(await aiNoticeAccepted(ahmed())).toBe(true);
    await withdrawAiNotice(ahmed());
    expect(await aiNoticeAccepted(ahmed())).toBe(false);
  });
});

describe("aiStatus", () => {
  it("wraps availability for the kind", async () => {
    expect(await aiStatus(ahmed(), "chat", FAKE)).toEqual({ available: false, reason: "no_notice" });
    await acceptAiNotice(ahmed(), 1);
    expect(await aiStatus(ahmed(), "vision", FAKE)).toEqual({ available: true, reason: null });
    expect(await aiStatus(ahmed(), "chat", readAiConfig({ AI_DISABLED: "1" }))).toEqual({ available: false, reason: "disabled" });
  });
});
