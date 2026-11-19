import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import { getMonthView, type LineView } from "@/server/repos/month-view";
import { calendarCells, calendarSummary } from "./calendar-cells";

let bev: LineView;

beforeAll(async () => {
  const db = await createTestDb();
  const seed = await seedDemo(db);
  const view = await getMonthView(
    { db, companyId: seed.companyId, userId: seed.repId, role: "rep", locale: "ar", timeZone: "Asia/Riyadh" },
    { year: 2026, month: 11, today: "2026-11-14" },
  );
  bev = view.lines.find((l) => l.lineId === "bev")!;
});

describe("calendarCells", () => {
  it("week starting Sunday: 30 cells, no leading nulls, 2nd is a hit with 118", () => {
    const cells = calendarCells(bev, 0);
    expect(cells).toHaveLength(30);
    expect(cells[0]).not.toBeNull();
    const second = cells[1]!;
    expect(second.day).toBe(2);
    expect(second.mark).toBe("hit");
    expect(second.amount).toBe(118);
  });
  it("week starting Saturday: one leading null, then day 1", () => {
    const cells = calendarCells(bev, 6);
    expect(cells[0]).toBeNull();
    expect(cells[1]!.day).toBe(1);
    expect(cells[1]!.date).toBe("2026-11-01");
  });
});

describe("calendarCells for a line with no target", () => {
  it("marks closed days recorded (not below) and keeps their amounts", async () => {
    const db = await createTestDb();
    const seed = await seedDemo(db);
    await db.delete(s.targets).where(and(eq(s.targets.userId, "ahmed"), eq(s.targets.lineId, "bev")));
    const view = await getMonthView(
      { db, companyId: seed.companyId, userId: seed.repId, role: "rep", locale: "ar", timeZone: "Asia/Riyadh" },
      { year: 2026, month: 11, today: "2026-11-14" },
    );
    const cells = calendarCells(view.lines.find((l) => l.lineId === "bev")!, 0);
    const second = cells[1]!;
    expect(second).toMatchObject({ day: 2, mark: "recorded", amount: 118 });
    expect(cells.some((c) => c?.mark === "below" || c?.mark === "hit")).toBe(false);
  });
});

describe("calendarSummary", () => {
  it("reports hit and below days for a line with a target", () => {
    const hit = bev.days.filter((d) => d.mark === "hit").length;
    const below = bev.days.filter((d) => d.mark === "below").length;
    expect(calendarSummary(bev)).toEqual({ key: "calendarSummary", values: { hit, below } });
  });
  it("a line without a target reports recorded days instead", () => {
    const line = {
      target: 0,
      days: [{ mark: "recorded" as const }, { mark: "recorded" as const }, { mark: "missing" as const }],
    };
    expect(calendarSummary(line)).toEqual({ key: "calendarSummaryRecorded", values: { recorded: 2 } });
  });
});
