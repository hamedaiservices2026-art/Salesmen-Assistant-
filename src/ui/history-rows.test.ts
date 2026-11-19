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
    const rows = mergeDayRows(closes(), selling, TODAY, "2026-11-01");
    expect(rows.filter((r) => r.kind === "gap")).toEqual([]);
    expect(rows).toHaveLength(11);
  });
  it("shows exactly one gap, interleaved by date, when 9 Nov has no close", () => {
    const rows = mergeDayRows(closes("2026-11-09"), selling, TODAY, "2026-11-01");
    expect(rows.filter((r) => r.kind === "gap")).toEqual([
      { kind: "gap", date: "2026-11-09" },
    ]);
    const dates = rows.map((r) => (r.kind === "day" ? r.day.date : r.date));
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates.indexOf("2026-11-09")).toBe(dates.indexOf("2026-11-10") + 1);
  });
  it("never lists a Friday, today without a close, or a future day as a gap", () => {
    const gaps = mergeDayRows([], selling, TODAY, "2026-11-01").flatMap((r) =>
      r.kind === "gap" ? [r.date] : [],
    );
    expect(gaps).not.toContain("2026-11-06");
    expect(gaps).not.toContain("2026-11-13");
    expect(gaps).not.toContain(TODAY);
    expect(gaps.every((d) => d < TODAY)).toBe(true);
    expect(gaps).toHaveLength(11);
  });
  it("lists today when it has a close", () => {
    expect(mergeDayRows([{ date: TODAY }], selling, TODAY, "2026-11-01")[0]).toEqual({
      kind: "day",
      day: { date: TODAY },
    });
  });
  it("lists no gaps for a past month with no selling-day rule hits beyond its end", () => {
    expect(mergeDayRows([], sellingDays(2026, 12, [6], []), TODAY, "2026-11-01")).toEqual([]);
  });
});

describe("parseYm", () => {
  it("accepts a current or past month", () => {
    expect(parseYm("2026-11", TODAY)).toEqual({ year: 2026, month: 11 });
    expect(parseYm("2025-01", TODAY)).toEqual({ year: 2025, month: 1 });
  });
  it("reads a December month across the year boundary", () => {
    expect(parseYm("2025-12", "2026-01-15")).toEqual({ year: 2025, month: 12 });
    expect(parseYm("2026-02", "2026-01-15")).toBeNull();
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

describe("mergeDayRows first-close cutoff", () => {
  const gapDates = (rows: ReturnType<typeof mergeDayRows>) =>
    rows.flatMap((r) => (r.kind === "gap" ? [r.date.slice(8)] : [])).sort();

  it("leaves out gaps before the first close (only the 3rd and 10th closed)", () => {
    const rows = mergeDayRows([{ date: "2026-11-10" }, { date: "2026-11-03" }], selling, TODAY, "2026-11-03");
    expect(gapDates(rows)).toEqual(["04", "05", "07", "08", "09", "11", "12"]);
  });
  it("shows no gap rows at all when the rep has no close", () => {
    expect(mergeDayRows([], selling, TODAY, null)).toEqual([]);
  });
  it("still lists a day row dated before the cutoff", () => {
    const rows = mergeDayRows([{ date: "2026-11-02" }], selling, TODAY, "2026-11-03");
    expect(rows).toContainEqual({ kind: "day", day: { date: "2026-11-02" } });
    expect(gapDates(rows)).not.toContain("01");
  });
});
