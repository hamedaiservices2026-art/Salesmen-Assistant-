import { describe, expect, it } from "vitest";
import { reviewState, type ReviewInput } from "./review";

const base = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  marks: { "line.bev": "ai", creditSales: "low", "line.food": "low" },
  filled: { "line.bev": "118", creditSales: "3200", "line.food": "7900" },
  current: { "line.bev": "118", creditSales: "3200", "line.food": "7900" },
  acknowledged: new Set<string>(),
  order: ["line.bev", "line.food", "cashSales", "creditSales"],
  ...over,
});

describe("reviewState", () => {
  it("no draft: nothing pending and the form can be confirmed", () => {
    expect(reviewState({ marks: {}, filled: {}, current: {}, acknowledged: new Set(), order: [] })).toEqual({ pending: [], canConfirm: true });
  });

  it("low fields that are neither edited nor acknowledged block the confirm, in form order", () => {
    expect(reviewState(base())).toEqual({ pending: ["line.food", "creditSales"], canConfirm: false });
  });

  it("an acknowledged low field no longer blocks", () => {
    const r = reviewState(base({ acknowledged: new Set(["creditSales", "line.food"]) }));
    expect(r).toEqual({ pending: [], canConfirm: true });
  });

  it("an edited low field no longer blocks, an acknowledgement of another one does not cover it", () => {
    const r = reviewState(base({ current: { "line.bev": "118", creditSales: "3300", "line.food": "7900" }, acknowledged: new Set(["line.food"]) }));
    expect(r).toEqual({ pending: [], canConfirm: true });
    const r2 = reviewState(base({ acknowledged: new Set(["line.food"]) }));
    expect(r2.pending).toEqual(["creditSales"]);
  });

  it("editing a field back to what the draft read makes it pending again", () => {
    const edited = base({ current: { "line.bev": "118", creditSales: "9", "line.food": "7900" }, acknowledged: new Set(["line.food"]) });
    expect(reviewState(edited).canConfirm).toBe(true);
    const back = base({ current: { "line.bev": "118", creditSales: " 3200 ", "line.food": "7900" }, acknowledged: new Set(["line.food"]) });
    expect(reviewState(back).pending).toEqual(["creditSales"]);
  });

  it("clearing a low field counts as editing it (the server then asks for the number)", () => {
    const r = reviewState(base({ current: { "line.bev": "118", creditSales: "", "line.food": "7900" }, acknowledged: new Set(["line.food"]) }));
    expect(r.canConfirm).toBe(true);
  });

  it("ai (confident) fields never block", () => {
    const r = reviewState(base({ marks: { "line.bev": "ai" } }));
    expect(r.canConfirm).toBe(true);
  });

  it("a low field missing from the order list still blocks, after the ordered ones", () => {
    const r = reviewState(base({ marks: { zzz: "low", creditSales: "low" }, filled: { zzz: "1", creditSales: "3200" }, current: { zzz: "1", creditSales: "3200" } }));
    expect(r).toEqual({ pending: ["creditSales", "zzz"], canConfirm: false });
  });

  it("hostile field names are treated as plain names", () => {
    const marks = JSON.parse('{"__proto__":"low","constructor":"low"}') as Record<string, "low">;
    const r = reviewState({ marks, filled: {}, current: {}, acknowledged: new Set(), order: [] });
    expect(r.canConfirm).toBe(false);
    expect(r.pending.sort()).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("a name that only exists on the prototype (toString) is not a mark", () => {
    const r = reviewState({ marks: {}, filled: {}, current: {}, acknowledged: new Set(), order: ["toString"] });
    expect(r.canConfirm).toBe(true);
  });
});
