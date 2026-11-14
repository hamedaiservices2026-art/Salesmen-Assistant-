import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import { getMonthView, type LineView } from "@/server/repos/month-view";
import { calendarCells } from "./calendar-cells";

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
