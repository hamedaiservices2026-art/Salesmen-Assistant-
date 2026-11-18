import { describe, expect, it } from "vitest";
import { sampleScheme } from "@/domain/commission/sample-fixture";
import {
  addLeaf,
  fromComponents,
  issueFieldKey,
  newCard,
  setLeafFocus,
  toComponents,
  type FormRefs,
} from "./scheme-form";

const refs: FormRefs = {
  lines: [
    { id: "bev", unit: "cases", kind: "sales" },
    { id: "food", unit: "value", kind: "sales" },
    { id: "coll", unit: "value", kind: "collection" },
    { id: "cov", unit: "outlets", kind: "coverage" },
  ],
  focus: [
    { id: "cola", startsOn: "2026-11-01", endsOn: "2026-11-30", unit: "cases" },
    { id: "mango", startsOn: "2026-11-01", endsOn: "2026-11-20", unit: "cases" },
  ],
  period: { start: "2026-11-01", end: "2026-11-30" },
};
const period = refs.period;

describe("scheme form", () => {
  it("round-trips the sample scheme", () => {
    const cards = fromComponents(sampleScheme.components, refs);
    const out = toComponents(cards);
    expect(out.fieldErrors).toEqual({});
    expect(out.components).toEqual(sampleScheme.components);
  });

  it("round-trips optional labels, abovePct, combined bonus and tier percent pay", () => {
    const components = [
      { id: "a", type: "per_unit" as const, label: "ا", labelEn: "A", labelUr: "ا", lineId: "bev", rate: { kind: "per_case" as const, amount: 150 }, abovePct: 100 },
      {
        id: "b",
        type: "bonus" as const,
        label: "ب",
        condition: {
          kind: "all" as const,
          conditions: [
            { kind: "line_pct_at_least" as const, lineId: "bev", minPct: 100 },
            { kind: "focus_at_least" as const, focusItemId: "mango", min: 200 },
          ],
        },
        amount: 12_550,
        startsOn: "2026-11-01",
        endsOn: "2026-11-20",
      },
      { id: "c", type: "tiered" as const, label: "ج", lineId: "food", tiers: [{ minPct: 100, pay: { kind: "pct_of_achieved" as const, bps: 125 } }] },
    ];
    const out = toComponents(fromComponents(components, refs));
    expect(out.fieldErrors).toEqual({});
    expect(out.components).toEqual(components);
  });

  it("parses typed money in the company currency, also Arabic-Indic digits", () => {
    const card = newCard("tiers", refs, period);
    card.label.ar = "شرائح";
    card.tiers = [{ minPct: "80", payKind: "fixed", pay: "300" }];
    expect(toComponents([card]).components[0]).toMatchObject({ tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 30000 } }] });
    card.tiers = [{ minPct: "٨٠", payKind: "fixed", pay: "٣٠٠" }];
    expect(toComponents([card]).components[0]).toMatchObject({ tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 30000 } }] });
  });

  it("parses a percent of sales with two decimals into basis points", () => {
    const card = newCard("rate", { ...refs, lines: [refs.lines[1]!] }, period);
    card.label.ar = "نسبة";
    card.rateValue = "0.5";
    expect(toComponents([card]).components[0]).toMatchObject({ rate: { kind: "pct_of_value", bps: 50 } });
    card.rateValue = "٠٫٥";
    expect(toComponents([card]).components[0]).toMatchObject({ rate: { kind: "pct_of_value", bps: 50 } });
    card.rateValue = "0.555";
    expect(toComponents([card]).fieldErrors[`${card.id}.rate`]).toBe("invalid");
  });

  it("reports an empty tier amount as required and a bad one as invalid", () => {
    const card = newCard("tiers", refs, period);
    card.label.ar = "شرائح";
    card.tiers = [{ minPct: "90", payKind: "fixed", pay: "" }, { minPct: "9x", payKind: "fixed", pay: "5" }];
    const { fieldErrors } = toComponents([card]);
    expect(fieldErrors[`${card.id}.tiers.0.pay`]).toBe("required");
    expect(fieldErrors[`${card.id}.tiers.1.minPct`]).toBe("invalid");
  });

  it("requires the Arabic label", () => {
    const card = newCard("rate", refs, period);
    expect(toComponents([card]).fieldErrors[`${card.id}.label`]).toBe("required");
  });

  it("builds the presets", () => {
    const cov = newCard("coverage", refs, period);
    expect(cov).toMatchObject({ type: "tiered", lineId: "cov", tiers: [{ minPct: "85", pay: "" }] });

    const extra = newCard("extra100", refs, period);
    expect(extra).toMatchObject({ type: "bonus", startsOn: period.start, endsOn: period.end });
    expect(extra.leaves).toHaveLength(1);
    expect(extra.leaves[0]).toMatchObject({ kind: "line", minPct: "100" });

    const combined = newCard("combined", refs, period);
    expect(combined).toMatchObject({ type: "bonus", startsOn: period.start, endsOn: period.end });
    expect(combined.leaves).toHaveLength(2);
    combined.label.ar = "مركّب";
    combined.amount = "50";
    combined.leaves[0] = { ...combined.leaves[0]!, lineId: "bev", minPct: "100" };
    combined.leaves[1] = { ...combined.leaves[1]!, lineId: "food", minPct: "90" };
    const out = toComponents([combined]);
    expect(out.fieldErrors).toEqual({});
    expect(out.components[0]).toMatchObject({
      type: "bonus",
      amount: 5000,
      startsOn: period.start,
      endsOn: period.end,
      condition: { kind: "all", conditions: [{ kind: "line_pct_at_least" }, { kind: "line_pct_at_least" }] },
    });
  });

  it("volume takes the focus item's window and follows a changed item", () => {
    const vol = newCard("volume", refs, period);
    expect(vol.leaves[0]).toMatchObject({ kind: "focus", focusItemId: "cola" });
    expect([vol.startsOn, vol.endsOn]).toEqual(["2026-11-01", "2026-11-30"]);
    const picked = setLeafFocus(vol, 0, "mango", refs);
    expect([picked.startsOn, picked.endsOn]).toEqual(["2026-11-01", "2026-11-20"]);
    expect(picked.leaves[0]).toMatchObject({ focusItemId: "mango" });
  });

  it("a card with a mix keeps its window from the focus item, and a line-only card returns to the month", () => {
    const combined = addLeaf(newCard("combined", refs, period), "focus", refs);
    const withFocus = setLeafFocus(combined, 2, "mango", refs);
    expect(withFocus.endsOn).toBe("2026-11-20");
  });

  it("maps server issue paths to field keys", () => {
    const cards = fromComponents(sampleScheme.components, refs);
    const id = cards[0]!.id;
    expect(issueFieldKey(cards, { path: "components.0.tiers.1.pay.amount", code: "bad_amount" })).toBe(`${id}.tiers.1.pay`);
    expect(issueFieldKey(cards, { path: "components.0.lineId", code: "unknown_line" })).toBe(`${id}.lineId`);
    expect(issueFieldKey(cards, { path: "components.3.condition.min", code: "bad_amount" })).toBe(`${cards[3]!.id}.leaves.0.min`);
    expect(issueFieldKey(cards, { path: "period", code: "shape" })).toBeNull();
  });
});
