import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { getClose, saveClose, type CloseForm } from "@/server/repos/closes";
import { saveLocale } from "@/app/app/settings/locale";
import { repCtx } from "./rep-ctx";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined }) }));

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role): Ctx => ({ db, companyId: "demo-co", userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const closeForm = (date: string): CloseForm => ({
  date,
  lines: { bev: 130 },
  focus: {},
  cashSales: 0,
  creditSales: 0,
  collections: 0,
  expenses: 0,
  loaded: 0,
  sold: 0,
  returned: 0,
  returns: [],
  note: "",
});
const closeCount = async () => (await db.select().from(s.dailyCloses)).length;

describe("a repCtx context is read-only (F2)", () => {
  it("is tagged with the caller's real role", async () => {
    expect((await repCtx(ctxOf(seed.adminId, "admin"), "ahmed"))!.actingFor).toBe("admin");
    expect((await repCtx(ctxOf("sami", "supervisor"), "ahmed"))!.actingFor).toBe("supervisor");
    expect((await repCtx(ctxOf("ahmed", "rep"), "ahmed"))!.actingFor).toBe("rep");
  });

  it("saveClose refuses it for an admin, a supervisor and the rep himself, and writes nothing", async () => {
    const before = await closeCount();
    for (const [who, role] of [[seed.adminId, "admin"], ["sami", "supervisor"], ["ahmed", "rep"]] as const) {
      const c = (await repCtx(ctxOf(who, role), "ahmed"))!;
      await expect(saveClose(c, closeForm("2026-11-14"), { today: "2026-11-14" })).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await closeCount()).toBe(before);
    expect(await getClose(ctxOf("ahmed", "rep"), "2026-11-14")).toBeNull();
  });

  it("saveLocale refuses it and changes nothing", async () => {
    const c = (await repCtx(ctxOf(seed.adminId, "admin"), "ahmed"))!;
    await expect(saveLocale(c, "en")).rejects.toBeInstanceOf(Forbidden);
    expect((await db.select().from(s.users).where(eq(s.users.id, "ahmed")))[0]!.locale).toBe("ar");
  });

  it("reads still work with the tagged context", async () => {
    const c = (await repCtx(ctxOf(seed.adminId, "admin"), "ahmed"))!;
    const view = await getMonthView(c, { year: 2026, month: 11, today: "2026-11-14" });
    expect(view.lines.find((l) => l.code === "bev")!.achieved).toBe(1140);
    expect(await getClose(c, "2026-11-12")).not.toBeNull();
  });

  it("a normal rep context still saves his close and his language", async () => {
    const own = ctxOf("ahmed", "rep");
    expect(await saveClose(own, closeForm("2026-11-14"), { today: "2026-11-14" })).toEqual({ ok: true });
    expect(await saveLocale(own, "en")).toEqual({ ok: true });
    expect((await db.select().from(s.users).where(eq(s.users.id, "ahmed")))[0]!.locale).toBe("en");
  });
});
