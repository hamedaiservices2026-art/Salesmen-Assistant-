import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { projectInput } from "@/domain/commission";
import type { Ctx } from "@/server/ctx";
import { getCommissionView } from "./commission";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const yousef = (): Ctx => ({ db, companyId: seed.companyId, userId: "yousef", role: "rep", locale: "ar", timeZone: "Asia/Riyadh" });

async function closeOn(date: string, status: "draft" | "confirmed", bev: number) {
  const id = `c-${date}`;
  await db.insert(s.dailyCloses).values({ id, companyId: seed.companyId, userId: "yousef", date, status });
  await db.insert(s.closeLines).values({ id: `${id}-bev`, companyId: seed.companyId, closeId: id, lineId: "bev", amount: bev });
}

describe("R22: today counts as elapsed once it has a close", () => {
  it("without a close today is left; with a confirmed close it is elapsed", async () => {
    const today = "2026-11-14";
    const before = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(before.counts).toEqual({ total: 26, elapsed: 11, left: 15 });
    await closeOn(today, "confirmed", 100);
    const after = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(after.counts).toEqual({ total: 26, elapsed: 12, left: 14 });
  });

  it("a draft close counts too", async () => {
    const today = "2026-11-14";
    await closeOn(today, "draft", 100);
    const v = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(v.counts).toEqual({ total: 26, elapsed: 12, left: 14 });
  });

  it("a close on another day does not move today", async () => {
    await closeOn("2026-11-12", "confirmed", 100);
    const v = await getCommissionView(yousef(), { year: 2026, month: 11, today: "2026-11-14" });
    expect(v.counts.elapsed).toBe(11);
  });

  it("day 1 after the close projects from that single day, not from the target", async () => {
    const today = "2026-11-01";
    const before = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(before.counts.elapsed).toBe(0);
    await closeOn(today, "confirmed", 100);
    const after = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(after.counts).toEqual({ total: 26, elapsed: 1, left: 25 });
    expect(projectInput(after.input, after.counts).lines.bev!.achieved).toBe(2600);
  });

  it("25 selling days at 100 a day: day 10 stays 2,500 after the close, not 2,778", async () => {
    await db.insert(s.holidays).values({ id: "h1", companyId: seed.companyId, date: "2026-11-30", name: "x" });
    // Nov 6 and 13 are Fridays: nine selling days before the 11th.
    for (const d of [1, 2, 3, 4, 5, 7, 8, 9, 10]) await closeOn(`2026-11-${String(d).padStart(2, "0")}`, "confirmed", 100);
    const today = "2026-11-11";
    const before = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(before.counts).toEqual({ total: 25, elapsed: 9, left: 16 });
    expect(projectInput(before.input, before.counts).lines.bev!.achieved).toBe(2500);
    await closeOn(today, "confirmed", 100);
    const after = await getCommissionView(yousef(), { year: 2026, month: 11, today });
    expect(after.counts).toEqual({ total: 25, elapsed: 10, left: 15 });
    expect(projectInput(after.input, after.counts).lines.bev!.achieved).toBe(2500);
  });
});
