import { describe, expect, it } from "vitest";
import { dayCounts, monthGrid, sellingDays, todayIn } from "./calendar";

const WEEKDAYS = [6, 0, 1, 2, 3, 4];

describe("sellingDays", () => {
  const days = sellingDays(2026, 11, WEEKDAYS, []);
  it("lists 26 selling days for Nov 2026", () => {
    expect(days).toHaveLength(26);
    expect(days[0]).toBe("2026-11-01");
    expect(days[days.length - 1]).toBe("2026-11-30");
    for (const d of ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]) {
      expect(days).not.toContain(d);
    }
  });
  it("removes holidays", () => {
    const h = sellingDays(2026, 11, WEEKDAYS, ["2026-11-10"]);
    expect(h).toHaveLength(25);
    expect(h).not.toContain("2026-11-10");
  });
});

describe("dayCounts", () => {
  const days = sellingDays(2026, 11, WEEKDAYS, []);
  it("counts elapsed and left", () => {
    expect(dayCounts(days, "2026-11-14")).toEqual({ total: 26, elapsed: 11, left: 15 });
    expect(dayCounts(days, "2026-11-01")).toEqual({ total: 26, elapsed: 0, left: 26 });
    expect(dayCounts(days, "2026-12-05")).toEqual({ total: 26, elapsed: 26, left: 0 });
    expect(dayCounts(days, "2026-11-13")).toEqual({ total: 26, elapsed: 11, left: 15 });
  });
});

describe("monthGrid", () => {
  it("has no leading nulls when week starts on the first weekday", () => {
    const g = monthGrid(2026, 11, 0);
    expect(g).toHaveLength(30);
    expect(g[0]).toBe("2026-11-01");
  });
  it("pads leading nulls for a Saturday start", () => {
    const g = monthGrid(2026, 11, 6);
    expect(g[0]).toBeNull();
    expect(g[1]).toBe("2026-11-01");
    expect(g).toHaveLength(31);
  });
});

describe("todayIn", () => {
  it("uses the given time zone", () => {
    expect(todayIn("Asia/Riyadh", new Date("2026-11-13T22:30:00Z"))).toBe("2026-11-14");
  });
});
