import { describe, expect, it } from "vitest";
import { evaluateScheme } from "./evaluate";
import { inputAtFullTarget, nearestWin, projectInput, whatIf } from "./project";
import { sampleInput, sampleScheme } from "./sample-fixture";
import type { SchemeInput } from "./types";

function lineOf(input: SchemeInput, id: string) {
  const m = input.lines[id];
  if (!m) throw new Error(`no line ${id}`);
  return m;
}
function focusOf(input: SchemeInput, id: string) {
  const f = input.focus[id];
  if (!f) throw new Error(`no focus item ${id}`);
  return f;
}

const days = { total: 26, elapsed: 11 };

function amountOf(ev: ReturnType<typeof evaluateScheme>, id: string) {
  return ev.results.find((r) => r.componentId === id)?.amount;
}

describe("projectInput", () => {
  it("projects each line at the current pace", () => {
    const p = projectInput(sampleInput(), days);
    expect(lineOf(p, "bev").achieved).toBe(2695);
    expect(lineOf(p, "food").achieved).toBe(19_570_909);
    expect(lineOf(p, "coll").achieved).toBe(44_672_727);
    expect(lineOf(p, "bev").target).toBe(3000);
    expect(p.focus).toEqual(sampleInput().focus);
  });
  it("evaluating the projection gives 347855", () => {
    const ev = evaluateScheme(sampleScheme, projectInput(sampleInput(), days));
    const bev = ev.results.find((r) => r.componentId === "c_bev")!;
    expect(bev.amount).toBe(150_000);
    expect(bev.detail.pct).toBe(89);
    expect(bev.detail.tierMinPct).toBe(80);
    expect(amountOf(ev, "c_food")).toBe(97855);
    expect(amountOf(ev, "c_coll")).toBe(100_000);
    expect(ev.total).toBe(347_855);
  });
  it("with no elapsed days each line becomes its target", () => {
    const p = projectInput(sampleInput(), { total: 26, elapsed: 0 });
    expect(lineOf(p, "bev").achieved).toBe(3000);
    expect(lineOf(p, "food").achieved).toBe(18_000_000);
    expect(lineOf(p, "coll").achieved).toBe(45_000_000);
  });
  it("does not mutate its input", () => {
    const input = sampleInput();
    projectInput(input, days);
    expect(input).toEqual(sampleInput());
  });
});

describe("inputAtFullTarget", () => {
  it("pays 640000 at full target", () => {
    const full = inputAtFullTarget(sampleScheme, sampleInput());
    expect(focusOf(full, "mango").achieved).toBe(200);
    const ev = evaluateScheme(sampleScheme, full);
    expect(amountOf(ev, "c_bev")).toBe(400_000);
    expect(amountOf(ev, "c_food")).toBe(90_000);
    expect(amountOf(ev, "c_coll")).toBe(100_000);
    expect(amountOf(ev, "c_mango")).toBe(50_000);
    expect(ev.total).toBe(640_000);
  });
  it("keeps lines already above target", () => {
    const input = sampleInput();
    input.lines.bev.achieved = 3500;
    expect(lineOf(inputAtFullTarget(sampleScheme, input), "bev").achieved).toBe(3500);
  });
});

describe("whatIf", () => {
  it("bev at 124 a day reaches 3000 and pays the top tier", () => {
    const w = whatIf(sampleInput(), { ...days, left: 15 }, "bev", 124);
    expect(lineOf(w, "bev").achieved).toBe(3000);
    expect(lineOf(w, "food").achieved).toBe(19_570_909);
    expect(amountOf(evaluateScheme(sampleScheme, w), "c_bev")).toBe(400_000);
  });
});

describe("nearestWin", () => {
  it("on the actuals points to the mango bonus", () => {
    expect(nearestWin(sampleScheme, sampleInput())).toMatchObject({
      componentId: "c_mango",
      focusItemId: "mango",
      gap: 80,
      gain: 50_000,
    });
  });
  it("returns null when everything is met", () => {
    const full = inputAtFullTarget(sampleScheme, sampleInput());
    expect(nearestWin(sampleScheme, full)).toBeNull();
  });
  it("returns null for a scheme with no components", () => {
    expect(nearestWin({ id: "x", name: "x", components: [] }, sampleInput())).toBeNull();
  });
  it("offers the gate when lifting it unlocks pay", () => {
    const input = sampleInput();
    input.lines.bev.achieved = 2700; // 90%, blocked by gate
    input.focus.mango.achieved = 200; // bonus met
    expect(nearestWin(sampleScheme, input)).toMatchObject({
      componentId: "g_coll",
      lineId: "coll",
      gap: 27_000_000 - 18_900_000,
      gain: 250_000,
    });
  });
});
