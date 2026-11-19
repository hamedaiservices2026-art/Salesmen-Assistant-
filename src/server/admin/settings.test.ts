import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { repCtx } from "./rep-ctx";
import { addHoliday, getCompanySettings, removeHoliday, updateCompanySettings, type SettingsInput } from "./settings";

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

const valid = (over: Partial<SettingsInput> = {}): SettingsInput => ({
  name: "Demo Distribution Co.",
  currency: "SAR",
  timeZone: "Asia/Riyadh",
  sellingWeekdays: [6, 0, 1, 2, 3, 4],
  weekStartsOn: 6,
  defaultLocale: "ar",
  behindPct: 10,
  ...over,
});

const ahmedView = async () =>
  getMonthView((await repCtx(admin(), "ahmed"))!, { year: 2026, month: 11, today: "2026-11-14" });

async function snapshot() {
  const companies = (await db.select().from(s.companies)).map((c) => ({ ...c, updatedAt: null }));
  const holidays = (await db.select().from(s.holidays)).map((h) => ({ ...h, updatedAt: null }));
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { companies: byId(companies), holidays: byId(holidays) };
}

describe("updateCompanySettings", () => {
  it("reads the settings and saves valid changes", async () => {
    const before = await getCompanySettings(admin());
    expect(before).toMatchObject({ currency: "SAR", timeZone: "Asia/Riyadh", behindPct: 10, holidays: [] });
    const r = await updateCompanySettings(
      admin(),
      valid({ name: "  New Name ", currency: "AED", timeZone: "asia/dubai", sellingWeekdays: [0, 1, 2], weekStartsOn: 0, defaultLocale: "en", behindPct: 15 }),
    );
    expect(r).toEqual({ ok: true });
    expect(await getCompanySettings(admin())).toMatchObject({
      name: "New Name",
      currency: "AED",
      timeZone: "Asia/Dubai",
      sellingWeekdays: [0, 1, 2],
      weekStartsOn: 0,
      defaultLocale: "en",
      behindPct: 15,
    });
  });

  it("refuses an unknown time zone, an offset, and an empty weekday list", async () => {
    expect(await updateCompanySettings(admin(), valid({ timeZone: "Mars/Base" }))).toEqual({ ok: false, errors: { timeZone: "invalid" } });
    expect(await updateCompanySettings(admin(), valid({ timeZone: "+03:00" }))).toEqual({ ok: false, errors: { timeZone: "invalid" } });
    expect(await updateCompanySettings(admin(), valid({ sellingWeekdays: [] }))).toEqual({ ok: false, errors: { sellingWeekdays: "invalid" } });
  });

  it("refuses duplicate or out-of-range weekdays, week start, threshold, currency, language and a blank name", async () => {
    const bad = async (over: Partial<SettingsInput>, field: string) =>
      expect(await updateCompanySettings(admin(), valid(over))).toEqual({ ok: false, errors: { [field]: field === "name" ? "required" : "invalid" } });
    await bad({ sellingWeekdays: [1, 1] }, "sellingWeekdays");
    await bad({ sellingWeekdays: [7] }, "sellingWeekdays");
    await bad({ sellingWeekdays: [-1] }, "sellingWeekdays");
    await bad({ weekStartsOn: 7 }, "weekStartsOn");
    await bad({ behindPct: 0 }, "behindPct");
    await bad({ behindPct: 51 }, "behindPct");
    await bad({ behindPct: 2.5 }, "behindPct");
    await bad({ currency: "XYZ" as never }, "currency");
    await bad({ defaultLocale: "fr" as never }, "defaultLocale");
    await bad({ name: "  " }, "name");
  });

  it("changes nothing when any field is refused", async () => {
    const before = await snapshot();
    await updateCompanySettings(admin(), valid({ name: "Changed", behindPct: 0 }));
    expect(await snapshot()).toEqual(before);
  });

  it("a threshold of 4 percent makes Ahmed's bev line behind", async () => {
    const bev = async () => (await ahmedView()).lines.find((l) => l.code === "bev")!.pace.status;
    expect(await bev()).toBe("slightly_behind");
    expect(await updateCompanySettings(admin(), valid({ behindPct: 4 }))).toEqual({ ok: true });
    expect(await bev()).toBe("behind");
  });

  it("only changes the caller's own company", async () => {
    const other = (await db.select().from(s.companies).where(eq(s.companies.id, "other-co")))[0]!;
    await updateCompanySettings(admin(), valid({ name: "Mine", behindPct: 20 }));
    const after = (await db.select().from(s.companies).where(eq(s.companies.id, "other-co")))[0]!;
    expect(after).toEqual(other);
  });

  it("refuses every role except admin", async () => {
    for (const role of ["rep", "supervisor", "owner"] as const) {
      await expect(getCompanySettings(ctxOf("x", role))).rejects.toBeInstanceOf(Forbidden);
      await expect(updateCompanySettings(ctxOf("x", role), valid())).rejects.toBeInstanceOf(Forbidden);
      await expect(addHoliday(ctxOf("x", role), { date: "2026-11-10" })).rejects.toBeInstanceOf(Forbidden);
      await expect(removeHoliday(ctxOf("x", role), "h")).rejects.toBeInstanceOf(Forbidden);
    }
  });
});

