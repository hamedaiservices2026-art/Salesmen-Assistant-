import { describe, expect, it } from "vitest";
import { evaluateScheme, projectInput, whatIf } from "@/domain/commission";
import { sampleInput, sampleScheme } from "@/domain/commission/sample-fixture";
import { formatPercent } from "@/domain/money";
import { whatIfAt } from "./what-if-state";

const counts = { total: 26, elapsed: 11, left: 15 };
const input = sampleInput();
const projected = projectInput(input, counts);
const engineTotal = evaluateScheme(sampleScheme, projected).total;
const lines = [
  { lineId: "bev", unit: "cases" as const },
  { lineId: "food", unit: "value" as const },
  { lineId: "coll", unit: "value" as const },
];
const at = (line: (typeof lines)[number], steps: number, i = input, c = counts) => whatIfAt(sampleScheme, i, c, line, steps);
const pct = (r: ReturnType<typeof whatIfAt>) => formatPercent(r.endAchieved, r.target);

describe("whatIfAt", () => {
  it("starts exactly at the engine's projection for every seeded line", () => {
    expect(engineTotal).toBe(347_855);
    for (const l of lines) {
      const r = at(l, 0);
      const m = projected.lines[l.lineId]!;
      expect(r.total).toBe(engineTotal);
      expect(pct(r)).toBe(formatPercent(m.achieved, m.target));
    }
    expect(pct(at(lines[0]!, 0))).toBe("89%");
  });

  it("shows an integer per-day start that reaches the projection", () => {
    const r = at(lines[0]!, 0);
    expect(r.rate).toBe(104); // ceil((2695 - 1140) / 15)
    expect(r.step).toBe(5);
    expect(at(lines[1]!, 0).step).toBe(50_000);
  });

  it("returns to the baseline after + then -", () => {
    for (const l of lines) {
      const up = at(l, 1);
      expect(up.rate).toBe(at(l, 0).rate + up.step);
      const back = at(l, 1 + -1);
      expect(back).toEqual(at(l, 0));
      expect(back.total).toBe(engineTotal);
    }
  });

  it("reads 100% for bev at 124 per day with the engine's total for that input", () => {
    const r = at(lines[0]!, 4);
    expect(r.rate).toBe(124);
    expect(pct(r)).toBe("100%");
    expect(r.total).toBe(evaluateScheme(sampleScheme, whatIf(input, counts, "bev", 124)).total);
    expect(r.total).toBeGreaterThan(engineTotal);
  });

  it("stops decreasing at zero and can climb back", () => {
    let n = 0;
    while (at(lines[0]!, n).canDecrease) n--;
    expect(at(lines[0]!, n).rate).toBe(0);
    expect(at(lines[0]!, n - 1)).toEqual(at(lines[0]!, n));
  });

  it("does not produce NaN for a line with no target or no elapsed days", () => {
    const noTarget = { ...input, lines: { ...input.lines, bev: { target: 0, achieved: 0 } } };
    const r = at(lines[0]!, 2, noTarget);
    expect(pct(r)).toBe("—");
    expect(Number.isFinite(r.total)).toBe(true);
    const day1 = at(lines[0]!, 1, input, { total: 26, elapsed: 0, left: 26 });
    expect(Number.isFinite(day1.total)).toBe(true);
    expect(day1.rate).toBeGreaterThanOrEqual(0);
    const last = at(lines[0]!, 0, input, { total: 26, elapsed: 26, left: 0 });
    expect(last.rate).toBe(0);
  });
});
