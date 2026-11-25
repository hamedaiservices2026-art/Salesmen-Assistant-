import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { Forbidden, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { reserveAi } from "@/server/ai/quota";
import { logUsage } from "@/server/ai/usage";
import { aiDay, getAiUsage } from "./ai-usage";

const NOW = new Date("2026-11-14T10:00:00Z");
const TODAY = "2026-11-14";
let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({ db, companyId, userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const admin = () => ctxOf(seed.adminId, "admin");
const GLOBAL = { day: 400, minute: null };
const base = { kind: "vision", feature: "close_photo", provider: "fake", model: null, attempts: 1, fallback: false, latencyMs: 5, usage: { tokensIn: null, tokensOut: null } } as const;

/** A fake photo call: reserve a slot, then log its outcome (what aiCall does). */
async function photo(ctx: Ctx, outcome: "ok" | "timeout", at: Date = NOW) {
  expect(await reserveAi(ctx, "vision", at, GLOBAL)).toBe("ok");
  await logUsage(ctx, { ...base, outcome });
  // logUsage stamps now(); move the newest row to the wanted instant.
}

describe("getAiUsage", () => {
  it("3 photo calls (one failing) → used 3 of 200 today, day row ok 2 failed 1, no user id", async () => {
    const ahmed = ctxOf("ahmed", "rep");
    await photo(ahmed, "ok");
    await photo(ahmed, "ok");
    await photo(ahmed, "timeout");
    await db.update(s.aiUsage).set({ createdAt: NOW });
    const r = await getAiUsage(admin(), { today: TODAY });
    expect(r.today).toContainEqual({ kind: "vision", used: 3, limit: 200 });
    expect(r.today).toContainEqual({ kind: "chat", used: 0, limit: 500 });
    expect(r.today).toContainEqual({ kind: "stt", used: 0, limit: 300 });
    expect(r.days).toContainEqual({ date: TODAY, kind: "vision", ok: 2, failed: 1 });
    expect(r.failures).toEqual([{ outcome: "timeout", count: 1 }]);
    expect(r.days).toHaveLength(14 * 3);
    const text = JSON.stringify(r);
    for (const id of ["ahmed", "khaled", seed.adminId, "أحمد"]) expect(text).not.toContain(id);
  });

  it("the day counters are the truth for used today, and company rejections are counted", async () => {
    await db.insert(s.aiCounters).values([
      { scope: "company:demo-co", bucket: TODAY, kind: "chat", companyId: "demo-co", count: 460 },
      { scope: "company:other-co", bucket: TODAY, kind: "chat", companyId: "other-co", count: 5 },
      { scope: "company:demo-co", bucket: "2026-11-13", kind: "chat", companyId: "demo-co", count: 77 },
    ]);
    await db.insert(s.aiUsage).values({
      id: "rej1", companyId: "demo-co", userId: "ahmed", kind: "chat", feature: "assistant", outcome: "rejected",
      attempts: 0, fallback: false, latencyMs: 0, createdAt: NOW,
    });
    const r = await getAiUsage(admin(), { today: TODAY });
    expect(r.today.find((t) => t.kind === "chat")).toEqual({ kind: "chat", used: 460, limit: 500 });
    expect(r.failures).toEqual([{ outcome: "rejected", count: 1 }]);
    expect(r.days.find((d) => d.date === TODAY && d.kind === "chat")).toEqual({ date: TODAY, kind: "chat", ok: 0, failed: 1 });
  });

  it("buckets days in the company time zone and honours the window", async () => {
    const mk = (id: string, at: string) =>
      db.insert(s.aiUsage).values({ id, companyId: "demo-co", userId: "ahmed", kind: "chat", feature: "assistant", outcome: "ok", attempts: 1, fallback: false, latencyMs: 1, createdAt: new Date(at) });
    await mk("a", "2026-11-13T21:30:00Z"); // 00:30 on the 14th in Riyadh
    await mk("b", "2026-10-30T10:00:00Z"); // outside 14 days (window starts 2026-11-01)
    const r = await getAiUsage(admin(), { today: TODAY });
    expect(r.days.find((d) => d.date === TODAY && d.kind === "chat")?.ok).toBe(1);
    expect(r.days.reduce((a, d) => a + d.ok, 0)).toBe(1);
    const short = await getAiUsage(admin(), { today: TODAY, days: 3 });
    expect(short.days).toHaveLength(9);
  });

  it("never counts another company's rows or counters", async () => {
    await db.insert(s.aiUsage).values({ id: "o1", companyId: "other-co", userId: seed.otherRepId, kind: "chat", feature: "assistant", outcome: "timeout", attempts: 1, fallback: false, latencyMs: 1, createdAt: NOW });
    await db.insert(s.aiCounters).values({ scope: "company:other-co", bucket: TODAY, kind: "chat", companyId: "other-co", count: 9 });
    const r = await getAiUsage(admin(), { today: TODAY });
    expect(r.failures).toEqual([]);
    expect(r.today.every((t) => t.used === 0)).toBe(true);
    expect(r.days.every((d) => d.ok === 0 && d.failed === 0)).toBe(true);
  });

  it("reports the switch and the kill switch", async () => {
    const r = await getAiUsage(admin(), { today: TODAY });
    expect(typeof r.enabled).toBe("boolean");
    expect(typeof r.envDisabled).toBe("boolean");
  });

  it("refuses every role but admin", async () => {
    for (const role of ["rep", "supervisor", "owner"] as const) {
      await expect(getAiUsage(ctxOf("ahmed", role), { today: TODAY })).rejects.toBeInstanceOf(Forbidden);
    }
  });
});

describe("aiDay", () => {
  it("is the real day in the company's time zone, never the demo date override (the counters use the real clock)", () => {
    const saved = process.env.APP_TODAY;
    process.env.APP_TODAY = "2026-11-14";
    try {
      // 22:30 UTC on 5 Dec is already 6 Dec in Riyadh (UTC+3).
      expect(aiDay("Asia/Riyadh", new Date("2026-12-05T22:30:00Z"))).toBe("2026-12-06");
      expect(aiDay("UTC", new Date("2026-12-05T22:30:00Z"))).toBe("2026-12-05");
    } finally {
      if (saved === undefined) delete process.env.APP_TODAY;
      else process.env.APP_TODAY = saved;
    }
  });
});
