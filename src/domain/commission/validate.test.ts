import { describe, expect, it } from "vitest";
import { sampleScheme } from "./sample-fixture";
import { referencedLineIds, validateComponents, type SchemeIssueCode, type SchemeRefs } from "./validate";

/** The demo company's November 2026: lines bev, food, coll; focus items cola (1–30 Nov) and mango (1–20 Nov). */
const refs: SchemeRefs = {
  lines: [
    { id: "bev", unit: "cases", kind: "sales" },
    { id: "food", unit: "value", kind: "sales" },
    { id: "coll", unit: "value", kind: "collection" },
    { id: "cov", unit: "outlets", kind: "coverage" },
  ],
  focus: [
    { id: "cola", startsOn: "2026-11-01", endsOn: "2026-11-30" },
    { id: "mango", startsOn: "2026-11-01", endsOn: "2026-11-20" },
    // A synthetic item running past the month on both sides, to isolate the period check.
    { id: "wide", startsOn: "2026-10-01", endsOn: "2026-12-31" },
  ],
  period: { start: "2026-11-01", end: "2026-11-30" },
};

const tiered = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "tiered",
  label: "شرائح",
  lineId: "bev",
  tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 1000 } }],
  ...over,
});
const perUnit = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "per_unit",
  label: "قيمة",
  lineId: "food",
  rate: { kind: "pct_of_value", bps: 50 },
  ...over,
});
const bonus = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "bonus",
  label: "حافز",
  condition: { kind: "focus_at_least", focusItemId: "cola", min: 100 },
  amount: 1000,
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
  ...over,
});
const gate = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  type: "gate",
  label: "شرط",
  condition: { kind: "line_pct_at_least", lineId: "coll", minPct: 60 },
  appliesTo: ["c1"],
  ...over,
});

function issuesOf(raw: unknown) {
  const r = validateComponents(raw, refs);
  return r.ok ? [] : r.issues;
}

/** The components produce exactly this one issue. */
function expectOnly(raw: unknown, code: SchemeIssueCode, path: string) {
  expect(issuesOf(raw)).toEqual([{ path, code }]);
}