describe("holidays", () => {
  it("a holiday on 10 Nov takes one selling day out of Ahmed's month", async () => {
    const before = await ahmedView();
    expect(before.counts).toMatchObject({ total: 26, elapsed: 11 });
    const r = await addHoliday(admin(), { date: "2026-11-10", name: " National day " });
    expect(r.ok).toBe(true);
    const after = await ahmedView();
    expect(after.counts).toMatchObject({ total: 25, elapsed: 10 });
    const list = (await getCompanySettings(admin())).holidays;
    expect(list).toEqual([expect.objectContaining({ date: "2026-11-10", name: "National day" })]);
  });

  it("refuses the same date twice with `exists`", async () => {
    await addHoliday(admin(), { date: "2026-11-10" });
    expect(await addHoliday(admin(), { date: "2026-11-10" })).toEqual({ ok: false, error: "exists" });
    expect((await getCompanySettings(admin())).holidays).toHaveLength(1);
  });

  it("another company may have a holiday on the same date", async () => {
    await db.insert(s.holidays).values({ id: "oh", companyId: "other-co", date: "2026-11-10" });
    expect((await addHoliday(admin(), { date: "2026-11-10" })).ok).toBe(true);
  });

  it("refuses a date that is not a real calendar date", async () => {
    for (const date of ["2026-02-30", "10/11/2026", "", "2026-13-01"]) {
      expect(await addHoliday(admin(), { date })).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("removes a holiday and the day counts again", async () => {
    const r = await addHoliday(admin(), { date: "2026-11-10" });
    if (!r.ok) throw new Error("add failed");
    expect(await removeHoliday(admin(), r.id)).toEqual({ ok: true });
    expect((await ahmedView()).counts).toMatchObject({ total: 26, elapsed: 11 });
  });

  it("a holiday id of the other company is not_found and nothing changes in either company", async () => {
    await db.insert(s.holidays).values({ id: "oh", companyId: "other-co", date: "2026-11-10" });
    await addHoliday(admin(), { date: "2026-11-12" });
    const before = await snapshot();
    expect(await removeHoliday(admin(), "oh")).toEqual({ ok: false, error: "not_found" });
    expect(await removeHoliday(admin(), "missing")).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
  });
});

describe("B3: time zones beyond the supported list", () => {
  const stored = async () => (await db.select({ tz: s.companies.timeZone }).from(s.companies).where(eq(s.companies.id, "demo-co")))[0]!.tz;
  const canon = (z: string) => new Intl.DateTimeFormat("en", { timeZone: z }).resolvedOptions().timeZone;

  it("saves Asia/Kolkata and Etc/GMT+3, canonicalised by the runtime", async () => {
    for (const z of ["Asia/Kolkata", "Etc/GMT+3"]) {
      expect(await updateCompanySettings(admin(), valid({ timeZone: z }))).toEqual({ ok: true });
      expect(await stored()).toBe(canon(z));
    }
  });

  it("an unchanged stored zone is always accepted, even one the list does not know", async () => {
    await db.update(s.companies).set({ timeZone: "Asia/Calcutta" }).where(eq(s.companies.id, "demo-co"));
    expect(await updateCompanySettings(admin(), valid({ timeZone: "Asia/Calcutta", name: "Renamed" }))).toEqual({ ok: true });
    expect(await stored()).toBe("Asia/Calcutta");
  });

  it("an invalid name is still refused", async () => {
    expect(await updateCompanySettings(admin(), valid({ timeZone: "Asia/Nowhere" }))).toEqual({ ok: false, errors: { timeZone: "invalid" } });
  });
});
