import { describe, expect, it } from "vitest";
import { AMOUNT_MAX, CASES_MAX } from "@/domain/money";
import { vocabulary, type VocabularyEntry, type VocabularyLine } from "./aliases";
import type { DraftLine } from "./draft";
import { toDraft } from "./extraction";
import { parseSpokenClose } from "./transcript";

const LINES = [
  { lineId: "bev", code: "bev", unit: "cases", kind: "sales", nameAr: "مشروبات", nameEn: "Beverages", nameUr: "مشروبات" },
  { lineId: "food", code: "food", unit: "value", kind: "sales", nameAr: "أغذية", nameEn: "Food", nameUr: "اشیائے خوردونوش" },
  { lineId: "coll", code: "coll", unit: "value", kind: "collection", nameAr: "تحصيل", nameEn: "Collection", nameUr: "وصولی" },
] satisfies VocabularyLine[];
const DRAFT_LINES: DraftLine[] = LINES.map(({ lineId, code, unit, kind }) => ({ lineId, code, unit, kind }));
const VOCAB = vocabulary(LINES, {});
const V1 = "مشروبات مية وعشرين كرتونة، أغذية ٨٢٥٠ ريال، تحصيل عشرين ألف، نقدي خمسة آلاف وخمسمية";

const parse = (text: string, vocab: VocabularyEntry[] = VOCAB) => parseSpokenClose(text, vocab);
const fieldsOf = (text: string, vocab: VocabularyEntry[] = VOCAB) =>
  Object.fromEntries(parse(text, vocab).fields.map((f) => [f.key, f.value]));
const draftOf = (text: string) => toDraft({ reportDate: null, fields: parse(text).fields }, { source: "voice", date: "2026-11-14", lines: DRAFT_LINES });
const draftValues = (text: string) => Object.fromEntries(Object.entries(draftOf(text)?.fields ?? {}).map(([k, f]) => [k, f?.value]));

describe("parseSpokenClose: the plan's values", () => {
  it("reads V1 with the R29 vocabulary", () => {
    expect(VOCAB.find((e) => e.key === "cashSales")!.labels).toContain("نقدي");
    expect(parse(V1)).toEqual({
      fields: [
        { key: "line:bev", value: "120", confidence: 0.9 },
        { key: "line:food", value: "8250", confidence: 0.9 },
        { key: "line:coll", value: "20000", confidence: 0.9 },
        { key: "cashSales", value: "5500", confidence: 0.9 },
      ],
      unassigned: 0,
    });
  });

  it("V1 through toDraft gives bev 120, food 825 000, coll 2 000 000, cash 550 000", () => {
    const d = draftOf(V1)!;
    expect(draftValues(V1)).toEqual({ "line:bev": 120, "line:food": 825_000, "line:coll": 2_000_000, cashSales: 550_000 });
    expect(d.problems).toEqual([]);
    expect(Object.values(d.fields).every((f) => f?.low === false)).toBe(true);
  });

  it("assigns a number to the one label right after it with confidence 0.6", () => {
    expect(parse("مية وعشرين كرتونة مشروبات")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.6 }], unassigned: 0 });
  });

  it("appends .50 for a half on a value field and drops it on a cases field", () => {
    // A half on money is low (R76), so the rep confirms it.
    expect(parse("أغذية مية وخمسة وعشرين ونص").fields).toEqual([{ key: "line:food", value: "125.50", confidence: 0.5 }]);
    expect(draftValues("أغذية مية وخمسة وعشرين ونص")).toEqual({ "line:food": 12_550 });
    expect(parse("مشروبات مية وعشرين ونص").fields).toEqual([]);
  });

  it("gives a number to the label before it, not to the label after it", () => {
    // The trailing label has no number: it counts as unassigned so the model is asked (R77).
    expect(parse("مشروبات مية أغذية")).toEqual({ fields: [{ key: "line:bev", value: "100", confidence: 0.9 }], unassigned: 1 });
  });

  it("gives nothing for speech without numbers", () => {
    expect(parse("يعني النهارده كان يوم كويس")).toEqual({ fields: [], unassigned: 0 });
  });

  it("counts numbers without a label as unassigned", () => {
    expect(parse("بعت 300 و 500")).toEqual({ fields: [], unassigned: 2 });
  });

  it("reads the extra transcript (R27): bev 120 (low: another number follows it) and 300 left over", () => {
    expect(parse("مشروبات مية وعشرين وبعت كمان 300")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.5 }], unassigned: 1 });
  });

  it("finishes 5000 characters of و in under 50 ms", () => {
    const t0 = performance.now();
    expect(parse("و".repeat(5000))).toEqual({ fields: [], unassigned: 0 });
    expect(parse("و ".repeat(5000))).toEqual({ fields: [], unassigned: 0 });
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("parseSpokenClose: ambiguity gives no field", () => {
  it("a label with a number on each side keeps neither", () => {
    expect(parse("مية كرتونة مشروبات تلاتين")).toEqual({ fields: [], unassigned: 2 });
  });

  it("a second number after a label is left over, never attached past the first", () => {
    expect(parse("مشروبات 120 كمان 130")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.5 }], unassigned: 1 });
    expect(parse("مشروبات 120 130")).toEqual({ fields: [], unassigned: 1 }); // a spaced thousands group (R76)
  });

  it("numbers before the first label: only one directly before it, nothing past another number", () => {
    expect(parse("120 كمان 130 مشروبات")).toEqual({ fields: [], unassigned: 3 }); // two numbers and the label no number reached
    expect(parse("120 بعت مشروبات")).toEqual({ fields: [], unassigned: 2 });
  });

  it("a number after a label that already has one is not moved to the next label", () => {
    expect(parse("مشروبات 120 كمان 130 أغذية")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.5 }], unassigned: 2 }); // the 130 and the label أغذية
  });

  it("a run that does not parse blocks the number after it and counts as left over", () => {
    expect(parse("مشروبات 8250,50 كمان 300")).toEqual({ fields: [], unassigned: 2 });
    expect(parse("مشروبات 8250,50 300")).toEqual({ fields: [], unassigned: 1 }); // one unreadable run
    expect(parse("مشروبات مية عشرين")).toEqual({ fields: [], unassigned: 1 });
    expect(parse("أغذية ألف ونص")).toEqual({ fields: [], unassigned: 1 });
  });

  it("a run that does not parse after a label spoils a number before the label too", () => {
    expect(parse("120 كرتونة مشروبات مية عشرين")).toEqual({ fields: [], unassigned: 2 });
  });

  it("one key said twice with different numbers gives nothing; the same number twice is kept", () => {
    expect(parse("مشروبات 120 أغذية 300 مشروبات 130")).toEqual({ fields: [{ key: "line:food", value: "300", confidence: 0.9 }], unassigned: 2 });
    expect(parse("مشروبات 120 مشروبات 120").fields).toEqual([{ key: "line:bev", value: "120", confidence: 0.9 }]);
  });

  it("a key with one mention claimed ambiguously gives nothing, even from its other mention", () => {
    expect(parse("نقدي 120 130 مشروبات 5 نقدي 999").fields).toEqual([{ key: "line:bev", value: "5", confidence: 0.9 }]);
    expect(parse("120 نقدي 300 نقدي 999").fields).toEqual([]);
  });

  it("a label that names two keys is a label for neither", () => {
    const vocab = vocabulary(LINES, { cashSales: ["بيع"], creditSales: ["بيع"] });
    expect(parse("بيع 500", vocab)).toEqual({ fields: [], unassigned: 1 });
  });

  it("a half on a cases line drops the field and leaves the number over", () => {
    expect(parse("مشروبات خمسة ونص كمان")).toEqual({ fields: [], unassigned: 1 });
  });
});

