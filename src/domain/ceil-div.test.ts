import { describe, expect, it } from "vitest";
import { ceilDiv } from "./pace";

describe("ceilDiv", () => {
  it("rounds up integer division", () => {
    expect(ceilDiv(0, 5)).toBe(0);
    expect(ceilDiv(10, 5)).toBe(2);
    expect(ceilDiv(11, 5)).toBe(3);
    expect(ceilDiv(1, 26)).toBe(1);
  });
  it("is exact on large safe integers where float division rounds", () => {
    expect(ceilDiv(Number.MAX_SAFE_INTEGER - 1, 3)).toBe(3002399751580330);
  });
  it("throws RangeError for non-integers, negatives and a non-positive denominator", () => {
    for (const [n, d] of [[1.5, 2], [1, 0.5], [-1, 2], [1, 0], [1, -3], [Number.NaN, 2], [2 ** 60, 2]] as const) {
      expect(() => ceilDiv(n, d)).toThrow(RangeError);
    }
  });
});
