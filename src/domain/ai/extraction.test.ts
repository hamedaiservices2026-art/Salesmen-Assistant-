import { describe, expect, it } from "vitest";
import { AMOUNT_MAX, CASES_MAX, parseAmount, type Unit } from "@/domain/money";
import { draftKeys, LOW_CONFIDENCE, type DraftLine } from "./draft";
import { ExtractionSchema, readValue, toDraft } from "./extraction";

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

const one = (key: string, value: string, confidence: number | "none" = 0.9) => ({
  fields: [confidence === "none" ? { key, value } : { key, value, confidence }],
});
const valuesOf = (d: ReturnType<typeof toDraft>) =>
  Object.fromEntries(Object.entries(d?.fields ?? {}).map(([k, f]) => [k, f?.value]));

describe("draftKeys", () => {
  it("lists every daily line, the money keys as value and the stock keys as cases", () => {
    expect(draftKeys([LINES[0]!, LINES[1]!])).toEqual([
      { key: "line:bev", unit: "cases" },
      { key: "line:food", unit: "value" },
      { key: "cashSales", unit: "value" },
      { key: "creditSales", unit: "value" },
      { key: "collections", unit: "value" },
      { key: "expenses", unit: "value" },
      { key: "loaded", unit: "cases" },
      { key: "sold", unit: "cases" },
      { key: "returned", unit: "cases" },
    ]);
  });

  it("leaves collections out when the company has a collection line (R17)", () => {
    const keys = draftKeys(LINES).map((k) => k.key);
    expect(keys).toContain("line:coll");
    expect(keys).not.toContain("collections");
  });

  it("never lists a coverage line", () => {
    const keys = draftKeys([...LINES, { lineId: "cov", code: "cov", unit: "outlets", kind: "coverage" }]).map((k) => k.key);
    expect(keys).not.toContain("line:cov");
  });

  it("keeps the low-confidence threshold at 0.80", () => {
    expect(LOW_CONFIDENCE).toBe(0.8);
  });
});

describe("toDraft: the plan's reports", () => {
  it("reads report A", () => {
    const d = toDraft(JSON.parse(REPORT_A), CTX);
    expect(d).not.toBeNull();
    expect(valuesOf(d)).toEqual({
      "line:bev": 118,
      "line:food": 790000,
      "line:coll": 1950000,
      cashSales: 1480000,
      creditSales: 320000,
      expenses: 15000,
      loaded: 160,
      sold: 118,
      returned: 3,
    });
    expect(d!.fields.creditSales).toEqual({ value: 320000, confidence: 0.62, low: true, seenAs: "3,200" });
    expect(d!.fields["line:bev"]).toEqual({ value: 118, confidence: 0.97, low: false, seenAs: "118" });
    expect(d!.problems).toEqual([]);
    expect(d!.reportDate).toBe("2026-11-14");
    expect(d!.dateMismatch).toBe(false);
    expect(d!.source).toBe("photo");
    expect(d!.date).toBe("2026-11-14");
  });

  it("reads report B: only the valid part, every problem named (R31 order)", () => {
    const d = toDraft(JSON.parse(REPORT_B), CTX)!;
    expect(valuesOf(d)).toEqual({ "line:bev": 118, cashSales: 1480000 });
    expect(d.problems).toEqual([
      { key: "line:food", problem: "unreadable" },
      { key: "line:zzz", problem: "unknown_key" },
      { key: "creditSales", problem: "too_large" },
      { key: "expenses", problem: "negative" },
      { key: "sold", problem: "unreadable" },
    ]);
    expect(d.reportDate).toBe("2026-11-12");
    expect(d.dateMismatch).toBe(true);
  });
});

