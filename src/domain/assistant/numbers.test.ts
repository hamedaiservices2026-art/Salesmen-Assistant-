import { describe, expect, it } from "vitest";
import { checkNumbers, numbersIn } from "./numbers";

const set = (...xs: string[]) => new Set(xs);
const fast = (fn: () => void, ms = 1500) => {
  const t0 = performance.now();
  fn();
  expect(performance.now() - t0).toBeLessThan(ms);
};

describe("numbersIn", () => {
  it("reads digits in canonical form (plan examples)", () => {
    expect(numbersIn("باقي 1,860 كرتونة و ٣٨٪ يعني 3,478.55 ريال")).toEqual(["1860", "38", "3478.55"]);
    expect(numbersIn("عشرين ألف ريال")).toEqual(["20000"]);
    expect(numbersIn("واحد من الاتنين")).toEqual([]);
  });

  it("drops trailing zeros of the decimal part and leading zeros of the whole part", () => {
    expect(numbersIn("7,900.00")).toEqual(["7900"]);
    expect(numbersIn("0.50 و 007")).toEqual(["0.5", "7"]);
    expect(numbersIn("38%")).toEqual(["38"]);
  });

  it("yields the three parts of a YYYY-MM-DD date", () => {
    expect(numbersIn("لحد 2026-11-04")).toEqual(["2026", "11", "4"]);
  });

  it("splits ranges, fractions, times, versions and phone-like strings into their parts", () => {
    expect(numbersIn("من 10-20 زيارة")).toEqual(["10", "20"]);
    expect(numbersIn("من 10 - 20")).toEqual(["10", "20"]);
    expect(numbersIn("1/2 الكمية")).toEqual(["1", "2"]);
    expect(numbersIn("الساعة 10:30")).toEqual(["10", "30"]);
    expect(numbersIn("14.11.2026")).toEqual(["14", "11", "2026"]);
    expect(numbersIn("+966 55 123 4567")).toEqual(["966", "55123", "4567"]);
  });

  it("keeps a minus sign in front of a number, never between two numbers", () => {
    expect(numbersIn("الرصيد -150 ريال")).toEqual(["-150"]);
    expect(numbersIn("الرصيد −150")).toEqual(["-150"]);
  });

  it("follows the parseAmount grouping rule: a bad grouping gives each part separately", () => {
    expect(numbersIn("20 000 ريال")).toEqual(["20000"]);
    expect(numbersIn("1 200 000")).toEqual(["1200000"]);
    expect(numbersIn("82٬800")).toEqual(["82800"]);
    expect(numbersIn("1,86")).toEqual(["1", "86"]);
    expect(numbersIn("8250,50")).toEqual(["8250", "50"]);
    expect(numbersIn("5 1,860")).toEqual(["5", "1860"]);
  });

  it("reads Arabic-Indic and Persian digits and the Arabic separators", () => {
    expect(numbersIn("١٬٨٦٠ و ٣٤٧٨٫٥٥")).toEqual(["1860", "3478.55"]);
    expect(numbersIn("۱۸۶۰")).toEqual(["1860"]);
  });

  it("reads full-width, circled and other Unicode digits", () => {
    expect(numbersIn("１，８６０")).toEqual(["1860"]);
    expect(numbersIn("①②")).toEqual(["12"]);
    expect(numbersIn("१८६०")).toEqual(["1860"]); // Devanagari
    expect(numbersIn("𝟗𝟗𝟗𝟗")).toEqual(["9999"]);
  });

  it("is not fooled by zero-width characters or bidi marks inside a number", () => {
    expect(numbersIn("1\u200B000")).toEqual(["1000"]);
    expect(numbersIn("9\u200D,\u200C999")).toEqual(["9999"]);
    expect(numbersIn("9\u202E99\u202C9")).toEqual(["9999"]);
    expect(numbersIn("\u2066١٢\u2069٣")).toEqual(["123"]);
    expect(numbersIn("1\u00AD000")).toEqual(["1000"]); // soft hyphen
  });

  it("finds numbers glued to letters, ordinals and multipliers", () => {
    expect(numbersIn("ال1860")).toEqual(["1860"]);
    expect(numbersIn("x2")).toEqual(["2"]);
    expect(numbersIn("the 3rd day")).toEqual(["3"]);
    expect(numbersIn("بـ5000")).toEqual(["5000"]);
  });

  it("reads a decimal with no digit before the mark as 0.x", () => {
    expect(numbersIn("خصم .5")).toEqual(["0.5"]);
  });

  it("adds spoken number words of 11 or more", () => {
    expect(numbersIn("ميت ألف")).toEqual(["100000"]);
    expect(numbersIn("خمسين ألفا")).toEqual(["50000"]);
    expect(numbersIn("مية وخمسة وعشرين ونص")).toEqual(["125.5"]);
    expect(numbersIn("twenty five cases")).toEqual(["25"]);
    expect(numbersIn("بخمسة آلاف ريال")).toEqual(["5000"]);
    expect(numbersIn("تلاتة وعشرة")).toEqual([]);
  });

  it("adds the scaled value when digits stand before a scale word", () => {
    expect(numbersIn("5 ألف")).toEqual(["5", "5000"]);
  });

  it("returns each number once", () => {
    expect(numbersIn("38 و 38% و ٣٨")).toEqual(["38"]);
  });

  it("handles hostile inputs in linear time", () => {
    fast(() => numbersIn("1,".repeat(50_000)));
    fast(() => numbersIn("9".repeat(100_000)));
    fast(() => numbersIn("1 ".repeat(50_000)));
    fast(() => numbersIn("١٬".repeat(50_000)));
    fast(() => numbersIn("\u200B1".repeat(50_000)));
    fast(() => numbersIn("ألف و".repeat(20_000)));
    fast(() => numbersIn("<".repeat(50_000)));
    fast(() => numbersIn(".5.".repeat(30_000)));
    expect(numbersIn("9".repeat(100_000))).toEqual(["9".repeat(100_000)]);
  });

  it("never throws on odd input", () => {
    expect(numbersIn("")).toEqual([]);
    expect(numbersIn("\uD800 5")).toEqual(["5"]);
    expect(numbersIn(undefined as unknown as string)).toEqual([]);
  });
});