describe("validateComponents", () => {
  it("accepts the sample scheme with the demo refs and returns its components", () => {
    const r = validateComponents(sampleScheme.components, refs);
    expect(r).toEqual({ ok: true, components: sampleScheme.components });
  });

  it("accepts an empty list (a month with no commission yet)", () => {
    expect(validateComponents([], refs)).toEqual({ ok: true, components: [] });
  });

  it("drops unknown keys", () => {
    const r = validateComponents([{ ...tiered(), extra: "x" }], refs);
    expect(r.ok && r.components[0]).toEqual(tiered());
  });

  it("shape: not an array, an unknown type, a missing field, a wrong type", () => {
    expect(issuesOf({})).toEqual([{ path: "components", code: "shape" }]);
    expect(issuesOf([{ id: "x", type: "nope", label: "x" }])[0]!.code).toBe("shape");
    expect(issuesOf([tiered({ lineId: undefined })])).toEqual([{ path: "components.0.lineId", code: "shape" }]);
    expect(issuesOf([tiered({ tiers: [{ minPct: "90", pay: { kind: "fixed", amount: 1 } }] })])).toEqual([
      { path: "components.0.tiers.0.minPct", code: "shape" },
    ]);
    expect(issuesOf([bonus({ condition: { kind: "all", conditions: [{ kind: "all", conditions: [] }] } })])[0]!.code).toBe(
      "shape",
    );
  });

  it("shape: dates must be real zero-padded YYYY-MM-DD dates (the engine compares them as text)", () => {
    for (const bad of ["2026-11-1", "2026-1-01", "26-11-01", "2026/11/01", "2026-11-31", "2026-02-29", " 2026-11-01", "2026-11-01T00:00"]) {
      expect(issuesOf([bonus({ startsOn: bad })])).toEqual([{ path: "components.0.startsOn", code: "shape" }]);
    }
    expect(issuesOf([bonus({ endsOn: 20261130 })])).toEqual([{ path: "components.0.endsOn", code: "shape" }]);
  });

  it("duplicate_id", () => {
    expectOnly([tiered(), perUnit()], "duplicate_id", "components.1.id");
  });

  it("label_missing: a blank Arabic label", () => {
    expectOnly([tiered({ label: "   " })], "label_missing", "components.0.label");
  });

  it("unknown_line: line zzz", () => {
    expectOnly([tiered({ lineId: "zzz" })], "unknown_line", "components.0.lineId");
    expectOnly([tiered(), gate({ condition: { kind: "line_pct_at_least", lineId: "zzz", minPct: 60 } })], "unknown_line", "components.1.condition.lineId");
  });

  it("unknown_focus", () => {
    expectOnly([bonus({ condition: { kind: "focus_at_least", focusItemId: "zzz", min: 10 } })], "unknown_focus", "components.0.condition.focusItemId");
  });

  it("empty_tiers", () => {
    expectOnly([tiered({ tiers: [] })], "empty_tiers", "components.0.tiers");
  });

  it("duplicate_tier: two tiers at 90", () => {
    expectOnly(
      [tiered({ tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 1 } }, { minPct: 90, pay: { kind: "fixed", amount: 2 } }] })],
      "duplicate_tier",
      "components.0.tiers.1.minPct",
    );
  });

  it("bad_pct: tier minPct outside 1–1000 or not whole; abovePct and condition minPct alike", () => {
    for (const minPct of [0, 1001, 89.5, -5]) {
      expectOnly([tiered({ tiers: [{ minPct, pay: { kind: "fixed", amount: 1 } }] })], "bad_pct", "components.0.tiers.0.minPct");
    }
    expectOnly([perUnit({ abovePct: 0 })], "bad_pct", "components.0.abovePct");
    expectOnly([gate({ condition: { kind: "line_pct_at_least", lineId: "coll", minPct: 1001 } }), tiered()], "bad_pct", "components.0.condition.minPct");
  });

  it("bad_amount: fixed amounts must be safe whole numbers ≥ 0", () => {
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectOnly([tiered({ tiers: [{ minPct: 90, pay: { kind: "fixed", amount } }] })], "bad_amount", "components.0.tiers.0.pay.amount");
      expectOnly([bonus({ amount })], "bad_amount", "components.0.amount");
    }
    expectOnly([perUnit({ lineId: "bev", rate: { kind: "per_case", amount: -2 } })], "bad_amount", "components.0.rate.amount");
    expectOnly([bonus({ condition: { kind: "focus_at_least", focusItemId: "cola", min: 0 } })], "bad_amount", "components.0.condition.min");
  });

  it("bad_bps: outside 0–10 000 or not whole", () => {
    expectOnly([perUnit({ rate: { kind: "pct_of_value", bps: 10_001 } })], "bad_bps", "components.0.rate.bps");
    expectOnly([perUnit({ rate: { kind: "pct_of_value", bps: 2.5 } })], "bad_bps", "components.0.rate.bps");
    expectOnly([tiered({ tiers: [{ minPct: 90, pay: { kind: "pct_of_achieved", bps: -1 } }] })], "bad_bps", "components.0.tiers.0.pay.bps");
  });

  it("per_case_needs_cases: per_case on food (a value line); cases and outlets lines are fine", () => {
    expectOnly([perUnit({ rate: { kind: "per_case", amount: 100 } })], "per_case_needs_cases", "components.0.rate");
    expect(issuesOf([perUnit({ lineId: "bev", rate: { kind: "per_case", amount: 100 } })])).toEqual([]);
    expect(issuesOf([perUnit({ lineId: "cov", rate: { kind: "per_case", amount: 100 } })])).toEqual([]);
  });

  it("window_order: starts after it ends", () => {
    expectOnly([bonus({ startsOn: "2026-11-20", endsOn: "2026-11-10" })], "window_order", "components.0.endsOn");
  });

  it("window_outside_period", () => {
    expectOnly([bonus({ condition: { kind: "focus_at_least", focusItemId: "wide", min: 5 }, startsOn: "2026-10-31" })], "window_outside_period", "components.0.startsOn");
    expectOnly([bonus({ condition: { kind: "focus_at_least", focusItemId: "wide", min: 5 }, endsOn: "2026-12-01" })], "window_outside_period", "components.0.endsOn");
  });

  it("line_bonus_needs_full_period: a line_pct_at_least bonus from 15 Nov, alone or inside all", () => {
    const line = { kind: "line_pct_at_least", lineId: "bev", minPct: 90 };
    expectOnly([bonus({ condition: line, startsOn: "2026-11-15" })], "line_bonus_needs_full_period", "components.0.startsOn");
    expectOnly([bonus({ condition: line, endsOn: "2026-11-29" })], "line_bonus_needs_full_period", "components.0.endsOn");
    expectOnly(
      [bonus({ condition: { kind: "all", conditions: [{ kind: "focus_at_least", focusItemId: "cola", min: 5 }, line] }, startsOn: "2026-11-15" })],
      "line_bonus_needs_full_period",
      "components.0.startsOn",
    );
    expect(issuesOf([bonus({ condition: line })])).toEqual([]);
  });

  it("focus_window_mismatch: a mango bonus ending 25 Nov (mango ends 20 Nov)", () => {
    expectOnly(
      [bonus({ condition: { kind: "focus_at_least", focusItemId: "mango", min: 200 }, endsOn: "2026-11-25" })],
      "focus_window_mismatch",
      "components.0.endsOn",
    );
    expect(
      issuesOf([bonus({ condition: { kind: "focus_at_least", focusItemId: "mango", min: 200 }, endsOn: "2026-11-20" })]),
    ).toEqual([]);
  });

  it("empty_all: an all needs 2 to 4 conditions", () => {
    const leaf = { kind: "focus_at_least", focusItemId: "cola", min: 5 };
    expectOnly([bonus({ condition: { kind: "all", conditions: [leaf] } })], "empty_all", "components.0.condition.conditions");
    expectOnly([bonus({ condition: { kind: "all", conditions: [] } })], "empty_all", "components.0.condition.conditions");
    expectOnly([bonus({ condition: { kind: "all", conditions: [leaf, leaf, leaf, leaf, leaf] } })], "empty_all", "components.0.condition.conditions");
    expect(issuesOf([bonus({ condition: { kind: "all", conditions: [leaf, leaf, leaf, leaf] } })])).toEqual([]);
  });

  it("gate_unknown_target: a missing component or another gate", () => {
    expectOnly([tiered(), gate({ appliesTo: ["nope"] })], "gate_unknown_target", "components.1.appliesTo.0");
    expectOnly([tiered(), gate({ appliesTo: ["c1", "g2"] }), gate({ id: "g2" })], "gate_unknown_target", "components.1.appliesTo.1");
  });

  it("checks lines named by gates and inside all", () => {
    expectOnly(
      [tiered(), gate({ condition: { kind: "all", conditions: [{ kind: "line_pct_at_least", lineId: "coll", minPct: 50 }, { kind: "line_pct_at_least", lineId: "zzz", minPct: 50 }] } })],
      "unknown_line",
      "components.1.condition.conditions.1.lineId",
    );
  });

  it("reports several issues at once, in order", () => {
    const r = issuesOf([tiered({ lineId: "zzz", label: "" }), tiered({ tiers: [] })]);
    expect(r).toEqual([
      { path: "components.0.label", code: "label_missing" },
      { path: "components.0.lineId", code: "unknown_line" },
      { path: "components.1.id", code: "duplicate_id" },
      { path: "components.1.tiers", code: "empty_tiers" },
    ]);
  });
});

describe("referencedLineIds", () => {
  it("collects every line a component or condition names, sorted and unique, from any input", () => {
    expect(referencedLineIds(sampleScheme.components)).toEqual(["bev", "coll", "food"]);
    expect(
      referencedLineIds([
        bonus({ condition: { kind: "all", conditions: [{ kind: "line_pct_at_least", lineId: "z" }, { lineId: 5 }] } }),
        { lineId: "a" },
        null,
        "x",
      ]),
    ).toEqual(["a", "z"]);
    expect(referencedLineIds({ lineId: "a" })).toEqual([]);
    expect(referencedLineIds(null)).toEqual([]);
  });
});