describe("toDraft: collections", () => {
  const raw = { fields: [{ key: "collections", value: "19,500", confidence: 0.9 }] };

  it("becomes the one collection line's key", () => {
    const d = toDraft(raw, CTX)!;
    expect(valuesOf(d)).toEqual({ "line:coll": 1950000 });
    expect(d.fields.collections).toBeUndefined();
    expect(d.problems).toEqual([]);
  });

  it("is dropped as unknown_key with two collection lines", () => {
    const lines: DraftLine[] = [...LINES, { lineId: "coll2", code: "coll2", unit: "value", kind: "collection" }];
    const d = toDraft(raw, { ...CTX, lines })!;
    expect(valuesOf(d)).toEqual({});
    expect(d.problems).toEqual([{ key: "collections", problem: "unknown_key" }]);
  });

  it("stays collections with no collection line", () => {
    const d = toDraft(raw, { ...CTX, lines: [LINES[0]!, LINES[1]!] })!;
    expect(valuesOf(d)).toEqual({ collections: 1950000 });
  });

  it("collections and line:coll together are one key read twice", () => {
    const d = toDraft(
      { fields: [{ key: "line:coll", value: "100", confidence: 0.99 }, { key: "collections", value: "200", confidence: 0.99 }] },
      CTX,
    )!;
    expect(d.fields["line:coll"]).toMatchObject({ value: 10000, low: true });
    expect(d.problems).toEqual([{ key: "line:coll", problem: "duplicate" }]);
  });
});

describe("toDraft: values", () => {
  const read = (key: string, value: string) => toDraft(one(key, value), CTX)!;

  it("refuses a decimal comma, reads Arabic-Indic digits, refuses an exponent, caps cases", () => {
    expect(read("line:food", "8250,50").problems).toEqual([{ key: "line:food", problem: "unreadable" }]);
    expect(read("line:food", "٨٢٥٠").fields["line:food"]?.value).toBe(825000);
    expect(read("line:food", "1e5").problems).toEqual([{ key: "line:food", problem: "unreadable" }]);
    expect(read("line:bev", "100000001").problems).toEqual([{ key: "line:bev", problem: "too_large" }]);
  });

  it("caps stock keys at CASES_MAX and money keys at AMOUNT_MAX in halalas", () => {
    expect(read("loaded", String(CASES_MAX)).fields.loaded?.value).toBe(CASES_MAX);
    expect(read("loaded", String(CASES_MAX + 1)).problems[0]?.problem).toBe("too_large");
    expect(read("expenses", String(AMOUNT_MAX / 100)).fields.expenses?.value).toBe(AMOUNT_MAX);
    expect(read("expenses", String(AMOUNT_MAX / 100 + 1)).problems[0]?.problem).toBe("too_large");
    // the fraction pushes it over: integer part is at the cap, the parsed amount is above it
    expect(read("expenses", `${AMOUNT_MAX / 100}.01`).problems[0]?.problem).toBe("too_large");
  });

  it("an empty or letters-only value is unreadable, never 0", () => {
    for (const v of ["", " ", "abc", "صفر", "-", "."]) {
      const d = read("cashSales", v);
      expect(d.fields.cashSales).toBeUndefined();
      expect(d.problems).toHaveLength(1);
      expect(["unreadable", "negative"]).toContain(d.problems[0]?.problem);
    }
  });

  it("a real zero is read as 0", () => {
    expect(read("returned", "0").fields.returned?.value).toBe(0);
  });

  it("the sign is checked first, then the magnitude", () => {
    expect(read("expenses", "−150").problems[0]?.problem).toBe("negative");
    expect(read("expenses", " -999999999999999").problems[0]?.problem).toBe("negative");
    expect(read("expenses", "150-").problems[0]?.problem).toBe("unreadable");
    expect(read("expenses", "+150").problems[0]?.problem).toBe("unreadable");
  });

  it("the same key twice with different values keeps the first, low, and reports one duplicate", () => {
    const d = toDraft(
      { fields: [{ key: "line:bev", value: "118", confidence: 0.99 }, { key: "line:bev", value: "181", confidence: 0.99 }] },
      CTX,
    )!;
    expect(d.fields["line:bev"]).toEqual({ value: 118, confidence: 0.99, low: true, seenAs: "118" });
    expect(d.problems).toEqual([{ key: "line:bev", problem: "duplicate" }]);
  });

  it("the same key twice with the same value is no problem", () => {
    const d = toDraft(
      { fields: [{ key: "line:bev", value: "118", confidence: 0.99 }, { key: "line:bev", value: "118", confidence: 0.5 }] },
      CTX,
    )!;
    expect(d.fields["line:bev"]).toEqual({ value: 118, confidence: 0.99, low: false, seenAs: "118" });
    expect(d.problems).toEqual([]);
  });

  it("an unreadable first reading leaves the later valid one, marked low", () => {
    const d = toDraft(
      { fields: [{ key: "line:bev", value: "1l8", confidence: 0.99 }, { key: "line:bev", value: "118", confidence: 0.99 }] },
      CTX,
    )!;
    expect(d.fields["line:bev"]).toMatchObject({ value: 118, low: true });
    expect(d.problems).toEqual([{ key: "line:bev", problem: "unreadable" }]);
  });
});

