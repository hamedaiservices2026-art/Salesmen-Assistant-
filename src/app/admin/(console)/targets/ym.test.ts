import { describe, expect, it } from "vitest";
import { inRange, parseYm, shiftMonth } from "./ym";

describe("ym", () => {
  it("accepts only the years applyTargets accepts", () => {
    expect(parseYm("2000-01")).toEqual({ year: 2000, month: 1 });
    expect(parseYm("2100-12")).toEqual({ year: 2100, month: 12 });
    expect(parseYm("1999-12")).toBeNull();
    expect(parseYm("2101-01")).toBeNull();
    expect(parseYm("2026-13")).toBeNull();
  });
  it("shifts across years and reports the edge", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(inRange(shiftMonth({ year: 2000, month: 1 }, -1))).toBe(false);
    expect(inRange(shiftMonth({ year: 2100, month: 12 }, 1))).toBe(false);
  });
});
