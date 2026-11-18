import { describe, expect, it } from "vitest";
import type { Scheme } from "./commission";
import { coverageErrors, coverageNeed, coveragePct, coverageTiers, recentDays } from "./coverage";

describe("coverageNeed", () => {
  it("names the next tier above the current percent and the customers still needed", () => {
    expect(coverageNeed({ covered: 60, total: 120 }, [85])).toEqual({ nextPct: 85, more: 42 });
  });

  it("picks the smallest tier above the current percent, whatever the order", () => {
    expect(coverageNeed({ covered: 60, total: 120 }, [95, 85, 50, 70])).toEqual({ nextPct: 70, more: 24 });
  });

  it("is null when every tier is already reached or there are no tiers", () => {
    expect(coverageNeed({ covered: 102, total: 120 }, [85])).toBeNull();
    expect(coverageNeed({ covered: 60, total: 120 }, [])).toBeNull();
    expect(coverageNeed({ covered: 0, total: 0 }, [85])).toBeNull();
  });

  it("rounds the customers needed up", () => {
    // 85% of 101 is 85.85, so 86 customers are needed
    expect(coverageNeed({ covered: 80, total: 101 }, [85])).toEqual({ nextPct: 85, more: 6 });
  });
});

describe("coveragePct", () => {
  it("floors the percent and is null without a total", () => {
    expect(coveragePct({ covered: 50, total: 120 })).toBe(41);
    expect(coveragePct({ covered: 0, total: 0 })).toBeNull();
  });
});

describe("coverageTiers", () => {
  const scheme: Scheme = {
    id: "s",
    name: "s",
    components: [
      { id: "a", type: "tiered", lineId: "cov", label: "a", tiers: [{ minPct: 85, pay: { kind: "fixed", amount: 1 } }, { minPct: 70, pay: { kind: "fixed", amount: 1 } }] },
      { id: "b", type: "tiered", lineId: "bev", label: "b", tiers: [{ minPct: 50, pay: { kind: "fixed", amount: 1 } }] },
      { id: "c", type: "per_unit", lineId: "cov", label: "c", rate: { kind: "per_case", amount: 1 } },
    ],
  };
  it("lists the tier percents of the tiered components on that line only, ascending", () => {
    expect(coverageTiers(scheme, "cov")).toEqual([70, 85]);
    expect(coverageTiers(null, "cov")).toEqual([]);
  });
});

describe("coverageErrors", () => {
  const ok = { covered: 50, total: 120, asOf: "2026-11-10", today: "2026-11-14" };
  it("accepts a valid update, including covered equal to total and as-of today", () => {
    expect(coverageErrors(ok)).toEqual({});
    expect(coverageErrors({ ...ok, covered: 120 })).toEqual({});
    expect(coverageErrors({ ...ok, covered: 0, asOf: "2026-11-14" })).toEqual({});
  });
  it("refuses a total below 1, a covered above total, a negative or fractional count", () => {
    expect(coverageErrors({ ...ok, total: 0 })).toEqual({ total: "invalid" });
    expect(coverageErrors({ ...ok, covered: 130 })).toEqual({ covered: "covered_above_total" });
    expect(coverageErrors({ ...ok, covered: -1 })).toEqual({ covered: "invalid" });
    expect(coverageErrors({ ...ok, covered: 1.5 })).toEqual({ covered: "invalid" });
  });
  it("refuses a future date and a date that does not exist", () => {
    expect(coverageErrors({ ...ok, asOf: "2026-11-15" })).toEqual({ asOf: "future" });
    expect(coverageErrors({ ...ok, asOf: "2026-02-30" })).toEqual({ asOf: "invalid" });
    expect(coverageErrors({ ...ok, asOf: "nope" })).toEqual({ asOf: "invalid" });
  });
});

describe("recentDays", () => {
  it("lists today first, then the days before it", () => {
    expect(recentDays("2026-11-02", 4)).toEqual(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(recentDays("2026-01-01", 2)).toEqual(["2026-01-01", "2025-12-31"]);
  });
});