describe("toDraft: the schema", () => {
  it("refuses an extra top-level property, an extra field property, 41 fields, missing fields", () => {
    expect(toDraft({ fields: [], extra: 1 }, CTX)).toBeNull();
    expect(toDraft({ fields: [{ key: "line:bev", value: "1", confidence: 1, note: "x" }] }, CTX)).toBeNull();
    const many = Array.from({ length: 41 }, () => ({ key: "line:bev", value: "1", confidence: 1 }));
    expect(toDraft({ fields: many }, CTX)).toBeNull();
    expect(toDraft({ fields: many.slice(0, 40) }, CTX)).not.toBeNull();
    expect(toDraft({ reportDate: "2026-11-14" }, CTX)).toBeNull();
  });

  it("refuses a non-object, an array, null, a string", () => {
    for (const raw of [null, undefined, "x", 1, [], [{ fields: [] }], true]) expect(toDraft(raw, CTX)).toBeNull();
  });

  it("refuses a confidence that is not a number", () => {
    expect(toDraft({ fields: [{ key: "line:bev", value: "1", confidence: "high" }] }, CTX)).toBeNull();
  });

  it("a missing confidence is 0 and low; one outside 0-1 is clamped", () => {
    expect(toDraft(one("line:bev", "1", "none"), CTX)!.fields["line:bev"]).toEqual({ value: 1, confidence: 0, low: true, seenAs: "1" });
    expect(toDraft(one("line:bev", "1", 7), CTX)!.fields["line:bev"]).toMatchObject({ confidence: 1, low: false });
    expect(toDraft(one("line:bev", "1", -3), CTX)!.fields["line:bev"]).toMatchObject({ confidence: 0, low: true });
  });

  it("a non-finite confidence is 0 when the schema lets it through", () => {
    for (const c of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = toDraft(one("line:bev", "1", c), CTX);
      if (d !== null) expect(d.fields["line:bev"]).toMatchObject({ confidence: 0, low: true });
    }
  });

  it("refuses an over-long key or value", () => {
    expect(toDraft(one("k".repeat(81), "1"), CTX)).toBeNull();
    expect(toDraft(one("line:bev", "1".repeat(41)), CTX)).toBeNull();
    expect(ExtractionSchema.safeParse(one("k".repeat(80), "1".repeat(40))).success).toBe(true);
  });

  it("keeps only a real YYYY-MM-DD report date", () => {
    const date = (reportDate: unknown) => toDraft({ reportDate, fields: [] }, CTX);
    expect(date(null)!.reportDate).toBeNull();
    expect(date(undefined)!.reportDate).toBeNull();
    expect(date("2026-11-14")!.dateMismatch).toBe(false);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-14", "14/11/2026", "٢٠٢٦-١١-١٤", "0000-00-00", "2025-02-29"]) {
      const d = date(bad)!;
      expect(d.reportDate).toBeNull();
      expect(d.dateMismatch).toBe(false);
    }
    expect(date("2028-02-29")!.reportDate).toBe("2028-02-29");
    expect(date("2026-11-14T00:00")).toBeNull(); // over 10 characters: schema failure
    expect(date("2026-11-14 ")).toBeNull();
  });

  it("cuts a problem key to 40 characters", () => {
    const key = "line:" + "z".repeat(70);
    const d = toDraft(one(key, "1"), CTX)!;
    expect(d.problems).toEqual([{ key: key.slice(0, 40), problem: "unknown_key" }]);
  });

  it("keeps the voice source", () => {
    expect(toDraft({ fields: [] }, { ...CTX, source: "voice" })!.source).toBe("voice");
  });
});

