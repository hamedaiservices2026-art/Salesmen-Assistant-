import { describe, expect, it } from "vitest";
import type { CloseDraft } from "./draft";
import { parseStoredDraft } from "./draft-schema";

const good = (): CloseDraft => ({
  source: "photo",
  date: "2026-11-14",
  fields: {
    "line:bev": { value: 118, confidence: 0.97, low: false, seenAs: "118" },
    creditSales: { value: 320000, confidence: 0.62, low: true, seenAs: "3,200" },
  },
  problems: [{ key: "line:zzz", problem: "unknown_key" }],
  reportDate: "2026-11-12",
  dateMismatch: true,
});

describe("parseStoredDraft", () => {
  it("accepts what toDraft produces", () => {
    expect(parseStoredDraft(good())).toEqual(good());
    expect(parseStoredDraft(JSON.parse(JSON.stringify(good())))).toEqual(good());
  });

  it("refuses wrong types, extra properties and bad dates", () => {
    const d = good() as unknown as Record<string, unknown>;
    expect(parseStoredDraft({ ...d, extra: 1 })).toBeNull();
    expect(parseStoredDraft({ ...d, source: "typed" })).toBeNull();
    expect(parseStoredDraft({ ...d, date: "2026-02-30" })).toBeNull();
    expect(parseStoredDraft({ ...d, reportDate: "tomorrow" })).toBeNull();
    expect(parseStoredDraft({ ...d, fields: { "line:bev": { value: "118", confidence: 1, low: false, seenAs: "118" } } })).toBeNull();
    expect(parseStoredDraft({ ...d, fields: { "line:bev": { value: 1.5, confidence: 1, low: false, seenAs: "1" } } })).toBeNull();
    expect(parseStoredDraft({ ...d, fields: { "line:bev": { value: -1, confidence: 1, low: false, seenAs: "1" } } })).toBeNull();
    expect(parseStoredDraft({ ...d, fields: { "line:bev": { value: 1e300, confidence: 1, low: false, seenAs: "1" } } })).toBeNull();
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("x")).toBeNull();
    expect(parseStoredDraft([])).toBeNull();
  });

  it("refuses a confident-looking field whose confidence is under the threshold", () => {
    const d = good();
    d.fields.creditSales = { value: 1, confidence: 0.1, low: false, seenAs: "1" };
    expect(parseStoredDraft(d)).toBeNull();
  });

  it("refuses keys that are not draft keys and prototype keys", () => {
    const field = { value: 1, confidence: 1, low: false, seenAs: "1" };
    for (const key of ["__proto__", "constructor", "prototype", "toString", "cash", "line:", "line:" + "x".repeat(65)]) {
      const fields = JSON.parse(`{${JSON.stringify(key)}:${JSON.stringify(field)}}`);
      expect(parseStoredDraft({ ...good(), fields }), key).toBeNull();
    }
  });

  it("caps the sizes of the lists and texts", () => {
    const d = good();
    expect(parseStoredDraft({ ...d, problems: Array.from({ length: 61 }, () => ({ key: "k", problem: "unreadable" })) })).toBeNull();
    expect(parseStoredDraft({ ...d, problems: [{ key: "k".repeat(41), problem: "unreadable" }] })).toBeNull();
    expect(parseStoredDraft({ ...d, problems: [{ key: "k", problem: "other" }] })).toBeNull();
    d.fields["line:bev"] = { value: 1, confidence: 1, low: false, seenAs: "x".repeat(81) };
    expect(parseStoredDraft(d)).toBeNull();
  });
});
