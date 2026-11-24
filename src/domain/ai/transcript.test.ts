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
    expect(parse("أغذية مية وخمسة وعشرين ونص").fields).toEqual([{ key: "line:food", value: "125.50", confidence: 0.9 }]);
    expect(draftValues("أغذية مية وخمسة وعشرين ونص")).toEqual({ "line:food": 12_550 });
    expect(parse("مشروبات مية وعشرين ونص").fields).toEqual([]);
  });

  it("gives a number to the label before it, not to the label after it", () => {
    expect(parse("مشروبات مية أغذية")).toEqual({ fields: [{ key: "line:bev", value: "100", confidence: 0.9 }], unassigned: 0 });
  });

  it("gives nothing for speech without numbers", () => {
    expect(parse("يعني النهارده كان يوم كويس")).toEqual({ fields: [], unassigned: 0 });
  });

  it("counts numbers without a label as unassigned", () => {
    expect(parse("بعت 300 و 500")).toEqual({ fields: [], unassigned: 2 });
  });

  it("reads the extra transcript (R27): bev 120 and 300 left over", () => {
    expect(parse("مشروبات مية وعشرين وبعت كمان 300")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.9 }], unassigned: 1 });
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
    expect(parse("مشروبات 120 130")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.9 }], unassigned: 1 });
  });

  it("numbers before the first label: only one directly before it, nothing past another number", () => {
    expect(parse("120 130 مشروبات")).toEqual({ fields: [], unassigned: 2 });
    expect(parse("120 بعت مشروبات")).toEqual({ fields: [], unassigned: 1 });
  });

  it("a number after a label that already has one is not moved to the next label", () => {
    expect(parse("مشروبات 120 130 أغذية")).toEqual({ fields: [{ key: "line:bev", value: "120", confidence: 0.9 }], unassigned: 1 });
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
  it("100 000 tokens of mixed speech", () => {
    const { ms, out } = time("مشروبات مية وعشرين كرتونة بعت ".repeat(20_000));
    expect(out.fields).toEqual([{ key: "line:bev", value: "120", confidence: 0.9 }]);
    expect(ms).toBeLessThan(200);
  });
  it("thousands of repeated labels", () => {
    const { ms, out } = time("بيع نقدي ".repeat(50_000));
    expect(out).toEqual({ fields: [], unassigned: 0 });
    expect(ms).toBeLessThan(200);
  });
  it("a numeric run bomb", () => {
    const { ms, out } = time("نقدي " + "ألف ".repeat(100_000));
    expect(out).toEqual({ fields: [], unassigned: 1 });
    expect(ms).toBeLessThan(200);
  });
  it("does not overflow the stack on 400 000 numbers or 200 000 repeats of one label and number", () => {
    expect(parse("نقدي " + "7 ".repeat(400_000)).unassigned).toBe(399_999);
    expect(parse("نقدي 7 ".repeat(200_000)).fields).toEqual([{ key: "cashSales", value: "7", confidence: 0.9 }]);
  });
  it("100 000 digit tokens after one label", () => {
    const { ms, out } = time("نقدي " + "7 ".repeat(100_000));
    expect(out.fields).toEqual([{ key: "cashSales", value: "7", confidence: 0.9 }]);
    expect(out.unassigned).toBe(99_999);
    expect(ms).toBeLessThan(200);
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
const UNITS = ["كرتونة", "ريال", "كراتين"];

type Item = { t: "m"; label: number } | { t: "n"; num: number };

/** The rules of parseSpokenClose on the abstract sequence (fillers and unit words are not items). */
function oracle(items: Item[], unitsOnlyBefore: (i: number) => boolean): { fields: Record<string, string>; unassigned: number } {
  const cands = new Map<number, { num: number; conf: number }[]>();
  items.forEach((it, i) => {
    if (it.t !== "n") return;
    const prev = items[i - 1];
    if (prev?.t === "m") cands.set(i - 1, [...(cands.get(i - 1) ?? []), { num: it.num, conf: 0.9 }]);
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
  let used = 0;
  for (const [key, list] of byKey) {
    if (spoiled.has(key)) continue;
    if (!list.every((x) => x.value === list[0]!.value)) continue;
    fields[key] = String(list[0]!.value);
    used += list.length;
  }
  const numbers = items.filter((i) => i.t === "n").length;
  return { fields, unassigned: numbers - used };
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
      items.forEach((it, i) => {
        let unitsOnly = true;
        if (i > 0) {
          // Two numbers side by side always get a filler word between them (else they could be one run).
          const needFiller = it.t === "n" && items[i - 1]!.t === "n";
          if (needFiller || r() < 0.3) {
            words.push(pick(FILLER));
            unitsOnly = false;
          }
          if (r() < 0.4) words.push(pick(UNITS));
        }
        gapIsUnitsOnly[i] = unitsOnly;
        words.push(it.t === "m" ? LABELS[it.label]!.text : NUMBERS[it.num]!.text);
      });
      const text = words.join(r() < 0.5 ? " " : "، ");
      const want = oracle(items, (i) => gapIsUnitsOnly[i]!);
      const got = parseSpokenClose(text, VOCAB);
      // Only bev, food, coll and the default keys are in VOCAB; every LABELS key is one of them.
      const gotFields = Object.fromEntries(got.fields.map((f) => [f.key, f.value]));
      // Half never occurs here, so the expected value text is the plain integer.
      expect({ text, fields: gotFields, unassigned: got.unassigned }).toEqual({ text, fields: want.fields, unassigned: want.unassigned });
      for (const f of got.fields) expect([0.9, 0.6]).toContain(f.confidence);
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
      const allowed = oracle(items, () => true);
      const got = parseSpokenClose(text, VOCAB);
      for (const f of got.fields) expect({ text, key: f.key, value: f.value }).toEqual({ text, key: f.key, value: allowed.fields[f.key] });
      const numbers = items.filter((i) => i.t === "n").length;
      expect(got.unassigned).toBeLessThanOrEqual(numbers);
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
