import { describe, expect, it } from "vitest";
import type { ComponentResult } from "@/domain/commission";
import { explainResult } from "./commission-copy";

const t = (key: string, values?: Record<string, string | number>) => ({ key, values });
const stub = t as unknown as (key: string, values?: Record<string, string | number>) => string;
const names = { bev: "Beverages", g_coll: "Collection gate" };

function result(reason: ComponentResult["reason"], detail: ComponentResult["detail"]): ComponentResult {
  return { componentId: "c", label: "L", amount: 0, reason, detail };
}
const explain = (r: ComponentResult) => explainResult(r, stub, names) as unknown as { key: string; values: unknown };

describe("explainResult", () => {
  it("tier", () => {
    expect(explain(result("tier", { lineId: "bev", pct: 100, tierMinPct: 100, achieved: 3000 }))).toEqual({
      key: "reason.tier",
      values: { pct: 100, tierMinPct: 100 },
    });
  });
  it("below_first_tier", () => {
    expect(explain(result("below_first_tier", { lineId: "bev", pct: 40, tierMinPct: 80, needed: 2400 }))).toEqual({
      key: "reason.below_first_tier",
      values: { pct: 40, tierMinPct: 80 },
    });
  });
  it("rate", () => {
    expect(explain(result("rate", { lineId: "bev", achieved: 500 }))).toEqual({
      key: "reason.rate",
      values: { achieved: 500, line: "Beverages" },
    });
  });
  it("below_threshold", () => {
    expect(explain(result("below_threshold", { lineId: "bev", pct: 50, tierMinPct: 70 }))).toEqual({
      key: "reason.below_threshold",
      values: { pct: 50, tierMinPct: 70 },
    });
  });
  it("bonus_met", () => {
    expect(explain(result("bonus_met", { focusItemId: "mango", achieved: 210, needed: 200 }))).toEqual({
      key: "reason.bonus_met",
      values: { achieved: 210, needed: 200 },
    });
  });
  it("bonus_not_met", () => {
    expect(explain(result("bonus_not_met", { focusItemId: "mango", achieved: 120, needed: 200 }))).toEqual({
      key: "reason.bonus_not_met",
      values: { achieved: 120, needed: 200, gap: 80 },
    });
  });
  it("blocked_by_gate", () => {
    expect(explain(result("blocked_by_gate", { lineId: "bev", gateId: "g_coll" }))).toEqual({
      key: "reason.blocked_by_gate",
      values: { gate: "Collection gate" },
    });
  });
  it("no_target", () => {
    expect(explain(result("no_target", { lineId: "bev", achieved: 0 }))).toEqual({
      key: "reason.no_target",
      values: { line: "Beverages" },
    });
  });
  it("formats amounts with the supplied formatter", () => {
    const out = explainResult(
      result("bonus_not_met", { lineId: "bev", achieved: 1000, needed: 2500 }),
      stub,
      names,
      (n) => `#${n}`,
    ) as unknown as { values: unknown };
    expect(out.values).toEqual({ achieved: "#1000", needed: "#2500", gap: "#1500" });
  });
});

describe("explainResult missing names", () => {
  it("uses a translated neutral word, never the raw id", () => {
    const out = explainResult(result("no_target", { lineId: "zzz" }), stub, {}) as unknown as { values: { line: unknown } };
    expect(out.values.line).toEqual({ key: "unnamed", values: undefined });
    const gate = explainResult(result("blocked_by_gate", { gateId: "g_x" }), stub, {}) as unknown as { values: { gate: unknown } };
    expect(gate.values.gate).toEqual({ key: "unnamed", values: undefined });
  });
});
