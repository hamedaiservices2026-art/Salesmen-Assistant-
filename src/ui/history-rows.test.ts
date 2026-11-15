import { describe, expect, it } from "vitest";
import { sellingDays } from "@/domain/calendar";
import { isCurrentMonth, mergeDayRows, parseYm } from "./history-rows";

const selling = sellingDays(2026, 11, [6, 0, 1, 2, 3, 4], []);
const closedDates = [
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-07",
  "2026-11-08",
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
];
const closes = (skip?: string) =>
  closedDates
    .filter((d) => d !== skip)
    .reverse()
    .map((date) => ({ date }));
const TODAY = "2026-11-14";

describe("mergeDayRows", () => {
  it("has no gaps when every selling day before today is closed", () => {
    const rows = mergeDayRows(closes(), selling, TODAY);
    expect(rows.filter((r) => r.kind === "gap")).toEqual([]);
    expect(rows).toHaveLength(11);
  });
  it("shows exactly one gap, interleaved by date, when 9 Nov has no close", () => {
    const rows = mergeDayRows(closes("2026-11-09"), selling, TODAY);
    expect(rows.filter((r) => r.kind === "gap")).toEqual([
      { kind: "gap", date: "2026-11-09" },
    ]);
    const dates = rows.map((r) => (r.kind === "day" ? r.day.date : r.date));
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates.indexOf("2026-11-09")).toBe(dates.indexOf("2026-11-10") + 1);
  });
  it("never lists a Friday, today without a close, or a future day as a gap", () => {
    const gaps = mergeDayRows([], selling, TODAY).flatMap((r) =>
      r.kind === "gap" ? [r.date] : [],
    );
    expect(gaps).not.toContain("2026-11-06");
    expect(gaps).not.toContain("2026-11-13");
    expect(gaps).not.toContain(TODAY);
    expect(gaps.every((d) => d < TODAY)).toBe(true);
    expect(gaps).toHaveLength(11);
  });
  it("lists today when it has a close", () => {
    expect(mergeDayRows([{ date: TODAY }], selling, TODAY)[0]).toEqual({
      kind: "day",
      day: { date: TODAY },
    });
  });
  it("lists no gaps for a past month with no selling-day rule hits beyond its end", () => {
    expect(mergeDayRows([], sellingDays(2026, 12, [6], []), TODAY)).toEqual([]);
  });
});

describe("parseYm", () => {
  it("accepts a current or past month", () => {
    expect(parseYm("2026-11", TODAY)).toEqual({ year: 2026, month: 11 });
    expect(parseYm("2025-01", TODAY)).toEqual({ year: 2025, month: 1 });
  });
  it("rejects malformed and future values", () => {
    for (const v of [
      "2026-13",
      "abc",
      "2026-1",
      "2026-00",
      "2026-12",
      "2027-01",
      "2026-11-01",
    ])
      expect(parseYm(v, TODAY)).toBeNull();
  });
});

describe("isCurrentMonth", () => {
  it("is true only for today's own month", () => {
    expect(isCurrentMonth({ year: 2026, month: 11 }, "2026-11-14")).toBe(true);
    expect(isCurrentMonth({ year: 2026, month: 10 }, "2026-11-14")).toBe(false);
    expect(isCurrentMonth({ year: 2025, month: 11 }, "2026-11-14")).toBe(false);
  });
});
