import { describe, expect, it } from "vitest";
import { readNumbers, spokenTokens, type NumberToken } from "./spoken-numbers";

const read = (text: string): NumberToken[] => readNumbers(spokenTokens(text));
/** The values (with `.5` for a half) of every number token read from `text`. */
const values = (text: string): string[] => read(text).map((t) => `${t.value}${t.half ? "+half" : ""}`);
const one = (text: string): NumberToken => {
  const t = read(text);
  expect(t).toHaveLength(1);
  return t[0]!;
};

describe("spokenTokens", () => {
  it("normalises, removes invisible characters and splits on spaces", () => {
    expect(spokenTokens("  مية\u200F وعشرين، ٨٢٥٠ ")).toEqual(["ميه", "وعشرين", "8250"]);
    expect(spokenTokens("")).toEqual([]);
  });
  it("splits an English hyphenated number but keeps a minus sign before digits", () => {
    expect(spokenTokens("twenty-five")).toEqual(["twenty", "five"]);
    expect(spokenTokens("-150")).toEqual(["-150"]);
  });
  it("removes a joiner inside a word so the word matches its plain spelling", () => {
    expect(spokenTokens("مشرو\u200Cبات")).toEqual(["مشروبات"]);
  });
});

describe("readNumbers: the plan's values", () => {
  it("reads Arabic number words", () => {
    expect(one("مية وعشرين")).toMatchObject({ value: 120, half: false, digits: false, start: 0, end: 2 });
    expect(one("ألفين وتلتمية وخمسة وأربعين").value).toBe(2345);
    expect(one("عشرين ألف").value).toBe(20000);
    expect(one("خمسة آلاف وخمسمية").value).toBe(5500);
    expect(one("تلاتاشر").value).toBe(13);
    expect(one("مليون").value).toBe(1_000_000);
  });
  it("sets half on a trailing ونص", () => {
    expect(one("مية وخمسة وعشرين ونص")).toMatchObject({ value: 125, half: true });
  });
  it("reads digit tokens", () => {
    expect(one("٨٢٥٠")).toMatchObject({ value: 8250, digits: true });
    expect(one("1,140")).toMatchObject({ value: 1140, digits: true });
    expect(read("8250,50")).toEqual([]);
  });
  it("reads English number words", () => {
    expect(one("one hundred and twenty").value).toBe(120);
  });
  it("refuses a run that does not parse cleanly", () => {
    expect(read("ألف ألف ألف ألف ألف ألف")).toEqual([]);
  });
});

describe("readNumbers: Egyptian, Gulf and MSA spellings", () => {
  it.each([
    ["واحد", 1], ["اتنين", 2], ["اثنين", 2], ["تلاتة", 3], ["ثلاثة", 3], ["أربعة", 4], ["خمسة", 5], ["ستة", 6],
    ["سبعة", 7], ["تمانية", 8], ["ثمانية", 8], ["تسعة", 9], ["عشرة", 10],
    ["حداشر", 11], ["احدعشر", 11], ["اتناشر", 12], ["اثناعشر", 12], ["أربعتاشر", 14], ["خمستاشر", 15],
    ["ستاشر", 16], ["سبعتاشر", 17], ["تمنتاشر", 18], ["تسعتاشر", 19], ["خمسطعش", 15],
    ["أحد عشر", 11], ["اثنا عشر", 12], ["ثلاثة عشر", 13], ["خمس عشرة", 15],
    ["عشرين", 20], ["عشرون", 20], ["تلاتين", 30], ["ثلاثين", 30], ["أربعين", 40], ["خمسين", 50], ["ستين", 60],
    ["سبعين", 70], ["تمانين", 80], ["ثمانين", 80], ["تسعين", 90],
    ["مية", 100], ["مائة", 100], ["مئة", 100], ["ميتين", 200], ["مائتين", 200], ["تلتمية", 300], ["ثلاثمائة", 300],
    ["ربعمية", 400], ["أربعمائة", 400], ["خمسمية", 500], ["ستمية", 600], ["سبعمية", 700], ["تمنمية", 800],
    ["ثمانمائة", 800], ["تسعمية", 900], ["خمس مية", 500], ["ثلاث مائة", 300],
    ["ألف", 1000], ["ألفين", 2000], ["ألفان", 2000], ["تلات آلاف", 3000], ["عشر آلاف", 10000], ["عشرة آلاف", 10000],
    ["خمس تلاف", 5000], ["حداشر ألف", 11000], ["مية ألف", 100_000], ["مية وخمسين ألف", 150_000],
    ["ميتين وخمسين ألف وتلتمية", 250_300], ["مليونين", 2_000_000], ["تلات ملايين", 3_000_000],
    ["مليون ومية ألف وخمسة", 1_100_005], ["خمسة وعشرين", 25], ["واحد وتسعين", 91],
  ])("%s → %i", (text, value) => {
    expect(one(text).value).toBe(value);
  });

  it("reads a separate و between the words", () => {
    expect(one("مية و عشرين").value).toBe(120);
  });

  it("reads digits with a following scale word, and a lower part after it", () => {
    expect(one("20 ألف")).toMatchObject({ value: 20000, digits: true });
    expect(one("5 آلاف")).toMatchObject({ value: 5000, digits: true });
    expect(one("20 ألف و500").value).toBe(20500);
    expect(one("الفين و٥٠٠").value).toBe(2500);
    expect(one("2.5 مليون").value).toBe(2_500_000);
  });

  it("reads Arabic-Indic, Persian and Arabic-separated digits", () => {
    expect(one("١٬١٤٠").value).toBe(1140);
    expect(one("۱۲۳").value).toBe(123);
    expect(one("7,900.00").value).toBe(7900);
    expect(one("٣٫٥")).toMatchObject({ value: 3, half: true });
    expect(one("125.50")).toMatchObject({ value: 125, half: true });
    expect(one("125 ونص")).toMatchObject({ value: 125, half: true });
  });
});

