import { describe, expect, it } from "vitest";
import { inputValue } from "@/domain/money";
import { fillForm } from "./apply-draft";
import type { CloseDraft, DraftField, DraftLine } from "./draft";
import { toDraft } from "./extraction";

const LINES: DraftLine[] = [
  { lineId: "bev", code: "bev", unit: "cases", kind: "sales" },
  { lineId: "food", code: "food", unit: "value", kind: "sales" },
  { lineId: "coll", code: "coll", unit: "value", kind: "collection" },
];
const CTX = { source: "photo" as const, date: "2026-11-14", lines: LINES };
const REPORT_A =
  '{"reportDate":"2026-11-14","fields":[{"key":"line:bev","value":"118","confidence":0.97},{"key":"line:food","value":"7,900.00","confidence":0.93},{"key":"line:coll","value":"19,500","confidence":0.95},{"key":"cashSales","value":"14,800","confidence":0.96},{"key":"creditSales","value":"3,200","confidence":0.62},{"key":"expenses","value":"150","confidence":0.9},{"key":"loaded","value":"160","confidence":0.9},{"key":"sold","value":"118","confidence":0.9},{"key":"returned","value":"3","confidence":0.9}]}';
const REPORT_B =
  '{"reportDate":"2026-11-12","fields":[{"key":"line:bev","value":"118","confidence":0.97},{"key":"line:food","value":"7,9OO","confidence":0.9},{"key":"line:zzz","value":"5","confidence":0.9},{"key":"cashSales","value":"14,800","confidence":0.96},{"key":"creditSales","value":"999999999999999","confidence":0.9},{"key":"expenses","value":"-150","confidence":0.9},{"key":"sold","value":"118.5","confidence":0.9}]}';

const draftA = toDraft(JSON.parse(REPORT_A), CTX)!;
const draftB = toDraft(JSON.parse(REPORT_B), CTX)!;

type FormLine = DraftLine & { field: string; optional: boolean; adminAmount?: number };
const formLines = (over: Partial<Record<string, Partial<FormLine>>> = {}): FormLine[] =>
  LINES.map((l) => ({ ...l, field: `line.${l.lineId}`, optional: false, ...over[l.lineId] }));
const form = (o: { lines?: FormLine[]; current?: Record<string, string>; touched?: string[] } = {}) => ({
  lines: o.lines ?? formLines(),
  current: o.current ?? {},
  touched: new Set(o.touched ?? []),
});
const field = (value: number, confidence = 0.95): DraftField => ({ value, confidence, low: confidence < 0.8, seenAs: String(value) });
const draftOf = (fields: CloseDraft["fields"]): CloseDraft => ({
  source: "photo",
  date: "2026-11-14",
  fields,
  problems: [],
  reportDate: null,
  dateMismatch: false,
});

