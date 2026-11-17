import { describe, expect, it } from "vitest";
import { evaluateScheme } from "./evaluate";
import { projectInput } from "./project";
import type { Component, ComponentResult, Condition, Scheme, SchemeInput } from "./types";

// Synthetic fixture shaped like the pilot company's rules (PRODUCT.md "Pilot commission rules").
// Targets and achievements are invented; the 25 000 extra at 100% is an example value, not a real amount.
function pilotInput(): SchemeInput {
  return {
    lines: {
      kinza: { target: 1000, achieved: 900 },
      food: { target: 10_000_000, achieved: 7_000_000 },
      can185: { target: 500, achieved: 500 },
      cov: { target: 120, achieved: 102, hold: true },
    },
    focus: { cocktail: { achieved: 300 } },
  };
}

function bonus(id: string, condition: Condition, amount: number): Component {
  return { id, type: "bonus", label: id, condition, amount, startsOn: "2026-11-01", endsOn: "2026-11-30" };
}

function only(component: Component, input: SchemeInput = pilotInput()): ComponentResult {
  const scheme: Scheme = { id: "pilot", name: "pilot", components: [component] };
  const r = evaluateScheme(scheme, input).results[0];
  if (!r) throw new Error("no result");
  return r;
}

const combined = bonus(
  "c_combined",
  {
    kind: "all",
    conditions: [
      { kind: "line_pct_at_least", lineId: "kinza", minPct: 90 },
      { kind: "line_pct_at_least", lineId: "food", minPct: 70 },
    ],
  },
  100_000,
);

describe("combined condition (all)", () => {
  it("pays when every leaf is met: kinza 90%, food 70%", () => {
    const r = only(combined);
    expect(r.reason).toBe("bonus_met");
    expect(r.amount).toBe(100_000);
    expect(r.detail.parts).toHaveLength(2);
    expect(r.detail.parts?.every((p) => p.met)).toBe(true);
  });
  it("kinza 899 (89%) fails and the parts say which leaf", () => {
    const input = pilotInput();
    input.lines.kinza!.achieved = 899;
    const r = only(combined, input);
    expect(r.reason).toBe("bonus_not_met");
    expect(r.amount).toBe(0);
    expect(r.detail.parts?.[0]).toMatchObject({ lineId: "kinza", met: false, needed: 900, achieved: 899, pct: 89, minPct: 90 });
    expect(r.detail.parts?.[1]).toMatchObject({ lineId: "food", met: true, needed: 7_000_000, pct: 70, minPct: 70 });
  });
});

describe("extra at 100%", () => {
  const extra = bonus("c_extra", { kind: "line_pct_at_least", lineId: "can185", minPct: 100 }, 25_000);
  it("can185 500 of 500 pays 25000", () => {
    expect(only(extra)).toMatchObject({ reason: "bonus_met", amount: 25_000 });
  });
  it("can185 499 pays 0", () => {
    const input = pilotInput();
    input.lines.can185!.achieved = 499;
    expect(only(extra, input)).toMatchObject({ reason: "bonus_not_met", amount: 0 });
  });
});

describe("coverage (held metric)", () => {
  const coverage: Component = {
    id: "c_cov",
    type: "tiered",
    label: "التغطية",
    lineId: "cov",
    tiers: [{ minPct: 85, pay: { kind: "fixed", amount: 100_000 } }],
  };
  it("102 of 120 (85%) pays 100000", () => {
    expect(only(coverage)).toMatchObject({ reason: "tier", amount: 100_000 });
  });
  it("101 of 120 (84%) is below the first tier, needs 102, gap 1", () => {
    const input = pilotInput();
    input.lines.cov!.achieved = 101;
    const r = only(coverage, input);
    expect(r.reason).toBe("below_first_tier");
    expect(r.amount).toBe(0);
    expect(r.detail.pct).toBe(84);
    expect(r.detail.needed).toBe(102);
    expect(r.detail.gap).toBe(1);
  });
  it("projectInput leaves a held metric at its achieved count", () => {
    const p = projectInput(pilotInput(), { total: 26, elapsed: 11 });
    expect(p.lines.cov).toEqual({ target: 120, achieved: 102, hold: true });
    expect(p.lines.kinza!.achieved).toBe(2127); // round(900 × 26 ÷ 11) = round(2127.27)
  });
});

describe("volume on a focus item", () => {
  const volume = bonus("c_vol", { kind: "focus_at_least", focusItemId: "cocktail", min: 300 }, 100_000);
  it("cocktail 300 of 300 is met", () => {
    expect(only(volume)).toMatchObject({ reason: "bonus_met", amount: 100_000 });
  });
  it("cocktail 299 is not met with gap 1", () => {
    const input = pilotInput();
    input.focus.cocktail!.achieved = 299;
    const r = only(volume, input);
    expect(r).toMatchObject({ reason: "bonus_not_met", amount: 0 });
    expect(r.detail.gap).toBe(1);
  });
});

describe("combined condition edges", () => {
  it("a leaf on a line with no target reports no_target naming that line", () => {
    const input = pilotInput();
    input.lines.food = { target: 0, achieved: 7_000_000 };
    const r = only(combined, input);
    expect(r).toMatchObject({ reason: "no_target", amount: 0 });
    expect(r.detail.lineId).toBe("food");
    expect(r.detail.parts?.[1]).toMatchObject({ lineId: "food", needed: null, met: false });
  });
  it("a gate with an all condition blocks until every leaf holds", () => {
    const gate: Component = {
      id: "g_all",
      type: "gate",
      label: "g",
      condition: (combined as Extract<Component, { type: "bonus" }>).condition,
      appliesTo: ["c_extra"],
    };
    const extra = bonus("c_extra", { kind: "line_pct_at_least", lineId: "can185", minPct: 100 }, 25_000);
    const scheme: Scheme = { id: "pilot", name: "pilot", components: [extra, gate] };
    expect(evaluateScheme(scheme, pilotInput()).total).toBe(25_000);
    const low = pilotInput();
    low.lines.kinza!.achieved = 899;
    expect(evaluateScheme(scheme, low).results[0]).toMatchObject({
      reason: "blocked_by_gate",
      amount: 0,
      detail: { gateId: "g_all" },
    });
  });
});
