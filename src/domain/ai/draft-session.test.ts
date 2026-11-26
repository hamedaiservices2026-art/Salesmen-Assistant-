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

describe("a second read (R84)", () => {
  const lines3: FormLine[] = [...lines];
  const photo = (fields: CloseDraft["fields"], reportDate: string, dateMismatch: boolean): CloseDraft => ({ source: "photo", date: "2026-11-25", fields, problems: [], reportDate, dateMismatch });
  const A = "a".repeat(32);
  const B = "b".repeat(32);

  it("an earlier read's figures the new read does not give go back to what the page loaded with", () => {
    const s1 = applyRead(empty, { draft: photo({ "line:bev": f(118), "line:food": f(790000), cashSales: f(1480000) }, "2026-11-24", true), draftId: A }, { lines: lines3, touched: new Set(), initial: {} });
    const s2 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(), initial: {} });
    expect(s2.values).toEqual({ "line.bev": "120", "line.food": "", cashSales: "" });
    const input = { marks: s2.review!.marks, filled: s2.review!.filled, current: s2.values, acknowledged: s2.acked, order: [] };
    expect(fieldReview("line.food", input)).toBeNull();
    expect(fieldReview("cashSales", input)).toBeNull();
    expect(s2.review!.marks).toEqual({ "line.bev": "ai" });
    expect(s2.review!.replaced).toEqual({ "line.bev": "118" });
    expect(s2.review!.missing).toEqual(["line.food", "cashSales"]);
  });

  it("a loaded (saved) value comes back, and its replaced note goes", () => {
    const loaded = { "line.food": "7000" };
    const s1 = applyRead({ ...empty, values: loaded }, { draft: photo({ "line:bev": f(118), "line:food": f(790000) }, "2026-11-25", false), draftId: A }, { lines: lines3, touched: new Set(), initial: loaded });
    expect(s1.review!.replaced).toEqual({ "line.food": "7000" });
    const s2 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(), initial: loaded });
    expect(s2.values["line.food"]).toBe("7000");
    expect(s2.review!.replaced).toEqual({ "line.bev": "118" });
    expect(Object.hasOwn(s2.review!.filled, "line.food")).toBe(false);
  });

  it("without the loaded values, an earlier figure the new read does not give stays but is marked low", () => {
    const s1 = applyRead(empty, { draft: photo({ "line:bev": f(118), "line:food": f(790000) }, "2026-11-25", false), draftId: A }, { lines: lines3, touched: new Set() });
    const s2 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set() });
    expect(s2.values["line.food"]).toBe("7900");
    expect(fieldReview("line.food", { marks: s2.review!.marks, filled: s2.review!.filled, current: s2.values, acknowledged: s2.acked, order: [] })).toBe("low");
    expect(reviewState({ marks: s2.review!.marks, filled: s2.review!.filled, current: s2.values, acknowledged: s2.acked, order: [] }).canConfirm).toBe(false);
  });

  it("an edited or acknowledged earlier figure stays as it is", () => {
    const s1 = applyRead(empty, { draft: photo({ "line:bev": f(118, true), "line:food": f(790000) }, "2026-11-25", false), draftId: A }, { lines: lines3, touched: new Set(), initial: {} });
    const worked: SessionState = { ...s1, values: { ...s1.values, "line.food": "8000" }, acked: new Set(["line.bev"]) };
    const s2 = applyRead(worked, { draft: photo({ cashSales: f(1480000) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(["line.food"]), initial: {} });
    expect(s2.values).toEqual({ "line.bev": "118", "line.food": "8000", cashSales: "14800" });
    expect(fieldReview("line.bev", { marks: s2.review!.marks, filled: s2.review!.filled, current: s2.values, acknowledged: s2.acked, order: [] })).toBe("ai");
  });

  it("a report dated another day keeps the date gate after a later read dated right, until the rep says the date is right", () => {
    const s1 = applyRead(empty, { draft: photo({ "line:bev": f(118) }, "2026-11-24", true), draftId: A }, { lines: lines3, touched: new Set(), initial: {} });
    expect(s1.review!.dateMismatch).toBe(true);
    expect(s1.review!.mismatchDate).toBe("2026-11-24");
    const s2 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(), initial: {} });
    expect(s2.review!.dateMismatch).toBe(true);
    expect(s2.review!.mismatchDate).toBe("2026-11-24");
    const gate = reviewState({ marks: s2.review!.marks, filled: s2.review!.filled, current: s2.values, acknowledged: s2.acked, order: [], dateMismatch: s2.review!.dateMismatch, dateAcknowledged: false });
    expect(gate.canConfirm).toBe(false);
    // the rep had said the first date is right: a later read dated right needs nothing more
    const s3 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(), initial: {}, dateAcknowledged: true });
    expect(s3.review!.dateMismatch).toBe(false);
    expect(s3.review!.mismatchDate).toBeNull();
  });

  it("the date gate survives a reload with the stored session", () => {
    const s1 = applyRead(empty, { draft: photo({ "line:bev": f(118) }, "2026-11-24", true), draftId: A }, { lines: lines3, touched: new Set(), initial: {} });
    const s2 = applyRead(s1, { draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, { lines: lines3, touched: new Set(), initial: {} });
    const saved = JSON.parse(JSON.stringify(toStored(s2, new Set())));
    const back = restoreSession({ draft: photo({ "line:bev": f(120) }, "2026-11-25", false), draftId: B }, {}, lines3, saved);
    expect(back.state.review!.dateMismatch).toBe(true);
    expect(back.state.review!.mismatchDate).toBe("2026-11-24");
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

  it("a line the admin recorded after the draft was stored comes back with the loaded value, not the draft's (R16)", () => {
    const coll: FormLine[] = [{ lineId: "coll", code: "coll", unit: "value", kind: "collection", field: "line.coll", optional: false }];
    const r = read({ "line:coll": f(500000) });
    const s1 = applyRead(empty, r, { lines: coll, touched: new Set() });
    const stored = JSON.parse(JSON.stringify(toStored({ ...s1, acked: new Set(["line.coll"]) }, new Set(["line.coll"]))));
    const after: FormLine[] = [{ ...coll[0]!, adminAmount: 420000 }];
    const back = restoreSession(r, { "line.coll": "4200" }, after, stored);
    expect(back.state.values["line.coll"]).toBe("4200");
    expect(Object.hasOwn(back.state.review!.marks, "line.coll")).toBe(false);
    expect(Object.hasOwn(back.state.review!.filled, "line.coll")).toBe(false);
    expect(back.state.acked.has("line.coll")).toBe(false);
    expect(back.state.review!.skippedAdmin).toEqual({ "line.coll": "5,000" });
    expect(fieldReview("line.coll", { marks: back.state.review!.marks, filled: back.state.review!.filled, current: back.state.values, acknowledged: back.state.acked, order: [] })).toBeNull();
  });

  it("toStored is null with no draft", () => {
    expect(toStored(empty, new Set())).toBeNull();
  });
});