describe("checkNumbers: strict", () => {
  it("accepts an answer whose numbers are all allowed (plan example)", () => {
    expect(checkNumbers("باقي لك 1,860 كرتونة", set("1860"), "strict")).toEqual({ ok: true });
  });

  it("refuses a number that is not allowed (plan example)", () => {
    expect(checkNumbers("عمولتك 9,999 ريال", set("414"), "strict")).toEqual({ ok: false, unknown: ["9999"] });
  });

  it("refuses any number, even a small one", () => {
    expect(checkNumbers("فاضل لك 3 أيام", set("1860"), "strict").ok).toBe(false);
    expect(checkNumbers("عمولتك 414 ريال، يعني 1 من 2", set("414"), "strict").ok).toBe(false);
  });

  it("is not fooled by digits hidden with zero-width characters, lookalikes or other scripts", () => {
    for (const s of ["عمولتك 9\u200B999", "عمولتك ９９９９", "عمولتك ٩٩٩٩", "عمولتك ۹۹۹۹", "عمولتك ال9999", "x9999", "9\u202E999"]) {
      expect(checkNumbers(s, set("9", "999", "414"), "strict"), s).toMatchObject({ ok: false });
    }
  });

  it("refuses a spoken number of 11 or more that is not allowed", () => {
    expect(checkNumbers("عمولتك تسعة آلاف ريال", set("414"), "strict")).toEqual({ ok: false, unknown: ["9000"] });
    expect(checkNumbers("عمولتك عشرين ألف", set("20000"), "strict")).toEqual({ ok: true });
  });

  it("fails closed on number words the reader cannot read", () => {
    for (const s of ["عمولتك نص مليون", "عمولتك ألف ونص", "عمولتك آلاف", "عمولتك مليار ريال", "عمولتك خمس", "your commission is two billion", "آپ کا کمیشن پانچ ہزار روپے", "عمولتك ثلاثمية الف وربع"]) {
      expect(checkNumbers(s, set("414"), "strict"), s).toMatchObject({ ok: false });
    }
  });

  it("reads 'ميت ألف' and 'خمسين ألفا' and refuses them when not allowed", () => {
    expect(checkNumbers("ميت ألف", set("414"), "strict")).toEqual({ ok: false, unknown: ["100000"] });
    expect(checkNumbers("خمسين ألفا", set("414"), "strict")).toEqual({ ok: false, unknown: ["50000"] });
  });

  it("refuses a small number word next to a money, unit or percent word", () => {
    expect(checkNumbers("عمولتك تلات ريال", set("414"), "strict").ok).toBe(false);
    expect(checkNumbers("خصم خمسة في المية", set("414"), "strict").ok).toBe(false);
  });

  it("refuses digits in front of a scale word", () => {
    expect(checkNumbers("عمولتك 5 مليار", set("5"), "strict").ok).toBe(false);
    expect(checkNumbers("commission 5k", set("5"), "strict").ok).toBe(false);
  });

  it("accepts ordinary words that only look like fractions when nothing numeric is near", () => {
    expect(checkNumbers("حسب نص السياسة الخصم 3%", set("3"), "strict")).toEqual({ ok: true });
    expect(checkNumbers("واحد من العملاء", set(), "strict")).toEqual({ ok: true });
  });

  it("reports each unknown number once", () => {
    expect(checkNumbers("9,999 و 9999 و ٩٩٩٩", set(), "strict")).toEqual({ ok: false, unknown: ["9999"] });
  });

  it("finishes fast on hostile inputs", () => {
    fast(() => checkNumbers("1,".repeat(50_000), set("1"), "strict"));
    fast(() => checkNumbers("ريال 3 ".repeat(20_000), set(), "strict"));
    fast(() => checkNumbers("!".repeat(100_000) + "3", set(), "loose"));
    fast(() => checkNumbers("3 " + "!".repeat(100_000) + " ريال", set(), "loose"));
    fast(() => checkNumbers("3 ، ".repeat(30_000), set(), "loose"));
    fast(() => checkNumbers("نص ".repeat(30_000), set(), "strict"));
  });
});

