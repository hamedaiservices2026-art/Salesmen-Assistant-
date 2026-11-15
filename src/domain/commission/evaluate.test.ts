import { describe, expect, it } from "vitest";
import { evaluateScheme } from "./evaluate";
import { sampleInput, sampleScheme } from "./sample-fixture";
import type { Component, Scheme } from "./types";

function result(scheme: Scheme, id: string, input = sampleInput()) {
  const r = evaluateScheme(scheme, input).results.find((x) => x.componentId === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}

describe("evaluateScheme on the sample actuals", () => {
  it("totals 41400", () => {
    expect(evaluateScheme(sampleScheme, sampleInput()).total).toBe(41400);
  });
  it("c_bev is blocked by the failing collection gate", () => {
    const r = result(sampleScheme, "c_bev");
    expect(r.amount).toBe(0);
    expect(r.reason).toBe("blocked_by_gate");
    expect(r.detail.gateId).toBe("g_coll");
  });
  it("c_food pays 50 bps of achieved value", () => {
    const r = result(sampleScheme, "c_food");
    expect(r.amount).toBe(41400);
    expect(r.reason).toBe("rate");
  });
  it("c_coll is below its first tier", () => {
    const r = result(sampleScheme, "c_coll");
    expect(r.amount).toBe(0);
    expect(r.reason).toBe("below_first_tier");
    expect(r.detail.pct).toBe(42);
  });
  it("c_mango is not met and says what is needed", () => {
    const r = result(sampleScheme, "c_mango");
    expect(r.amount).toBe(0);
    expect(r.reason).toBe("bonus_not_met");
    expect(r.detail.needed).toBe(200);
    expect(r.detail.achieved).toBe(120);
    expect(r.detail.focusItemId).toBe("mango");
  });
  it("keeps scheme order and leaves gates out of results", () => {
    const ids = evaluateScheme(sampleScheme, sampleInput()).results.map((r) => r.componentId);
    expect(ids).toEqual(["c_bev", "c_food", "c_coll", "c_mango"]);
  });
});

describe("evaluateScheme edges", () => {
  it("a component both gated and below its first tier reports blocked_by_gate", () => {
    // bev at 38% is below the 80% first tier and the gate also fails
    const r = result(sampleScheme, "c_bev");
    expect(r.reason).toBe("blocked_by_gate");
  });
  it("rounds an exact half up: 8 280 100 at 50 bps pays 41401", () => {
    const input = sampleInput();
    input.lines.food.achieved = 8_280_100; // 41 400.5
    expect(result(sampleScheme, "c_food", input).amount).toBe(41_401);
  });
  it("a passing gate leaves c_bev paid by tier", () => {
    const input = sampleInput();
    input.lines.coll.achieved = 27_000_000; // 60%
    input.lines.bev.achieved = 2700; // 90%
    const r = result(sampleScheme, "c_bev", input);
    expect(r.amount).toBe(250_000);
    expect(r.reason).toBe("tier");
    expect(r.detail.tierMinPct).toBe(90);
    expect(r.detail.pct).toBe(90);
  });
  it("a line with target 0 gives no_target and a finite total", () => {
    const input = sampleInput();
    input.lines.coll = { target: 0, achieved: 5000 };
    const ev = evaluateScheme(sampleScheme, input);
    const coll = ev.results.find((r) => r.componentId === "c_coll")!;
    expect(coll.amount).toBe(0);
    expect(coll.reason).toBe("no_target");
    expect(Number.isFinite(ev.total)).toBe(true);
    expect(ev.total).toBe(41400);
  });
  it("a scheme with no components gives zero", () => {
    expect(evaluateScheme({ id: "x", name: "x", components: [] }, sampleInput())).toEqual({ total: 0, results: [] });
  });
  it("tiers given out of order still pay the highest matching tier", () => {
    const bev = sampleScheme.components[0] as Extract<Component, { type: "tiered" }>;
    const scheme: Scheme = {
      id: "x",
      name: "x",
      components: [{ ...bev, tiers: [bev.tiers[2]!, bev.tiers[0]!, bev.tiers[1]!] }],
    };
    const input = sampleInput();
    input.lines.bev.achieved = 2850; // 95%
    const r = result(scheme, "c_bev", input);
    expect(r.amount).toBe(250_000);
    expect(r.detail.tierMinPct).toBe(90);
  });
  it("per_case pays achieved × amount and abovePct gates it", () => {
    const comp: Component = {
      id: "c_pc",
      type: "per_unit",
      label: "per case",
      lineId: "bev",
      rate: { kind: "per_case", amount: 25 },
      abovePct: 30,
    };
    const scheme: Scheme = { id: "x", name: "x", components: [comp] };
    expect(result(scheme, "c_pc")).toMatchObject({ amount: 1140 * 25, reason: "rate" });
    const low = sampleInput();
    low.lines.bev.achieved = 600; // 20%
    expect(result(scheme, "c_pc", low)).toMatchObject({ amount: 0, reason: "below_threshold" });
  });
  it("pct_of_achieved tier pay rounds half up", () => {
    const scheme: Scheme = {
      id: "x",
      name: "x",
      components: [
        { id: "c_t", type: "tiered", label: "t", lineId: "food", tiers: [{ minPct: 0, pay: { kind: "pct_of_achieved", bps: 50 } }] },
      ],
    };
    const input = sampleInput();
    input.lines.food.achieved = 19_570_909;
    expect(result(scheme, "c_t", input).amount).toBe(97855);
  });
  it("a bonus on a line percent pays when met", () => {
    const scheme: Scheme = {
      id: "x",
      name: "x",
      components: [
        {
          id: "c_b",
          type: "bonus",
          label: "b",
          condition: { kind: "line_pct_at_least", lineId: "food", minPct: 46 },
          amount: 10_000,
          startsOn: "2026-11-01",
          endsOn: "2026-11-30",
        },
      ],
    };
    expect(result(scheme, "c_b")).toMatchObject({ amount: 10_000, reason: "bonus_met" });
  });
});