describe("fillForm", () => {
  it("fills report A into an empty form with inputValue text and marks", () => {
    const f = fillForm(draftA, form());
    expect(f.values).toEqual({
      "line.bev": "118",
      "line.food": "7900",
      "line.coll": "19500",
      cashSales: "14800",
      creditSales: "3200",
      expenses: "150",
      loaded: "160",
      sold: "118",
      returned: "3",
    });
    expect(f.marks.creditSales).toBe("low");
    expect(f.marks["line.bev"]).toBe("ai");
    expect(f.marks.cashSales).toBe("ai");
    expect(Object.keys(f.marks).sort()).toEqual(Object.keys(f.values).sort());
    expect(f.missing).toEqual([]);
    expect(f.skippedAdmin).toEqual({});
  });

  it("never fills an admin-recorded line (R16); what the draft read goes to skippedAdmin", () => {
    const f = fillForm(draftA, form({ lines: formLines({ bev: { adminAmount: 12000 } }) }));
    expect(f.values["line.bev"]).toBeUndefined();
    expect(f.marks["line.bev"]).toBeUndefined();
    expect(f.skippedAdmin["line.bev"]).toBe("118");
    expect(f.missing).not.toContain("line.bev");
  });

  it("formats a skipped value line with grouping", () => {
    const f = fillForm(draftA, form({ lines: formLines({ food: { adminAmount: 1 } }) }));
    expect(f.skippedAdmin["line.food"]).toBe("7,900");
  });

  it("leaves a field the draft did not give empty and missing, never 0", () => {
    const f = fillForm(draftB, form());
    expect(f.missing).toContain("line.food");
    expect(f.missing).toContain("line.coll");
    expect(f.values).toEqual({ "line.bev": "118", cashSales: "14800" });
    expect(Object.values(f.values)).not.toContain("0");
    expect("line.food" in f.values).toBe(false);
    expect("line.coll" in f.values).toBe(false);
  });

  it("does not touch a field the rep typed in", () => {
    const f = fillForm(draftA, form({ touched: ["cashSales"], current: { cashSales: "9" } }));
    expect(f.values.cashSales).toBeUndefined();
    expect(f.marks.cashSales).toBeUndefined();
    expect(f.missing).not.toContain("cashSales");
  });

  it("a touched required field left empty is missing", () => {
    const f = fillForm(draftA, form({ touched: ["cashSales"], current: { cashSales: "  " } }));
    expect(f.missing).toEqual(["cashSales"]);
  });

  it("an untouched field with text is overwritten by the draft", () => {
    const f = fillForm(draftA, form({ current: { cashSales: "1" } }));
    expect(f.values.cashSales).toBe("14800");
  });

  it("current text counts for missing; optional lines are never missing", () => {
    const f = fillForm(draftOf({}), form({ current: { cashSales: "5", "line.bev": "1" }, lines: formLines({ coll: { optional: true } }) }));
    expect(f.missing).toEqual(["line.food"]);
  });

  it("lists cashSales and every required line when the draft is empty, in form order", () => {
    expect(fillForm(draftOf({}), form()).missing).toEqual(["line.bev", "line.food", "line.coll", "cashSales"]);
  });

  it("maps a line key by code to the line's field name", () => {
    const lines: FormLine[] = [{ lineId: "demo-co-bev", code: "bev", unit: "cases", kind: "sales", field: "line.demo-co-bev", optional: false }];
    const f = fillForm(draftOf({ "line:bev": field(7) }), form({ lines, current: { cashSales: "1" } }));
    expect(f.values).toEqual({ "line.demo-co-bev": "7" });
  });

  it("never sets collections beside a collection line (R17, R18)", () => {
    const f = fillForm(draftOf({ collections: field(500) }), form());
    expect(f.values.collections).toBeUndefined();
    const g = fillForm(draftOf({ collections: field(500) }), form({ lines: formLines().filter((l) => l.kind !== "collection") }));
    expect(g.values.collections).toBe("5");
  });

  it("ignores a line key the form does not have", () => {
    const f = fillForm(draftOf({ "line:zzz": field(5), "line:bev": field(1) }), form());
    expect(f.values).toEqual({ "line.bev": "1" });
  });

  it("refuses values a tampered draft (from sessionStorage) could carry", () => {
    const tampered = draftOf({
      "line:bev": field(-5),
      "line:food": field(1.5),
      cashSales: field(Number.NaN),
      creditSales: field(1e12),
      expenses: field(Number.POSITIVE_INFINITY),
      loaded: field(100_000_001),
      sold: { value: "7" as unknown as number, confidence: 1, low: false, seenAs: "7" },
      returned: field(Number.MAX_SAFE_INTEGER + 2),
    });
    const f = fillForm(tampered, form());
    expect(f.values).toEqual({});
    expect(f.marks).toEqual({});
    expect(f.missing).toEqual(["line.bev", "line.food", "line.coll", "cashSales"]);
  });

  it("ignores draft keys that are not form fields, including prototype names", () => {
    const fields = JSON.parse('{"__proto__":{"value":1},"constructor":{"value":1},"toString":{"value":1},"line.bev":{"value":1}}');
    const f = fillForm(draftOf(fields), form({ current: { cashSales: "1" } }));
    expect(f.values).toEqual({});
    expect(Object.getPrototypeOf(f.values)).toBe(Object.prototype);
  });

  it("an own __proto__ in current or a prototype name in touched changes nothing", () => {
    const current = JSON.parse('{"__proto__":"x","cashSales":"1"}');
    const f = fillForm(draftOf({ "line:bev": field(3) }), { lines: formLines(), current, touched: new Set(["__proto__", "toString"]) });
    expect(f.values).toEqual({ "line.bev": "3" });
    expect(f.missing).toEqual(["line.food", "line.coll"]);
  });

  it("a low field is marked low; a 0 the draft really read fills 0", () => {
    const f = fillForm(draftOf({ returned: field(0, 0.5), "line:bev": field(0) }), form());
    expect(f.values.returned).toBe("0");
    expect(f.marks.returned).toBe("low");
    expect(f.values["line.bev"]).toBe("0");
  });

  it("every filled text is inputValue of the draft value (property over generated drafts)", () => {
    let a = 12345;
    const next = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 2000; i++) {
      const fields: CloseDraft["fields"] = {};
      for (const k of ["line:bev", "line:food", "line:coll", "cashSales", "creditSales", "collections", "expenses", "loaded", "sold", "returned"] as const) {
        if (next() < 0.5) fields[k] = field(Math.floor(next() * 1e9), next());
      }
      const touched = ["cashSales", "line.food", "sold"].filter(() => next() < 0.3);
      const admin = next() < 0.3 ? { bev: { adminAmount: 1 } } : {};
      const f = fillForm(draftOf(fields), form({ lines: formLines(admin), touched }));
      const units: Record<string, "cases" | "value"> = {
        "line.bev": "cases", "line.food": "value", "line.coll": "value", cashSales: "value", creditSales: "value",
        expenses: "value", loaded: "cases", sold: "cases", returned: "cases",
      };
      const keyOf: Record<string, keyof CloseDraft["fields"]> = {
        "line.bev": "line:bev", "line.food": "line:food", "line.coll": "line:coll", cashSales: "cashSales",
        creditSales: "creditSales", expenses: "expenses", loaded: "loaded", sold: "sold", returned: "returned",
      };
      for (const [name, text] of Object.entries(f.values)) {
        expect(touched).not.toContain(name);
        const df = fields[keyOf[name]!]!;
        expect(text).toBe(inputValue(df.value, units[name]!));
        expect(f.marks[name]).toBe(df.low ? "low" : "ai");
      }
      expect(f.values.collections).toBeUndefined();
      if ("bev" in admin) expect(f.values["line.bev"]).toBeUndefined();
    }
  });
});
