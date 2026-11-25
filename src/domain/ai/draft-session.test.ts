import { describe, expect, it } from "vitest";
import type { CloseDraft } from "./draft";
import type { FormLine } from "./apply-draft";
import { applyRead, clearReading, restoreSession, toStored, type SessionState } from "./draft-session";
import { fieldReview, reviewState } from "./review";

const lines: FormLine[] = [
  { lineId: "bev", code: "bev", unit: "cases", kind: "sales", field: "line.bev", optional: false },
  { lineId: "food", code: "food", unit: "value", kind: "sales", field: "line.food", optional: false },
];
const draft = (fields: CloseDraft["fields"]): CloseDraft => ({ source: "photo", date: "2026-11-14", fields, problems: [], reportDate: "2026-11-14", dateMismatch: false });
const f = (value: number, low = false) => ({ value, confidence: low ? 0.5 : 0.95, low, seenAs: String(value) });
const ID = "0123456789abcdef0123456789abcdef";
const empty: SessionState = { values: {}, review: null, acked: new Set() };
const read = (fields: CloseDraft["fields"]) => ({ draft: draft(fields), draftId: ID });

describe("applyRead", () => {
  it("fills empty fields and marks them", () => {
    const s = applyRead(empty, read({ "line:bev": f(118), "line:food": f(790000, true) }), { lines, touched: new Set() });
    expect(s.values).toEqual({ "line.bev": "118", "line.food": "7900" });
    expect(s.review?.marks).toEqual({ "line.bev": "ai", "line.food": "low" });
  });

  it("never fills a field the rep touched", () => {
    const s = applyRead({ ...empty, values: { "line.bev": "9" } }, read({ "line:bev": f(118) }), { lines, touched: new Set(["line.bev"]) });
    expect(s.values["line.bev"]).toBe("9");
    expect(s.review?.marks).toEqual({});
  });

  it("a re-read never replaces a field the rep acknowledged (R79)", () => {
    const first = applyRead(empty, read({ "line:bev": f(118, true), "line:food": f(790000, true) }), { lines, touched: new Set() });
    const acked: SessionState = { ...first, acked: new Set(["line.bev"]) };
    const second = applyRead(acked, read({ "line:bev": f(120, true), "line:food": f(800000, true) }), { lines, touched: new Set() });
    expect(second.values["line.bev"]).toBe("118");
    expect(second.values["line.food"]).toBe("8000");
    expect([...second.acked]).toEqual(["line.bev"]);
    expect(second.review?.marks["line.food"]).toBe("low");
    expect(second.review?.replaced).toEqual({ "line.food": "7900" });
  });

  it("notes what a prefilled (saved) value was when the draft replaces it, only when it differs", () => {
    const s = applyRead({ ...empty, values: { "line.bev": "100", "line.food": "7900" } }, read({ "line:bev": f(118), "line:food": f(790000) }), { lines, touched: new Set() });
    expect(s.review?.replaced).toEqual({ "line.bev": "100" });
  });

  it("a second read replacing an unacknowledged earlier read records that value as replaced", () => {
    const first = applyRead({ ...empty, values: { "line.bev": "100" } }, read({ "line:bev": f(118) }), { lines, touched: new Set() });
    const second = applyRead(first, read({ "line:bev": f(120) }), { lines, touched: new Set() });
    expect(second.review?.replaced).toEqual({ "line.bev": "118" });
  });

  it("the confirm gate follows: low unresolved blocks, an acknowledgement or an edit releases it", () => {
    const s = applyRead(empty, read({ "line:food": f(790000, true) }), { lines, touched: new Set() });
    const gate = (st: SessionState) => reviewState({ marks: st.review!.marks, filled: st.review!.filled, current: st.values, acknowledged: st.acked, order: ["line.bev", "line.food"] });
    expect(gate(s).canConfirm).toBe(false);
    expect(gate({ ...s, acked: new Set(["line.food"]) }).canConfirm).toBe(true);
    expect(gate({ ...s, values: { ...s.values, "line.food": "8000" } }).canConfirm).toBe(true);
    expect(fieldReview("line.food", { marks: s.review!.marks, filled: s.review!.filled, current: s.values, acknowledged: s.acked, order: [] })).toBe("low");
  });
});

describe("clearReading", () => {
  it("puts back what the page loaded with, keeps what the rep changed, and clears review and acknowledgements", () => {
    const s0 = applyRead({ ...empty, values: { "line.bev": "100" } }, read({ "line:bev": f(118), "line:food": f(790000) }), { lines, touched: new Set() });
    const edited: SessionState = { ...s0, values: { ...s0.values, "line.food": "8000" }, acked: new Set(["line.bev"]) };
    const cleared = clearReading(edited, { "line.bev": "100" });
    expect(cleared.values).toEqual({ "line.bev": "100", "line.food": "8000" });
    expect(cleared.review).toBeNull();
    expect(cleared.acked.size).toBe(0);
  });
});

describe("restoreSession (a reload; R79)", () => {
  const initial = { "line.bev": "100" };
  const rd = () => read({ "line:bev": f(118), "line:food": f(790000, true) });

  it("with the stored session the rep's work comes back exactly and the draft is not applied over it", () => {
    const applied = applyRead({ values: initial, review: null, acked: new Set() }, rd(), { lines, touched: new Set() });
    // the rep corrected the low field, acknowledged nothing, and typed a number in bev
    const working: SessionState = { ...applied, values: { ...applied.values, "line.food": "8000", "line.bev": "9" } };
    const saved = toStored(working, new Set(["line.bev", "line.food"]))!;
    const back = restoreSession(rd(), initial, lines, JSON.parse(JSON.stringify(saved)));
    expect(back.keptChanges).toBe(true);
    expect(back.state.values).toEqual({ "line.bev": "9", "line.food": "8000" });
    expect([...back.touched].sort()).toEqual(["line.bev", "line.food"]);
    expect(back.state.review?.marks).toEqual(applied.review?.marks);
    expect(back.state.review?.replaced).toEqual({ "line.bev": "100" });
  });

  it("an acknowledgement survives; a low field not acknowledged is still low", () => {
    const applied = applyRead(empty, rd(), { lines, touched: new Set() });
    const saved = toStored({ ...applied, acked: new Set(["line.food"]) }, new Set())!;
    const back = restoreSession(rd(), {}, lines, saved);
    expect([...back.state.acked]).toEqual(["line.food"]);
    expect(reviewState({ marks: back.state.review!.marks, filled: back.state.review!.filled, current: back.state.values, acknowledged: back.state.acked, order: [] }).canConfirm).toBe(true);
  });

  it("without a stored session every restored field is low and the rep is told his changes were not kept", () => {
    const back = restoreSession(rd(), initial, lines, null);
    expect(back.keptChanges).toBe(false);
    expect(back.state.review?.marks).toEqual({ "line.bev": "low", "line.food": "low" });
    expect(back.state.values).toEqual({ "line.bev": "118", "line.food": "7900" });
    expect(back.state.acked.size).toBe(0);
    expect(reviewState({ marks: back.state.review!.marks, filled: back.state.review!.filled, current: back.state.values, acknowledged: back.state.acked, order: [] }).canConfirm).toBe(false);
  });

  it("toStored is null with no draft", () => {
    expect(toStored(empty, new Set())).toBeNull();
  });
});