describe("toDraft: hostile keys", () => {
  it("drops prototype-ish keys and pollutes nothing", () => {
    const keys = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "line:__proto__", "line:constructor", "valueOf"];
    const d = toDraft({ fields: keys.map((key) => ({ key, value: "5", confidence: 1 })) }, CTX)!;
    expect(Object.keys(d.fields)).toEqual([]);
    expect(d.problems.map((p) => p.problem)).toEqual(keys.map(() => "unknown_key"));
    expect(Object.hasOwn(d.fields, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(d.fields)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });

  it("refuses an own __proto__ property from JSON.parse anywhere in the reply", () => {
    expect(toDraft(JSON.parse('{"fields":[],"__proto__":{"x":1}}'), CTX)).toBeNull();
    expect(toDraft(JSON.parse('{"fields":[{"key":"line:bev","value":"1","__proto__":{"confidence":1}}]}'), CTX)).toBeNull();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("a duplicate JSON property is whatever JSON.parse kept, still checked", () => {
    const d = toDraft(JSON.parse('{"fields":[{"key":"line:bev","value":"118","value":"-5","confidence":1}]}'), CTX)!;
    expect(d.fields["line:bev"]).toBeUndefined();
    expect(d.problems).toEqual([{ key: "line:bev", problem: "negative" }]);
  });

  it("a key with case or space differences is unknown", () => {
    for (const key of ["CashSales", "cashSales ", " line:bev", "line:BEV", "line.bev", "line:bev‏", "ｃａｓｈSales"]) {
      expect(toDraft(one(key, "5"), CTX)!.problems).toEqual([{ key, problem: "unknown_key" }]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Property-style checks with a small deterministic generator (no fast-check in this project).

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "0", "1", "5", "9", "00", "118", "7", "900", "١", "٥", "٨٢٥٠", "۳", "۹", "١٢٣",
  ",", ".", "٫", "٬", " ", " ", " ", "​", "‌", "‍", "⁠", "﻿",
  "‎", "‏", "‪", "‫", "‮", "⁦", "⁩", "؜",
  "-", "−", "+", "e", "E", "e+", "e-", "x", "0x", "Infinity", "NaN", "O", "l", "ريال", "SAR", "$", "%",
  "１", "２", "𝟏", "½", "²", "Ⅻ", "\t", "\n", "\r", "\u0000", "\uD800", "'", '"', "<b>",
];

function hostile(next: () => number): string {
  const n = Math.floor(next() * 9);
  let s = "";
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(next() * PIECES.length)];
  return s;
}

const UNITS = ["cases", "value"] as const;
const unitAt = (i: number): Unit => UNITS[i % 2]!;
const ANY_DIGIT = /[0-9٠-٩۰-۹]/;

describe("readValue: properties over hostile text", () => {
  it("a value it accepts is exactly parseAmount's reading, within the cap, from text with a digit", () => {
    const next = rng(20261123);
    let accepted = 0;
    for (let i = 0; i < 20000; i++) {
      const text = hostile(next);
      const unit = unitAt(i);
      const r = readValue(text, unit);
      if (r.ok) {
        accepted++;
        expect(ANY_DIGIT.test(text)).toBe(true);
        expect(r.value).toBe(parseAmount(text, unit));
        expect(Number.isSafeInteger(r.value)).toBe(true);
        expect(r.value).toBeGreaterThanOrEqual(0);
        expect(r.value).toBeLessThanOrEqual(unit === "value" ? AMOUNT_MAX : CASES_MAX);
      } else {
        expect(["negative", "too_large", "unreadable"]).toContain(r.problem);
        if (!ANY_DIGIT.test(text) && !/^\s*[-−]/.test(text)) expect(r.problem).toBe("unreadable");
      }
    }
    expect(accepted).toBeGreaterThan(50); // the generator does reach the accepting path
  });

  it("text that parseAmount refuses is never accepted", () => {
    const next = rng(7);
    for (let i = 0; i < 20000; i++) {
      const text = hostile(next);
      const unit = unitAt(i);
      if (parseAmount(text, unit) === null) expect(readValue(text, unit).ok).toBe(false);
    }
  });

  it("a leading minus is always negative, whatever follows", () => {
    const next = rng(99);
    for (let i = 0; i < 2000; i++) {
      const text = (i % 2 ? "-" : "−") + hostile(next);
      expect(readValue(text, unitAt(i))).toEqual({ ok: false, problem: "negative" });
    }
  });
});

describe("readValue: named hostile values", () => {
  const bad = (text: string, unit: Unit = "value") => {
    const r = readValue(text, unit);
    return r.ok ? `ok:${r.value}` : r.problem;
  };

  it("huge digit strings are too_large, never unsafe numbers", () => {
    expect(bad("9".repeat(10000))).toBe("too_large");
    expect(bad("1".repeat(10000), "cases")).toBe("too_large");
    expect(bad("1" + "0".repeat(9999) + ".50")).toBe("too_large");
    expect(bad("١".repeat(10000))).toBe("too_large");
    expect(bad("1,000,".repeat(2000) + "000")).toBe("too_large");
    expect(bad("9007199254740993", "cases")).toBe("too_large");
    expect(bad("90071992547409.93")).toBe("too_large");
  });

  it("leading zeros do not inflate a value", () => {
    expect(bad("0".repeat(10000) + "5", "cases")).toBe("ok:5");
  });

  it("mixed scripts read only as parseAmount reads them", () => {
    expect(bad("١٢3", "cases")).toBe("ok:123");
    expect(bad("١٢۳", "cases")).toBe("ok:123");
    expect(bad("12a3", "cases")).toBe("unreadable");
    expect(bad("١٢O", "cases")).toBe("unreadable");
    expect(bad("１２３", "cases")).toBe("unreadable");
    expect(bad("𝟏𝟐", "cases")).toBe("unreadable");
    expect(bad("½")).toBe("unreadable");
    expect(bad("²")).toBe("unreadable");
  });

  it("direction marks and zero-width characters inside a number make it unreadable", () => {
    for (const mark of ["‎", "‏", "‫", "‮", "⁦", "؜", "​", "‌", "‍", "⁠"]) {
      expect(bad(`${mark}118`, "cases")).toBe("unreadable");
      expect(bad(`1${mark}18`, "cases")).toBe("unreadable");
      expect(bad(`118${mark}`, "cases")).toBe("unreadable");
      expect(bad(`${mark}-150`)).toBe("unreadable");
    }
  });

  it("no-break spaces are thousands separators as for typed input", () => {
    expect(bad("7 900")).toBe("ok:790000");
    expect(bad("7 900.50")).toBe("ok:790050");
    expect(bad(" 150 ", "cases")).toBe("ok:150");
    expect(bad("79 00")).toBe("unreadable");
  });

  it("exponent and other number forms are unreadable", () => {
    for (const t of ["1e5", "1E5", "1e+5", "1e-5", "1e999", "0x10", "Infinity", "NaN", "1_000", "1'000", ".5", "5.", "1.234", "1..2", "1.2.3"]) {
      expect(bad(t)).toBe("unreadable");
    }
  });

  it("signs in odd places", () => {
    expect(bad("-150")).toBe("negative");
    expect(bad("−150")).toBe("negative");
    expect(bad("  -0")).toBe("negative");
    expect(bad("--150")).toBe("negative");
    expect(bad("150-")).toBe("unreadable");
    expect(bad("1-50")).toBe("unreadable");
    expect(bad("+150")).toBe("unreadable");
    expect(bad("(150)")).toBe("unreadable");
    expect(bad("150−")).toBe("unreadable");
  });

  it("a decimal on a cases line is unreadable; two decimals on value are halalas", () => {
    expect(bad("118.5", "cases")).toBe("unreadable");
    expect(bad("118.0", "cases")).toBe("unreadable");
    expect(bad("7,900.00")).toBe("ok:790000");
    expect(bad("7٬900٫50")).toBe("ok:790050");
    expect(bad("7,900.005")).toBe("unreadable");
  });

  it("control characters and lone surrogates are unreadable", () => {
    expect(bad("1\u00000")).toBe("unreadable");
    expect(bad("\uD800118")).toBe("unreadable");
  });
});

describe("readValue: linear time", () => {
  it("100 000-character values finish quickly", () => {
    const huge = [
      "9".repeat(100_000),
      "0".repeat(100_000),
      "1,".repeat(50_000),
      ",1".repeat(50_000),
      "1,000".repeat(20_000),
      "١".repeat(100_000),
      " ".repeat(100_000),
      "a".repeat(100_000),
      "-".repeat(100_000),
      "1.".repeat(50_000),
      "0".repeat(99_999) + "x",
      "1" + " 000".repeat(25_000) + "x",
    ];
    for (const text of huge) {
      for (const unit of UNITS) {
        const start = performance.now();
        const r = readValue(text, unit);
        expect(performance.now() - start).toBeLessThan(200);
        if (r.ok) expect(r.value).toBe(parseAmount(text, unit));
      }
    }
  });

  it("toDraft refuses a 100 000-character value at the schema, quickly", () => {
    const start = performance.now();
    expect(toDraft(one("line:bev", "1".repeat(100_000)), CTX)).toBeNull();
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("toDraft: properties over hostile replies", () => {
  const KEYS = ["line:bev", "line:food", "line:coll", "collections", "cashSales", "creditSales", "expenses", "loaded", "sold", "returned", "line:zzz", "__proto__", "constructor", "line:", ""];

  it("every kept field is an allowed key, read by parseAmount from one of the reply's values", () => {
    const next = rng(4242);
    const allowed = new Set<string>(draftKeys(LINES).map((k) => k.key));
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(next() * 12);
      const fields = Array.from({ length: n }, () => {
        const value = next() < 0.5 ? String(Math.floor(next() * 5000)) : hostile(next).slice(0, 40);
        return { key: KEYS[Math.floor(next() * KEYS.length)], value, confidence: next() * 1.4 - 0.2 };
      });
      const d = toDraft({ fields }, CTX)!;
      expect(d).not.toBeNull();
      for (const [key, f] of Object.entries(d.fields)) {
        expect(allowed.has(key)).toBe(true);
        const unit = key === "line:bev" || ["loaded", "sold", "returned"].includes(key) ? "cases" : "value";
        const raw = fields.filter((r) => r.key === key || (key === "line:coll" && r.key === "collections"));
        expect(raw.some((r) => parseAmount(r.value, unit) === f!.value && r.value === f!.seenAs)).toBe(true);
        expect(f!.confidence).toBeGreaterThanOrEqual(0);
        expect(f!.confidence).toBeLessThanOrEqual(1);
        if (f!.confidence < LOW_CONFIDENCE) expect(f!.low).toBe(true);
      }
      expect(Object.keys(d.fields).length + d.problems.length).toBeLessThanOrEqual(n);
      expect(d.fields.collections).toBeUndefined();
    }
    expect(({} as Record<string, unknown>).confidence).toBeUndefined();
  });
});
