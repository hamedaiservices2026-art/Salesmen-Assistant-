import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { projectInput } from "@/domain/commission";
import type { Ctx } from "@/server/ctx";
import { sellingDayNumber } from "@/domain/calendar";
import { getCommissionView } from "./commission";
import { getMonthView } from "./month-view";
import { getHistoryMonths } from "./history";

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

describe("M2: the day number agrees on the home and commission pages", () => {
  it("after closing today both show the same N, from the month view's days-before-today counts", async () => {
    const today = "2026-11-12";
    const opts = { year: 2026, month: 11, today };
    const open = await getMonthView(yousef(), opts);
    await closeOn(today, "confirmed", 100);
    const closed = await getMonthView(yousef(), opts);
    const commission = await getCommissionView(yousef(), opts);
    expect(sellingDayNumber(closed.counts)).toBe(sellingDayNumber(open.counts));
    // The commission view's own counts moved on, which is exactly why the page must not use them for N.
    expect(commission.counts.elapsed).toBe(closed.counts.elapsed + 1);
    expect(sellingDayNumber(commission.counts)).not.toBe(sellingDayNumber(closed.counts));
  });
  it("is capped at the total", () => {
    expect(sellingDayNumber({ total: 26, elapsed: 26 })).toBe(26);
  });
});

describe("R26: a figure too large to compute degrades instead of throwing", () => {
  const huge = async () => {
    // Stored directly (the entry points refuse this size): 1e9 per case on 1e11 cases overflows 2^53.
    await db.insert(s.schemes).values({
      id: "big", companyId: seed.companyId, name: "Big", year: 2026, month: 10, published: true, version: 1,
      components: [{ id: "u", type: "per_unit", label: "u", lineId: "bev", rate: { kind: "per_case", amount: 1_000_000_000 } }],
    });
    await db.insert(s.targets).values({ id: "t-big", companyId: seed.companyId, userId: "yousef", lineId: "bev", year: 2026, month: 10, amount: 10 });
    await closeOn("2026-10-05", "confirmed", 100_000_000_000);
  };

  it("getCommissionView returns tooLarge with empty evaluations", async () => {
    await huge();
    const v = await getCommissionView(yousef(), { year: 2026, month: 10, today: "2026-10-20" });
    expect(v.tooLarge).toBe(true);
    expect(v.projected).toEqual({ total: 0, results: [] });
    expect(v.nearest).toBeNull();
  });

  it("a normal month is not tooLarge", async () => {
    const v = await getCommissionView(yousef(), { year: 2026, month: 11, today: "2026-11-14" });
    expect(v.tooLarge).toBe(false);
  });

  it("getHistoryMonths marks the month and keeps the others", async () => {
    await huge();
    const months = await getHistoryMonths(yousef(), { today: "2026-11-14" });
    const oct = months.find((m) => m.month === 10)!;
    expect(oct).toMatchObject({ commission: null, tooLarge: true });
  });
});