describe("parseSpokenClose: labels", () => {
  it("prefers the longest label", () => {
    const vocab: VocabularyEntry[] = [
      { key: "cashSales", unit: "value", labels: ["نقدي"] },
      { key: "creditSales", unit: "value", labels: ["بيع نقدي آجل"] },
    ];
    expect(fieldsOf("بيع نقدي آجل 300 نقدي 200", vocab)).toEqual({ creditSales: "300", cashSales: "200" });
  });

  it("reads بيع نقدي as cash sales, not as a label then a stray word", () => {
    expect(fieldsOf("بيع نقدي 14800 بيع آجل 3200 مصاريف 150")).toEqual({ cashSales: "14800", creditSales: "3200", expenses: "150" });
  });

  it("accepts a label with a leading و or ال", () => {
    expect(fieldsOf("مشروبات 120 والأغذية 8250 وتحصيل 20000")).toEqual({ "line:bev": "120", "line:food": "8250", "line:coll": "20000" });
  });

  it("matches English labels and codes ignoring case", () => {
    expect(fieldsOf("Beverages one hundred and twenty, FOOD 8,250 cash 5500")).toEqual({ "line:bev": "120", "line:food": "8250", cashSales: "5500" });
  });

  it("matches the Urdu names (Urdu letters normalised)", () => {
    expect(fieldsOf("اشیائے خوردونوش 8250 وصولی 20000")).toEqual({ "line:food": "8250", "line:coll": "20000" });
  });

  it("a digit inside a label is part of the label, not a number", () => {
    const vocab: VocabularyEntry[] = [
      { key: "line:can185", unit: "cases", labels: ["علب 185 مل"] },
      { key: "line:can250", unit: "cases", labels: ["علب 250 مل"] },
    ];
    expect(parse("علب 185 مل خمسين علب 250 مل تلاتين كرتونة", vocab)).toEqual({
      fields: [
        { key: "line:can185", value: "50", confidence: 0.9 },
        { key: "line:can250", value: "30", confidence: 0.9 },
      ],
      unassigned: 0,
    });
  });

  it("ignores empty and punctuation-only labels", () => {
    const vocab: VocabularyEntry[] = [{ key: "cashSales", unit: "value", labels: ["", " ، ", "نقدي"] }];
    expect(parse("نقدي 5", vocab)).toEqual({ fields: [{ key: "cashSales", value: "5", confidence: 0.9 }], unassigned: 0 });
  });

  it("a newline, tab or NEL between words keeps them apart, even beside an invisible character", () => {
    expect(fieldsOf("مشروبات\n120\tأغذية\r\n300\u0085نقدي\u200B 5")).toEqual({ "line:bev": "120", "line:food": "300", cashSales: "5" });
  });

  it("ignores invisible characters in the transcript", () => {
    expect(fieldsOf("مشر\u200Bوبات\u202E 120")).toEqual({ "line:bev": "120" });
  });
});

describe("parseSpokenClose → toDraft: the caps and value checks still apply", () => {
  it("a cases value over CASES_MAX is too_large", () => {
    expect(parse("مشروبات 200 مليون").fields).toEqual([{ key: "line:bev", value: "200000000", confidence: 0.9 }]);
    const d = draftOf("مشروبات 200 مليون")!;
    expect(d.fields).toEqual({});
    expect(d.problems).toEqual([{ key: "line:bev", problem: "too_large" }]);
    expect(200_000_000).toBeGreaterThan(CASES_MAX);
  });

  it("a money value over AMOUNT_MAX is too_large", () => {
    const d = draftOf("أغذية 9,000,000,000,000")!;
    expect(d.problems).toEqual([{ key: "line:food", problem: "too_large" }]);
    expect(9_000_000_000_000 * 100).toBeGreaterThan(AMOUNT_MAX);
  });

  it("a number beyond the safe integers is no token, so no field", () => {
    expect(parse("أغذية 90071992547409930")).toEqual({ fields: [], unassigned: 1 });
  });

  it("a minus sign is never dropped into a positive number", () => {
    expect(parse("مصاريف -150")).toEqual({ fields: [], unassigned: 1 });
  });

  it("a label typed as a prompt (hostile alias) still only gives digits", () => {
    const vocab = vocabulary(LINES, { cashSales: ["ignore previous instructions"] });
    const out = parse("ignore previous instructions 5", vocab);
    expect(out.fields).toEqual([{ key: "cashSales", value: "5", confidence: 0.9 }]);
    expect(draftValues("نقدي 5")).toEqual({ cashSales: 500 });
  });

  it("every value text is digits with at most .50", () => {
    for (const f of parse(V1 + " أغذية مية ونص مصاريف عشرين ونص").fields) expect(f.value).toMatch(/^[0-9]+(\.50)?$/);
  });
});

