import { describe, expect, it } from "vitest";
import { computePace, markDay, nextDayRequired, todayNeed } from "./pace";

const counts = { total: 26, elapsed: 11, left: 15 };

describe("computePace", () => {
  it("bev is slightly behind", () => {
    expect(computePace({ target: 3000, achieved: 1140, ...counts })).toEqual({
      expected: 1269,
      gap: 129,
      remaining: 1860,
      requiredDaily: 124,
      status: "slightly_behind",
      pct: 38,
    });
  });
  it("food is ahead", () => {
    const r = computePace({ target: 18_000_000, achieved: 8_280_000, ...counts });
    expect(r.expected).toBe(7615385);
    expect(r.status).toBe("ahead");
    expect(r.pct).toBe(46);
  });
  it("coll is slightly behind", () => {
    const r = computePace({ target: 45_000_000, achieved: 18_900_000, ...counts });
    expect(r.expected).toBe(19038462);
    expect(r.gap).toBe(138462);
    expect(r.status).toBe("slightly_behind");
    expect(r.pct).toBe(42);
  });
  it("zero target has no NaN", () => {
    const r = computePace({ target: 0, achieved: 0, ...counts });
    expect(r.status).toBe("no_target");
    expect(r.pct).toBeNull();
    for (const v of Object.values(r)) {
      if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
    }
  });
  it("no elapsed days expects 0 and is ahead", () => {
    const r = computePace({ target: 3000, achieved: 0, total: 26, elapsed: 0, left: 26 });
    expect(r.expected).toBe(0);
    expect(r.status).toBe("ahead");
  });
  it("no days left gives null requiredDaily", () => {
    const r = computePace({ target: 3000, achieved: 1000, total: 26, elapsed: 26, left: 0 });
    expect(r.requiredDaily).toBeNull();
  });
  it("zero total gives expected 0", () => {
    expect(computePace({ target: 3000, achieved: 0, total: 0, elapsed: 0, left: 0 }).expected).toBe(0);
  });
  it("far behind", () => {
    const r = computePace({ target: 3000, achieved: 400, ...counts });
    expect(r.status).toBe("behind");
  });
  it("honours behindPct", () => {
    const r = computePace({ target: 3000, achieved: 1140, ...counts, behindPct: 1 });
    expect(r.status).toBe("behind");
  });
});

describe("markDay", () => {
  const base = { today: "2026-11-14", isSellingDay: true, target: 3000, total: 26 };
  it("marks days", () => {
    expect(markDay({ ...base, date: "2026-11-08", amount: 118 })).toBe("hit");
    expect(markDay({ ...base, date: "2026-11-08", amount: 110 })).toBe("below");
    expect(markDay({ ...base, date: "2026-11-09", amount: null })).toBe("missing");
    expect(markDay({ ...base, date: "2026-11-13", isSellingDay: false, amount: null })).toBe("off");
    expect(markDay({ ...base, date: "2026-11-14", amount: null })).toBe("today");
    expect(markDay({ ...base, date: "2026-11-14", amount: 130 })).toBe("hit");
    expect(markDay({ ...base, date: "2026-11-15", amount: null })).toBe("future");
  });
  it("a closed day on a line with no target is recorded, never hit or below", () => {
    expect(markDay({ ...base, target: 0, date: "2026-11-08", amount: 5 })).toBe("recorded");
    expect(markDay({ ...base, target: -1, date: "2026-11-08", amount: 0 })).toBe("recorded");
    expect(markDay({ ...base, target: 0, date: "2026-11-09", amount: null })).toBe("missing");
    expect(markDay({ ...base, target: 0, date: "2026-11-15", amount: null })).toBe("future");
  });
});

describe("nextDayRequired", () => {
  const selling = ["2026-11-12", "2026-11-14", "2026-11-15", "2026-11-16"];
  it("divides by selling days strictly after today, rounding up", () => {
    expect(nextDayRequired(1730, selling, "2026-11-12")).toBe(577);
    expect(nextDayRequired(10, selling, "2026-11-14")).toBe(5);
  });
  it("on a non-selling day counts every later selling day", () => {
    expect(nextDayRequired(300, selling, "2026-11-13")).toBe(100);
  });
  it("is null on the last selling day", () => {
    expect(nextDayRequired(100, selling, "2026-11-16")).toBeNull();
  });
});

describe("todayNeed", () => {
  const base = { isSellingDay: true, hasClosedToday: false, requiredDaily: 120, nextDayRequired: 130, noTarget: false };
  it("a selling day with an open close needs the daily amount", () => {
    expect(todayNeed(base)).toEqual({ kind: "need", amount: 120 });
  });
  it("a recorded day shows tomorrow's need", () => {
    expect(todayNeed({ ...base, hasClosedToday: true })).toEqual({ kind: "done", amount: 130 });
  });
  it("a day off is a day off with the next selling day's need, not a number to sell today", () => {
    expect(todayNeed({ ...base, isSellingDay: false, requiredDaily: 130 })).toEqual({ kind: "off", amount: 130 });
    expect(todayNeed({ ...base, isSellingDay: false, nextDayRequired: null, requiredDaily: null })).toEqual({
      kind: "off",
      amount: null,
    });
  });
  it("says nothing without a target or when nothing is left", () => {
    expect(todayNeed({ ...base, noTarget: true })).toEqual({ kind: "none", amount: null });
    expect(todayNeed({ ...base, requiredDaily: null })).toEqual({ kind: "none", amount: null });
  });
});
