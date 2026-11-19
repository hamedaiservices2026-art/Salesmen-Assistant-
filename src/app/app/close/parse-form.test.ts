import { describe, expect, it } from "vitest";
import { parseCloseForm } from "./parse-form";

const lines = [
  { lineId: "bev", unit: "cases" as const },
  { lineId: "food", unit: "value" as const },
  { lineId: "coll", unit: "value" as const },
];
const focus = [{ id: "cola", unit: "cases" as const }];

function data(entries: Record<string, string>): FormData {
  const f = new FormData();
  f.set("date", "2026-11-14");
  f.set("cashSales", "14800");
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const good = { "line.bev": "١٣٠", "line.food": "8,250.50", "line.coll": "19000" };

describe("parseCloseForm", () => {
  it("parses Arabic digits, separators and decimals into integers", () => {
    const r = parseCloseForm(data(good), lines, focus);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.form.lines).toEqual({ bev: 130, food: 825050, coll: 1900000 });
  });

  it("a decimal comma is invalid, never read as a bigger number", () => {
    const r = parseCloseForm(data({ ...good, "line.food": "8250,50" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { "line.food": "invalid" } });
  });

  it("an empty line field is required", () => {
    const r = parseCloseForm(data({ ...good, "line.bev": "" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { "line.bev": "required" } });
  });

  it("an unparsable line field is invalid, never saved as 0", () => {
    const r = parseCloseForm(data({ ...good, "line.bev": "abc" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { "line.bev": "invalid" } });
  });

  it("empty optional fields become 0", () => {
    const r = parseCloseForm(data(good), lines, focus);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.form.expenses).toBe(0);
      expect(r.form.creditSales).toBe(0);
      expect(r.form.loaded).toBe(0);
      expect(r.form.focus).toEqual({ cola: 0 });
      expect(r.form.returns).toEqual([]);
    }
  });

  it("an unparsable optional field is invalid", () => {
    const r = parseCloseForm(data({ ...good, expenses: "x1" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { expenses: "invalid" } });
  });

  it("parses return rows, skips blank ones, requires a quantity", () => {
    const f = data(good);
    f.set("ret.0.description", "عصير");
    f.set("ret.0.quantity", "3");
    f.set("ret.0.reason", "expired");
    f.set("ret.1.description", "");
    f.set("ret.1.quantity", "");
    f.set("ret.1.reason", "other");
    f.set("ret.2.description", "علب");
    f.set("ret.2.quantity", "");
    f.set("ret.2.reason", "damaged");
    const r = parseCloseForm(f, lines, focus);
    expect(r).toEqual({ ok: false, errors: { "ret.2.quantity": "required" } });
    f.set("ret.2.quantity", "٢");
    const ok = parseCloseForm(f, lines, focus);
    expect(ok.ok && ok.form.returns).toEqual([
      { description: "عصير", quantity: 3, reason: "expired" },
      { description: "علب", quantity: 2, reason: "damaged" },
    ]);
  });

  it("empty cash sales is required", () => {
    const r = parseCloseForm(data({ ...good, cashSales: "" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { cashSales: "required" } });
  });

  it("an invalid focus field is invalid", () => {
    const r = parseCloseForm(data({ ...good, "focus.cola": "ten" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { "focus.cola": "invalid" } });
  });

  it("a three-decimal money value is invalid", () => {
    const r = parseCloseForm(data({ ...good, "line.food": "10.123" }), lines, focus);
    expect(r).toEqual({ ok: false, errors: { "line.food": "invalid" } });
  });

  it("a bad return reason is invalid, not rewritten", () => {
    const f = data(good);
    f.set("ret.0.description", "x");
    f.set("ret.0.quantity", "1");
    f.set("ret.0.reason", "stolen");
    expect(parseCloseForm(f, lines, focus)).toEqual({ ok: false, errors: { "ret.0.reason": "invalid" } });
  });

  it("collections is the sum of collection-kind lines when the company has one", () => {
    const kinded = lines.map((l) => (l.lineId === "coll" ? { ...l, kind: "collection" as const } : l));
    const r = parseCloseForm(data(good), kinded, focus);
    expect(r.ok && r.form.collections).toBe(1900000);
  });

  it("without a collection line, an unreadable standalone collections field is invalid", () => {
    const noColl = lines.filter((l) => l.lineId !== "coll");
    const r = parseCloseForm(data({ "line.bev": "130", "line.food": "100", collections: "abc" }), noColl, focus);
    expect(r).toEqual({ ok: false, errors: { collections: "invalid" } });
  });

  it("without a collection line, collections is its own optional field", () => {
    const none = parseCloseForm(data(good), lines, focus);
    expect(none.ok && none.form.collections).toBe(0);
    const typed = parseCloseForm(data({ ...good, collections: "250.5" }), lines, focus);
    expect(typed.ok && typed.form.collections).toBe(25050);
  });

  it("a draft close's form (admin lines filled, money blank) is refused until cash sales is entered", () => {
    const fd = new FormData();
    fd.set("date", "2026-11-14");
    fd.set("line.bev", "40");
    const r = parseCloseForm(fd, [{ lineId: "bev", unit: "cases" }], []);
    expect(r).toEqual({ ok: false, errors: { cashSales: "required" } });
    fd.set("cashSales", "0");
    expect(parseCloseForm(fd, [{ lineId: "bev", unit: "cases" }], []).ok).toBe(true);
  });
});