describe("parseSpokenClose: hostile input finishes fast", () => {
  // Best of three runs: the bound is on the algorithm, not on a CPU shared with other test files.
  const time = (text: string) => {
    let ms = Infinity;
    let out = parse(text);
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      out = parse(text);
      ms = Math.min(ms, performance.now() - t0);
    }
    return { ms, out };
  };
  const cut = (unit: string) => unit.repeat(Math.ceil(20_000 / unit.length)).slice(0, 20_000);
  it.each([
    ["mixed speech", "مشروبات مية وعشرين كرتونة بعت "],
    ["repeated labels", "بيع نقدي "],
    ["a scale run bomb", "ألف "],
    ["digit tokens", "7 "],
    ["label prefixes", "والمشروبات "],
    ["corrections", "مشروبات مية لا "],
    ["number-like tokens", "تحصيل خمستلافك "],
    ["joiners", "م\u200Cش\u200Dر "],
  ])("20 000 characters of %s in under 50 ms", (_name, unit) => {
    expect(time(cut(unit)).ms).toBeLessThan(50);
  });
  it("gives the expected result on repeated speech", () => {
    expect(parse("مشروبات مية وعشرين كرتونة بعت ".repeat(1000)).fields).toEqual([{ key: "line:bev", value: "120", confidence: 0.9 }]);
    expect(parse("بيع نقدي ".repeat(1000))).toEqual({ fields: [], unassigned: 1000 }); // every label is a mention with no number (R77)
    expect(parse("نقدي " + "ألف ".repeat(5000))).toEqual({ fields: [], unassigned: 1 });
    const many = parse("نقدي " + "7 ".repeat(5000));
    expect(many.fields).toEqual([{ key: "cashSales", value: "7", confidence: 0.5 }]);
    expect(many.unassigned).toBe(4999);
  });
  it("hostile 100 000 tokens finish in under 2 s", () => {
    const t0 = performance.now();
    parse("مشروبات مية وعشرين كرتونة لا ".repeat(20_000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it("does not overflow the stack on 400 000 numbers or 200 000 repeats of one label and number", () => {
    expect(parse("نقدي " + "7 ".repeat(400_000)).unassigned).toBe(399_999);
    expect(parse("نقدي 7 ".repeat(200_000)).fields).toEqual([{ key: "cashSales", value: "7", confidence: 0.9 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property-style checks: deterministic shuffles of labels, numbers, unit words and filler words.

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

const LABELS: { key: string; text: string; unit: "cases" | "value" }[] = [
  { key: "line:bev", text: "مشروبات", unit: "cases" },
  { key: "line:food", text: "أغذية", unit: "value" },
  { key: "line:coll", text: "تحصيل", unit: "value" },
  { key: "cashSales", text: "نقدي", unit: "value" },
  { key: "creditSales", text: "بيع آجل", unit: "value" },
  { key: "expenses", text: "مصاريف", unit: "value" },
  { key: "loaded", text: "تحميل", unit: "cases" },
  { key: "returned", text: "مرتجعات", unit: "cases" },
];
// Each spoken form names exactly one value; none starts with a scale word, so two of them side by
// side never combine into another valid number.
const NUMBERS: { value: number; text: string }[] = [
  { value: 120, text: "مية وعشرين" },
  { value: 8250, text: "٨٢٥٠" },
  { value: 345, text: "تلتمية وخمسة وأربعين" },
  { value: 20000, text: "عشرين ألف" },
  { value: 5500, text: "خمسة آلاف وخمسمية" },
  { value: 13, text: "تلاتاشر" },
  { value: 1140, text: "1,140" },
  { value: 77, text: "سبعة وسبعين" },
  { value: 999, text: "تسعمية وتسعة وتسعين" },
  { value: 42, text: "42" },
  { value: 250300, text: "ميتين وخمسين ألف وتلتمية" },
  { value: 61, text: "واحد وستين" },
];
const FILLER = ["بعت", "كمان", "النهارده", "يعني", "تقريبا"];
/** The fillers on the R77 list; `كمان` and `تقريبا` are not, so a number next to them is 0.5. */
const TIDY_FILLER = new Set(["بعت", "النهارده", "يعني"]);
const UNITS = ["كرتونة", "ريال", "كراتين"];

type Item = { t: "m"; label: number } | { t: "n"; num: number };

/** The rules of parseSpokenClose on the abstract sequence (fillers and unit words are not items). */
function oracle(items: Item[], unitsOnlyBefore: (i: number) => boolean, tidy: (i: number) => boolean): { fields: Record<string, string>; confidences: Record<string, number>; unassigned: number } {
  const cands = new Map<number, { num: number; conf: number }[]>();
  items.forEach((it, i) => {
    if (it.t !== "n") return;
    const prev = items[i - 1];
    const clean = tidy(i) && (i + 1 >= items.length || tidy(i + 1));
    if (prev?.t === "m") cands.set(i - 1, [...(cands.get(i - 1) ?? []), { num: it.num, conf: items[i + 1]?.t === "n" || !clean ? 0.5 : 0.9 }]);
    else if (i === 0 && items[1]?.t === "m" && unitsOnlyBefore(1)) cands.set(1, [...(cands.get(1) ?? []), { num: it.num, conf: 0.6 }]);
  });
  const byKey = new Map<string, { value: number; conf: number }[]>();
  const spoiled = new Set<string>();
  for (const [mi, list] of cands) {
    const key = LABELS[(items[mi] as { label: number }).label]!.key;
    if (list.length !== 1) {
      spoiled.add(key);
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), { value: NUMBERS[list[0]!.num]!.value, conf: list[0]!.conf }]);
  }
  const fields: Record<string, string> = {};
  const confidences: Record<string, number> = {};
  let used = 0;
  for (const [key, list] of byKey) {
    if (spoiled.has(key)) continue;
    if (!list.every((x) => x.value === list[0]!.value)) continue;
    fields[key] = String(list[0]!.value);
    confidences[key] = Math.min(...list.map((x) => x.conf));
    used += list.length;
  }
  const numbers = items.filter((i) => i.t === "n").length;
  // A label no number was assigned to or claimed for counts too (R77).
  const bare = items.filter((it, i) => it.t === "m" && !cands.has(i)).length;
  return { fields, confidences, unassigned: numbers - used + bare };
}

describe("parseSpokenClose: property checks over shuffled transcripts", () => {
  it("matches the assignment rules exactly on 3000 shuffled transcripts", () => {
    const r = rng(20261124);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    for (let round = 0; round < 3000; round++) {
      const length = 1 + Math.floor(r() * 9);
      const items: Item[] = [];
      for (let i = 0; i < length; i++) items.push(r() < 0.5 ? { t: "m", label: Math.floor(r() * LABELS.length) } : { t: "n", num: Math.floor(r() * NUMBERS.length) });
      const words: string[] = [];
      const gapIsUnitsOnly: boolean[] = [];
      const gapTidy: boolean[] = [];
      items.forEach((it, i) => {
        let unitsOnly = true;
        gapTidy[i] = true;
        if (i > 0) {
          // Two numbers side by side always get a filler word between them (else they could be one run).
          const needFiller = it.t === "n" && items[i - 1]!.t === "n";
          if (needFiller || r() < 0.3) {
            const filler = pick(FILLER);
            words.push(filler);
            unitsOnly = false;
            gapTidy[i] = TIDY_FILLER.has(filler);
          }
          if (r() < 0.4) words.push(pick(UNITS));
        }
        gapIsUnitsOnly[i] = unitsOnly;
        words.push(it.t === "m" ? LABELS[it.label]!.text : NUMBERS[it.num]!.text);
      });
      const text = words.join(r() < 0.5 ? " " : "، ");
      const want = oracle(items, (i) => gapIsUnitsOnly[i]!, (i) => gapTidy[i]!);
      const got = parseSpokenClose(text, VOCAB);
      // Only bev, food, coll and the default keys are in VOCAB; every LABELS key is one of them.
      const gotFields = Object.fromEntries(got.fields.map((f) => [f.key, f.value]));
      // Half never occurs here, so the expected value text is the plain integer.
      expect({ text, fields: gotFields, unassigned: got.unassigned }).toEqual({ text, fields: want.fields, unassigned: want.unassigned });
      for (const f of got.fields) expect({ text, key: f.key, c: f.confidence }).toEqual({ text, key: f.key, c: want.confidences[f.key] });
    }
  });

  it("never attaches a number across another label or number, whatever is side by side", () => {
    const r = rng(7);
    for (let round = 0; round < 3000; round++) {
      const length = 1 + Math.floor(r() * 10);
      const items: Item[] = [];
      for (let i = 0; i < length; i++) items.push(r() < 0.5 ? { t: "m", label: Math.floor(r() * LABELS.length) } : { t: "n", num: Math.floor(r() * NUMBERS.length) });
      // No filler at all: numbers may sit side by side and merge into a run that does not parse.
      const text = items.map((it) => (it.t === "m" ? LABELS[it.label]!.text : NUMBERS[it.num]!.text)).join(" ");
      const allowed = oracle(items, () => true, () => true);
      const got = parseSpokenClose(text, VOCAB);
      for (const f of got.fields) expect({ text, key: f.key, value: f.value }).toEqual({ text, key: f.key, value: allowed.fields[f.key] });
      expect(got.unassigned).toBeLessThanOrEqual(items.length);
    }
  });

  it("a label with a number on both sides never gets either, in any order of the rest", () => {
    const r = rng(99);
    for (let round = 0; round < 500; round++) {
      const a = NUMBERS[Math.floor(r() * NUMBERS.length)]!;
      const b = NUMBERS[Math.floor(r() * NUMBERS.length)]!;
      const l = LABELS[Math.floor(r() * LABELS.length)]!;
      const out = parseSpokenClose(`${a.text} ${r() < 0.5 ? "كرتونة " : ""}${l.text} ${b.text}`, VOCAB);
      expect(out.fields).toEqual([]);
      expect(out.unassigned).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 1 (R76): the reviewer's inputs. Each gives the right value or no field with the
// number counted as unassigned; never a wrong value.

type Want = [string, Record<string, string>, number] | [string, Record<string, string>, number, number];
const check = (rows: Want[], vocab: VocabularyEntry[] = VOCAB) => {
  for (const [text, fields, unassigned, confidence] of rows) {
    const got = parse(text, vocab);
    expect({ text, fields: Object.fromEntries(got.fields.map((f) => [f.key, f.value])), unassigned: got.unassigned }).toEqual({ text, fields, unassigned });
    if (confidence !== undefined) for (const f of got.fields) expect({ text, c: f.confidence }).toEqual({ text, c: confidence });
  }
};

describe("fix round 1 (R76): count words the tables did not read", () => {
  it("reads ميت before ألف, digit hundreds, glued thousands, ثماني and teen variants", () => {
    check([
      ["تحصيل ميت الف", { "line:coll": "100000" }, 0, 0.9],
      ["تحصيل ميت ألف ريال", { "line:coll": "100000" }, 0],
      ["تحصيل خمسميت ألف", { "line:coll": "500000" }, 0],
      ["مشروبات 3 مية", { "line:bev": "300" }, 0],
      ["أغذية 5 مية ريال", { "line:food": "500" }, 0],
      ["تحصيل 3 مية الف", { "line:coll": "300000" }, 0],
      ["تحصيل خمستلاف وخمسمية", { "line:coll": "5500" }, 0],
      ["تحصيل تلاتلاف وخمسمية", { "line:coll": "3500" }, 0],
      ["تحصيل خمستالاف", { "line:coll": "5000" }, 0],
      ["تحصيل ستلاف", { "line:coll": "6000" }, 0],
      ["تحصيل اربعتلاف", { "line:coll": "4000" }, 0],
      ["تحصيل تسعتلاف", { "line:coll": "9000" }, 0],
      ["تحصيل عشرتلاف", { "line:coll": "10000" }, 0],
      ["أغذية ثمانيمائة وخمسين", { "line:food": "850" }, 0],
      ["مشروبات ثماني مئة", { "line:bev": "800" }, 0],
      ["تحصيل خمستعشر الف", { "line:coll": "15000" }, 0],
      ["تحصيل اربعطاشر الف", { "line:coll": "14000" }, 0],
      ["تحصيل حدعشر الف", { "line:coll": "11000" }, 0],
      ["تحصيل اتنعشر ألف", { "line:coll": "12000" }, 0],
      ["مشروبات سبعطاشر", { "line:bev": "17" }, 0],
      ["مشروبات تسعطاشر", { "line:bev": "19" }, 0],
      ["مشروبات ستطاشر", { "line:bev": "16" }, 0],
      ["مشروبات اطنعش", { "line:bev": "12" }, 0],
      ["مشروبات سبعطعشر", { "line:bev": "17" }, 0],
      ["مشروبات تسعتعشر", { "line:bev": "19" }, 0],
      ["تحصيل ألف وعشر", { "line:coll": "1010" }, 0],
      ["تحصيل خمسة آلاف وعشر", { "line:coll": "5010" }, 0],
      ["مشروبات مية وعشر", { "line:bev": "110" }, 0],
    ]);
  });

  it("digits times a scale in exact integers", () => {
    check([
      ["تحصيل 2 مليون", { "line:coll": "2000000" }, 0],
      ["تحصيل 3 مليون", { "line:coll": "3000000" }, 0],
      ["تحصيل 5 ألف", { "line:coll": "5000" }, 0],
      ["تحصيل 1.5 مليون", { "line:coll": "1500000" }, 0],
      ["تحصيل 2.5 ألف", { "line:coll": "2500" }, 0],
      ["تحصيل 1.25 مليون", {}, 1],
      ["تحصيل 2 ألفين", {}, 1],
    ]);
  });

  it("a fraction of a scale, a hundred after نص/ربع/تلت, or an unknown count word gives no field", () => {
    check([
      ["تحصيل نص مليون", {}, 1],
      ["تحصيل ربع مليون", {}, 1],
      ["أغذية نص الف", {}, 1],
      ["تحصيل تلت مليون", {}, 1],
      ["مشروبات ربع مية", {}, 1],
      ["مشروبات تلت مية", {}, 1],
      ["مشروبات خمس", {}, 1],
      ["مشروبات ست", {}, 1],
      ["مرتجع تلات", {}, 1],
      ["مشروبات عشر", {}, 1],
      ["تحصيل كمان الف", {}, 1],
      ["تحصيل سبعميت", {}, 1],
      ["تحصيل خمسالاف", { "line:coll": "5000" }, 0],
      ["تحصيل تمانيلاف", {}, 1],
      ["مشروبات ومية", {}, 1],
      ["مشروبات و مية", {}, 1],
    ]);
  });

  it("does not take ordinary words that end like a number for numbers", () => {
    check([
      ["مشروبات الكمية مية", { "line:bev": "100" }, 0],
      ["مشروبات يومية مية", { "line:bev": "100" }, 0],
      ["أغذية بدون خلاف 300", { "line:food": "300" }, 0],
      ["ست الحبايب مشروبات مية", { "line:bev": "100" }, 0],
    ]);
  });
});

describe("fix round 1 (R76): digit groups and fractions", () => {
  it("a digit followed by 3-digit groups (a spaced thousands separator) is one unreadable run", () => {
    check([
      ["مشروبات ٣ ٠٠٠", {}, 1],
      ["تحصيل 20 000", {}, 1],
      ["تحصيل ٢٠ ٠٠٠", {}, 1],
      ["تحصيل 1 200 000", {}, 1],
      ["تحصيل 20 000", {}, 1],
      ["تحصيل 20 000", {}, 1],
    ]);
  });

  it("only .0, .00, .5 and .50 are read; a leading dot is unreadable", () => {
    check([
      ["أغذية 5.000", {}, 1],
      ["أغذية ١٢٫٠٠٠", {}, 1],
      ["أغذية 1.500", {}, 1],
      ["أغذية 5.0", { "line:food": "5" }, 0],
      ["أغذية 5.00", { "line:food": "5" }, 0],
      ["أغذية 7,900.00", { "line:food": "7900" }, 0],
      ["أغذية .5", {}, 1],
      ["أغذية ٫٥", {}, 1],
    ]);
  });
});

describe("fix round 1 (R76): corrections, decimal words, units then و", () => {
  it("a correction or decimal word after a label spoils it", () => {
    check([
      ["مشروبات مية لا خمسين", {}, 2],
      ["مشروبات مية لأ قصدي ميتين", {}, 2],
      ["مشروبات مش مية", {}, 1],
      ["مشروبات بدل مية خمسين", {}, 1],
      ["مشروبات تقريبا خمسين لأ ستين", {}, 2],
      ["مشروبات مية اقصد ميتين", {}, 2],
      ["أغذية ثلاثة فاصلة خمسة", {}, 2],
      ["food three point five", {}, 2],
      ["food 300 no 400", {}, 2],
      ["food 300 I mean 400", {}, 2],
    ]);
  });

  it("a unit word followed by a joined number makes the run unreadable", () => {
    check([
      ["تحصيل عشرين ألف ريال وخمسمية", {}, 1],
      ["أغذية الف ريال وخمسمية", {}, 1],
      ["تحصيل عشرين ألف ريال وخمسمية ريال", {}, 1],
      ["تحصيل عشرين ألف ريال و 500", {}, 1],
    ]);
  });

  it("a second number in the same gap makes the first one low (0.5)", () => {
    check([
      ["مشروبات كان المفروض ميتين بس بعت مية", { "line:bev": "200" }, 1, 0.5],
      ["تحصيل الفين من عشرين الف", { "line:coll": "2000" }, 1, 0.5],
      ["مشروبات 50 50", { "line:bev": "50" }, 1, 0.5],
      ["أغذية ٨٢٥٠ و ٥٠٠", { "line:food": "8250" }, 1, 0.5],
    ]);
  });

  it("a half on a value key is low (0.5)", () => {
    check([
      ["أغذية خمسة ونص", { "line:food": "5.50" }, 0, 0.5],
      ["أغذية 250 ونص", { "line:food": "250.50" }, 0, 0.5],
      ["food twenty and half", { "line:food": "20.50" }, 0, 0.5],
      ["أغذية 0.5", { "line:food": "0.50" }, 0, 0.5],
    ]);
  });
});

describe("fix round 1 (R76): labels that read as numbers are not labels", () => {
  const W = vocabulary(
    [
      { lineId: "w", code: "w", unit: "cases", kind: "sales", nameAr: "مية", nameEn: "Water", nameUr: "پانی" },
      { lineId: "bev", code: "330", unit: "cases", kind: "sales", nameAr: "مشروبات", nameEn: "Beverages", nameUr: "مشروبات" },
    ],
    {},
  );
  it("a line named مية or coded 330 is found only by its other names", () => {
    check(
      [
        ["مية مية وعشرين", {}, 1],
        ["مية خمسين مشروبات عشرين", {}, 2], // the unreadable run right before the label claims it too
        ["مشروبات 330 كرتونة", { "line:330": "330" }, 0],
        ["330 مية", {}, 1],
        ["water 12", { "line:w": "12" }, 0],
      ],
      W,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2 (R77): the probe families. A field is 0.9 only when the words around its number are
// harmless filler; accusative thousands and feminine teens are read or refused; quarters, signs and
// comparators never reach the rep as a clean number.

const highOf = (text: string) => Object.fromEntries(parse(text).fields.filter((f) => f.confidence >= 0.8).map((f) => [f.key, f.value]));
/** Every row reads as exactly these fields at confidence 0.9, nothing left over. */
const readAt09 = (rows: [string, Record<string, string>][]) => {
  for (const [text, fields] of rows) {
    const got = parse(text);
    expect({ text, fields: Object.fromEntries(got.fields.map((f) => [f.key, f.value])), unassigned: got.unassigned }).toEqual({ text, fields, unassigned: 0 });
    expect({ text, c: got.fields.map((f) => f.confidence) }).toEqual({ text, c: got.fields.map(() => 0.9) });
  }
};
/** Every row gives no field and at least one unassigned item. */
const refused = (rows: string[]) => {
  for (const text of rows) {
    const got = parse(text);
    expect({ text, fields: got.fields, more: got.unassigned >= 1 }).toEqual({ text, fields: [], more: true });
  }
};
/** Every row gives exactly one field, read but low (0.5). */
const lowRows = (rows: [string, string, string][]) => {
  for (const [text, key, value] of rows) expect({ text, fields: parse(text).fields }).toEqual({ text, fields: [{ key, value, confidence: 0.5 }] });
};

describe("fix round 2 (R77) A: accusative thousands", () => {
  it("reads ألفا / ألفاً / آلافا as a thousand scale", () => {
    readAt09([
      ["تحصيل خمسين ألفا", { "line:coll": "50000" }],
      ["تحصيل عشرين ألفاً", { "line:coll": "20000" }],
      ["تحصيل ثلاثون ألفا", { "line:coll": "30000" }],
      ["تحصيل مئة ألفا", { "line:coll": "100000" }],
      ["تحصيل ثلاثة عشر ألفا", { "line:coll": "13000" }],
      ["تحصيل ثلاثة وعشرين ألفا", { "line:coll": "23000" }],
      ["تحصيل ثلاثمئة وخمسون ألفا", { "line:coll": "350000" }],
      ["تحصيل اثنا عشر ألفا", { "line:coll": "12000" }],
      ["تحصيل خمسة وعشرين ألفاً", { "line:coll": "25000" }],
      ["تحصيل أربعة وخمسين ألفا وخمسمائة", { "line:coll": "54500" }],
      ["تحصيل خمسة آلافا", { "line:coll": "5000" }],
    ]);
  });
  it("a lone ألفا, or one after a count it cannot take, is unread and counted", () => {
    refused(["تحصيل ألفا", "تحصيل ألفاً", "تحصيل خمسة ألفا", "تحصيل ألفا ألفا"]);
  });
});

describe("fix round 2 (R77) B: feminine MSA teens", () => {
  it("reads إحدى/اثنتا/اثنتي عشرة and the feminine teens, never 10", () => {
    readAt09([
      ["تحصيل إحدى عشرة", { "line:coll": "11" }],
      ["تحصيل احدى عشر", { "line:coll": "11" }],
      ["تحصيل إحدى عشر ألفا", { "line:coll": "11000" }],
      ["مشروبات إحدى عشرة كرتونة", { "line:bev": "11" }],
      ["مشروبات اثنتا عشرة", { "line:bev": "12" }],
      ["مشروبات اثنتي عشرة", { "line:bev": "12" }],
      ["مشروبات ثلاث عشرة", { "line:bev": "13" }],
      ["مشروبات أربع عشرة", { "line:bev": "14" }],
      ["مشروبات خمس عشرة", { "line:bev": "15" }],
      ["مشروبات تسع عشرة", { "line:bev": "19" }],
      ["مشروبات ثماني عشرة", { "line:bev": "18" }],
      ["مشروبات ثمان عشرة", { "line:bev": "18" }],
      ["مشروبات عشرة", { "line:bev": "10" }],
      ["مشروبات كرتونة عشرة", { "line:bev": "10" }],
    ]);
  });
  it("a bare عشرة after an unread word is unreadable, not 10", () => {
    refused(["مشروبات اثنتان عشرة", "مشروبات كذا عشرة", "تحصيل إحدى وعشرين"]);
    for (const t of ["مشروبات اثنتان عشرة", "مشروبات 5 عشرة"]) expect(highOf(t)).toEqual({});
  });
});

describe("fix round 2 (R77) C: quarters and thirds", () => {
  it("a quarter or third after a number or scale gives no field", () => {
    refused([
      "تحصيل ثلاثة أرباع", "تحصيل أربعة أرباع", "تحصيل ربعين", "تحصيل تلتين", "تحصيل ثلثين", "تحصيل ألف وربع", "تحصيل ألف وتلت",
      "تحصيل خمسة وربع", "تحصيل خمسة وتلت", "تحصيل مية وتلت", "تحصيل مية وربع", "تحصيل ميه و ربع", "أغذية ألف إلا ربع", "أغذية مليون وربع",
      "أغذية مليون وتلت", "أغذية الف وربع الف", "أغذية ثلاثة ارباع الف", "أغذية تلات ارباع المليون", "تحصيل مليون وربع ألف",
      "food one and a quarter", "food a quarter", "food quarter million", "food one and quarter", "أغذية 100 وربع", "أغذية 5 ثلث",
    ]);
  });
  it("lone fraction words count as unassigned", () => {
    for (const w of ["نص", "نصف", "ثلث", "ربعين", "تلتين", "ثلثين", "ربع"]) expect(parse(`أغذية ${w}`)).toEqual({ fields: [], unassigned: 1 });
  });
});

describe("fix round 2 (R77) D: negations and comparators", () => {
  it("negations, subtractions and signs give no field", () => {
    refused([
      "أغذية ما كانتش مية", "أغذية مو مية", "أغذية مب مية", "أغذية ليس مية", "أغذية غير مية", "أغذية ناقص مية", "أغذية زائد مية",
      "أغذية سالب مية", "أغذية - 100", "أغذية + 100", "أغذية -100", "أغذية +100", "مشروبات - 12", "food minus fifty", "food negative fifty",
      "food not fifty", "food plus fifty", "أغذية ألف ناقص خمسين", "أغذية ألف الا خمسين", "أغذية ألف غير خمسين", "أغذية ألف إلا ربع",
    ]);
    expect(parse("أغذية ألف ناقص خمسين").unassigned).toBe(2);
  });
  it("comparators and approximators read the number but only at 0.5", () => {
    lowRows([
      ["مشروبات اقل من خمسين", "line:bev", "50"],
      ["مشروبات اكتر من خمسين", "line:bev", "50"],
      ["مشروبات اكثر من خمسين", "line:bev", "50"],
      ["مشروبات أقل من مية", "line:bev", "100"],
      ["مشروبات خمسين او اكتر", "line:bev", "50"],
      ["مشروبات زي خمسين", "line:bev", "50"],
      ["مشروبات حوالي خمسين", "line:bev", "50"],
      ["مشروبات تقريبا خمسين", "line:bev", "50"],
      ["مشروبات خمسين تقريبا", "line:bev", "50"],
      ["food less than fifty", "line:food", "50"],
      ["food more than fifty", "line:food", "50"],
      ["food at least fifty", "line:food", "50"],
      ["food under fifty", "line:food", "50"],
      ["food over fifty", "line:food", "50"],
      ["food about fifty", "line:food", "50"],
    ]);
  });
  it("words that are not on the filler list lower the field; the filler list keeps 0.9", () => {
    lowRows([
      ["مشروبات رقم 12", "line:bev", "12"],
      ["مشروبات الصنف 12", "line:bev", "12"],
      ["مشروبات الثاني خمسة", "line:bev", "5"],
      ["مشروبات المرة التانية خمسة", "line:bev", "5"],
      ["مشروبات خمسة وشكرا", "line:bev", "5"],
      ["food sorry fifty", "line:food", "50"],
    ]);
    readAt09([
      ["مشروبات كان خمسين", { "line:bev": "50" }],
      ["مشروبات يعني خمسين كرتونة", { "line:bev": "50" }],
      ["مشروبات كانت 12", { "line:bev": "12" }],
      ["food was fifty", { "line:food": "50" }],
      ["food is fifty", { "line:food": "50" }],
      ["مشروبات خمسين كراتين", { "line:bev": "50" }],
      ["تحصيل ألف ريال", { "line:coll": "1000" }],
    ]);
  });
});

describe("fix round 2 (R77) E: half before a scale", () => {
  it("half a million, half a thousand, a half and half give no field", () => {
    refused(["food half a million", "أغذية half a million", "food half a thousand", "food a half million", "food a half", "food half", "food half million"]);
  });
  it("the real halves still read", () => {
    check([
      ["food three and a half", { "line:food": "3.50" }, 0, 0.5],
      ["food two and half", { "line:food": "2.50" }, 0, 0.5],
    ]);
  });
});

describe("fix round 2 (R77): a mention with no number", () => {
  it("counts as unassigned, whatever follows it", () => {
    for (const text of ["تحصيل شوية", "تحصيل كتير", "تحصيل ولا شيء", "تحصيل لا شيء", "تحصيل مفيش"]) {
      expect({ text, got: parse(text) }).toEqual({ text, got: { fields: [], unassigned: 1 } });
    }
  });
  it("counts a trailing label with nothing after it, and a label alone", () => {
    expect(parse("مشروبات مية أغذية")).toEqual({ fields: [{ key: "line:bev", value: "100", confidence: 0.9 }], unassigned: 1 });
    expect(parse("أغذية")).toEqual({ fields: [], unassigned: 1 });
    expect(parse("مصاريف نقدي مية").unassigned).toBe(1);
  });
});

describe("fix round 2 (R77): no wrong value at 0.8 or more on the probe inputs", () => {
  const SAFE: [string, Record<string, string>][] = [
    ["تحصيل خمسين ألفا", { "line:coll": "50000" }],
    ["تحصيل إحدى عشرة", { "line:coll": "11" }],
    ["مشروبات ميتين وخمسين", { "line:bev": "250" }],
    ["تحصيل ألفين وميتين", { "line:coll": "2200" }],
    ["تحصيل مليونين وخمسمية الف", { "line:coll": "2500000" }],
    ["أغذية مية وخمسين تقريبا", {}],
    ["أغذية ألف وخمسة عشر", { "line:food": "1015" }],
    ["مشروبات خمسين كرتونة وستة", {}],
    ["نقدي خمسة آلاف وخمسمية", { cashSales: "5500" }],
  ];
  it.each(SAFE)("%s", (text, want) => {
    expect(highOf(text)).toEqual(want);
  });
});

describe("fix round 2 (R77): hostile input stays linear", () => {
  it("finishes fraction, negation and filler storms fast", () => {
    const t0 = performance.now();
    parse("أغذية " + "ألف وربع ".repeat(40_000));
    parse("أغذية " + "ناقص مية ".repeat(40_000));
    parse("أغذية " + "نص ".repeat(100_000));
    parse("food " + "half a million ".repeat(30_000));
    parse("أغذية " + "كان ".repeat(100_000) + "مية");
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("parseSpokenClose: a cut recording (R79)", () => {
  it("without cut nothing changes; with cut the last field mentioned is never above 0.5", () => {
    expect(parse(V1).fields.map((f) => f.confidence)).toEqual([0.9, 0.9, 0.9, 0.9]);
    const cut = parseSpokenClose(V1, VOCAB, { cut: true });
    expect(cut.fields.map((f) => [f.key, f.value, f.confidence])).toEqual([
      ["line:bev", "120", 0.9],
      ["line:food", "8250", 0.9],
      ["line:coll", "20000", 0.9],
      ["cashSales", "5500", 0.5],
    ]);
  });

  it("a number cut in the middle (a dangling و, a number at the very end) is flagged only when cut", () => {
    for (const text of ["مشروبات مية وعشرين و", "مشروبات مية وعشرين وال", "مشروبات ألفين"]) {
      expect(parse(text).fields.at(-1)?.confidence, text).toBeGreaterThan(0.4);
      expect(parseSpokenClose(text, VOCAB, { cut: true }).fields.at(-1)?.confidence, text).toBeLessThanOrEqual(0.5);
    }
  });

  it("a number at the very end of an uncut transcript is still read at 0.9 (non-cut behaviour unchanged)", () => {
    expect(parse("مشروبات ألفين").fields.at(-1)?.confidence).toBe(0.9);
  });

  it("cut with no field at all, or a lower confidence already, changes nothing", () => {
    expect(parseSpokenClose("يعني النهارده كان يوم كويس", VOCAB, { cut: true })).toEqual(parse("يعني النهارده كان يوم كويس"));
    expect(parseSpokenClose("مشروبات مية وعشرين ونص", VOCAB, { cut: true }).fields).toEqual(parse("مشروبات مية وعشرين ونص").fields);
  });
});

describe("parseSpokenClose: a trailing و/and after a number (R85)", () => {
  const conf = (text: string) => Object.fromEntries(parse(text).fields.map((f) => [f.key, [f.value, f.confidence]]));

  it("at the end of the transcript the number may be unfinished: shaky even when not cut", () => {
    expect(conf("مشروبات مية وعشرين أغذية ألف و")).toEqual({ "line:bev": ["120", 0.9], "line:food": ["1000", 0.5] });
    expect(conf("نقدي خمسة آلاف و")).toEqual({ cashSales: ["5000", 0.5] });
    expect(conf("نقدي خمسة آلاف و...")).toEqual({ cashSales: ["5000", 0.5] });
    expect(conf("مشروبات مية و")).toEqual({ "line:bev": ["100", 0.5] });
    expect(conf("مشروبات مية و كرتونة")).toEqual({ "line:bev": ["100", 0.5] });
    expect(conf("أغذية ألفين و.")).toEqual({ "line:food": ["2000", 0.5] });
    expect(conf("food two thousand and")).toEqual({ "line:food": ["2000", 0.5] });
    expect(conf("food 2000 and")).toEqual({ "line:food": ["2000", 0.5] });
    expect(conf("مشروبات مية وعشرين وال")).toEqual({ "line:bev": ["120", 0.5] });
  });

  it("before the next label too", () => {
    expect(conf("مشروبات مية و أغذية ألف")).toEqual({ "line:bev": ["100", 0.5], "line:food": ["1000", 0.9] });
    expect(conf("food 2000 and collection 3000")).toEqual({ "line:food": ["2000", 0.5], "line:coll": ["3000", 0.9] });
  });

  it("a و joining number words, or glued to the next label, changes nothing", () => {
    expect(conf("مشروبات مية و خمسين")).toEqual({ "line:bev": ["150", 0.9] });
    expect(conf("مشروبات مية وخمسين وأغذية ألف")).toEqual({ "line:bev": ["150", 0.9], "line:food": ["1000", 0.9] });
    expect(parse(V1).fields.map((f) => f.confidence)).toEqual([0.9, 0.9, 0.9, 0.9]);
  });
});
