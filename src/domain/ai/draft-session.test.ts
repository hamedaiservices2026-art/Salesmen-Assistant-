import { describe, expect, it } from "vitest";
import type { CloseDraft } from "./draft";
import type { FormLine } from "./apply-draft";
import { applyRead, clearReading, type SessionState } from "./draft-session";
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

  it("a re-read resets the acknowledgement of the fields it fills again, and keeps the others", () => {
    const first = applyRead(empty, read({ "line:bev": f(118, true), "line:food": f(790000, true) }), { lines, touched: new Set() });
    const acked: SessionState = { ...first, acked: new Set(["line.bev", "line.food"]) };
    const second = applyRead(acked, read({ "line:bev": f(120, true) }), { lines, touched: new Set() });
    expect([...second.acked]).toEqual(["line.food"]);
    expect(second.values["line.bev"]).toBe("120");
    expect(second.review?.marks["line.food"]).toBe("low");
  });

  it("notes what a prefilled (saved) value was when the draft replaces it, only when it differs", () => {
    const s = applyRead({ ...empty, values: { "line.bev": "100", "line.food": "7900" } }, read({ "line:bev": f(118), "line:food": f(790000) }), { lines, touched: new Set() });
    expect(s.review?.replaced).toEqual({ "line.bev": "100" });
  });

  it("a second read does not report the first read's number as a saved value", () => {
    const first = applyRead({ ...empty, values: { "line.bev": "100" } }, read({ "line:bev": f(118) }), { lines, touched: new Set() });
    const second = applyRead(first, read({ "line:bev": f(120) }), { lines, touched: new Set() });
    expect(second.review?.replaced).toEqual({ "line.bev": "100" });
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