describe("readNumbers: English", () => {
  it.each([
    ["one", 1], ["twelve", 12], ["twenty five", 25], ["twenty-five", 25], ["ninety nine", 99],
    ["a hundred", 100], ["two hundred forty five", 245], ["one thousand", 1000], ["a thousand", 1000],
    ["two thousand three hundred and forty five", 2345], ["twenty thousand", 20000], ["one million", 1_000_000],
    ["20 thousand", 20000],
  ])("%s → %i", (text, value) => {
    expect(one(text).value).toBe(value);
  });
  it("sets half on and a half", () => {
    expect(one("twenty and a half")).toMatchObject({ value: 20, half: true });
  });
});

describe("readNumbers: separate numbers and refused runs", () => {
  it("reads digit tokens joined by و as two numbers", () => {
    expect(values("بعت 300 و 500")).toEqual(["300", "500"]);
    expect(values("120 كمان 130")).toEqual(["120", "130"]);
    expect(values("12 34")).toEqual(["12", "34"]);
    // A digit token followed by exactly three digits is a thousands group split by a space (R76).
    expect(values("120 130")).toEqual([]);
  });
  it("gives separate numbers between ordinary words", () => {
    expect(values("بعت مية وعشرين وبعت كمان 300")).toEqual(["120", "300"]);
  });
  it.each([
    ["مية عشرين"], // no و between hundreds and tens
    ["عشرين وخمسة"], // tens before units
    ["خمسة ألف"], // 5 takes the plural
    ["عشرين آلاف"], // 20 takes the singular
    ["اتنين ألف"],
    ["ألفين ألف"],
    ["مية ومية"],
    ["ألف ومليون"],
    ["ألف ونص"], // 1500 in speech, not 1000.5: ambiguous, so refused
    ["مية ونص"],
    ["1000 ونص"],
    ["عشرين ونص ونص"],
    ["125.5 ونص"],
    ["125.25"],
    ["1,14"],
    ["1,140,5"],
    ["01,140"],
    ["1.2.3"],
    ["300ريال"],
    ["-150"],
    ["9007199254740992"],
    ["99999999999999999999999"],
    ["twenty thirty"],
    ["مية twenty"],
  ])("%s → no token", (text) => {
    expect(read(text)).toEqual([]);
  });
  it("keeps the largest safe integer", () => {
    expect(one("9007199254740991").value).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("does not read a short form or a bare عشر that is not followed by what it counts", () => {
    expect(read("ست الحبايب")).toEqual([]);
    expect(read("عشر")).toEqual([]);
    expect(one("خمس كراتين").value).toBe(5);
  });
  it("does not read a bare half or a half far from a number", () => {
    expect(read("نص كرتونة")).toEqual([]);
  });
  it("reads a half after a unit word", () => {
    expect(one("مية وعشرين ريال ونص")).toMatchObject({ value: 120, half: true });
  });
  it("gives token indexes of the run, end exclusive", () => {
    const t = read("مشروبات مية وعشرين كرتونة أغذية ٨٢٥٠");
    expect(t.map((x) => [x.start, x.end, x.value])).toEqual([
      [1, 3, 120],
      [5, 6, 8250],
    ]);
  });
});

describe("readNumbers: hostile input finishes fast", () => {
  // Best of three runs: the bound is on the algorithm, not on a CPU shared with other test files.
  const timed = (text: string) => {
    let ms = Infinity;
    let out: NumberToken[] = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      out = readNumbers(spokenTokens(text));
      ms = Math.min(ms, performance.now() - t0);
    }
    return { ms, out };
  };
  const cut = (unit: string) => unit.repeat(Math.ceil(20_000 / unit.length)).slice(0, 20_000);
  it.each([
    ["a run bomb of scale words", "ألف "],
    ["joined hundreds", "مية و"],
    ["digit tokens", "12 "],
    ["و-prefixed tokens", "وو "],
    ["halves", "مية ونص "],
    ["number-like tokens", "خمستلافك "],
  ])("20 000 characters of %s in under 50 ms", (_name, unit) => {
    expect(timed(cut(unit)).ms).toBeLessThan(50);
  });
  it("a run bomb gives no token", () => {
    expect(timed("ألف ".repeat(5000)).out).toEqual([]);
    expect(timed("مية و".repeat(5000)).out).toEqual([]);
    expect(timed("12 ".repeat(5000)).out).toHaveLength(5000);
  });
  it("5000 و and a 5000-character و", () => {
    expect(timed("و ".repeat(5000)).out).toEqual([]);
    expect(timed("و".repeat(5000)).out).toEqual([]);
  });
  it("hostile 100 000 tokens finish in under 2 s", () => {
    const t0 = performance.now();
    readNumbers(spokenTokens("ألف مية و12 ".repeat(33_334)));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