describe("checkNumbers: loose", () => {
  it("tolerates a small number that is not next to a money, unit or percent word (plan examples)", () => {
    expect(checkNumbers("جرّب 3 زيارات", set(), "loose")).toEqual({ ok: true });
    expect(checkNumbers("هتكسب 3 ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("خصم 5%", set(), "loose").ok).toBe(false);
  });

  it("refuses a number above 10 that is not allowed", () => {
    expect(checkNumbers("جرّب 11 زيارة", set(), "loose")).toEqual({ ok: false, unknown: ["11"] });
    expect(checkNumbers("جرّب 11 زيارة", set("11"), "loose")).toEqual({ ok: true });
    expect(checkNumbers("جرّب 2.5 زيارة", set(), "loose").ok).toBe(false);
  });

  it("checks both sides of the number, across punctuation and spaces", () => {
    for (const s of [
      "ريال 3",
      "SAR 3",
      "3، ريال",
      "3 . ريال",
      "هتكسب 3 ر.س",
      "هتكسب 3 ر. س",
      "3 في الميه",
      "3 بالمية",
      "3 percent",
      "3 per cent",
      "3 cases",
      "3 كراتين",
      "3 روپے",
      "3٪",
      "3 ٪",
      "٪3",
      "$3",
      "3 €",
      "3﷼",
      "3 ﹪",
      "3 ％",
      "3‰",
      "3 فیصد",
      "3 ألف",
      "3 مليار",
    ]) {
      expect(checkNumbers(s, set(), "loose"), s).toMatchObject({ ok: false });
    }
  });

  it("sees the unit word through the prefixes ب, ل, و and ال", () => {
    for (const s of ["3 بريال", "3 لريال", "3 وريال", "3 الريال", "3 بالريال", "3 وبالريال", "3 كرتونة", "3 والكراتين"]) {
      expect(checkNumbers(s, set(), "loose"), s).toMatchObject({ ok: false });
    }
  });

  it("refuses a number glued to letters after it", () => {
    expect(checkNumbers("هتكسب 3ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("هتكسب 5k", set(), "loose").ok).toBe(false);
  });

  it("spreads the unit word over a range or a fraction", () => {
    expect(checkNumbers("5-7 ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("1/2 ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("ريال 1/2", set(), "loose").ok).toBe(false);
  });

  it("refuses a negative number", () => {
    expect(checkNumbers("جرّب -3 زيارات", set(), "loose").ok).toBe(false);
  });

  it("refuses a small number word next to a money word", () => {
    expect(checkNumbers("هتكسب تلات ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("هتكسب بتلاتة ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("you earn three riyals", set(), "loose").ok).toBe(false);
    expect(checkNumbers("زور تلات عملاء", set(), "loose")).toEqual({ ok: true });
  });

  it("refuses an unread number word that carries a scale or a money word", () => {
    expect(checkNumbers("هتكسب آلاف ريال", set(), "loose").ok).toBe(false);
    expect(checkNumbers("هتكسب مليار", set(), "loose").ok).toBe(false);
    expect(checkNumbers("هتكسب نص مليون", set(), "loose").ok).toBe(false);
    expect(checkNumbers("زور ست محلات", set(), "loose")).toEqual({ ok: true });
  });

  it("accepts a tip with no number", () => {
    expect(checkNumbers("ركز على المحلات الكبيرة الصبح", set(), "loose")).toEqual({ ok: true });
  });
});
