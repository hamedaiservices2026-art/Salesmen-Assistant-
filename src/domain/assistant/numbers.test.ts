import { readFileSync } from "node:fs";
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

  it("follows the parseAmount grouping rule: a bad grouping is one raw token (R80)", () => {
    expect(numbersIn("20 000 ريال")).toEqual(["20000"]);
    expect(numbersIn("1 200 000")).toEqual(["1200000"]);
    expect(numbersIn("82٬800")).toEqual(["82800"]);
    expect(numbersIn("1,86")).toEqual(["1,86"]);
    expect(numbersIn("8250,50")).toEqual(["8250,50"]);
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
    expect(checkNumbers("زور تلات محلات", set(), "loose")).toEqual({ ok: true });
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

describe("fix round 1 (R80): the reviewer's inputs", () => {
  it("strict: a number word worth 2 or more must be allowed; واحد and one are exempt", () => {
    for (const t of ["عمولتك خمسة", "فاضلك تسعة كراتين", "فاضلك تسعة", "you need seven more", "your commission is ten", "عمولتك اتنين"]) {
      expect(checkNumbers(t, set(), "strict"), t).toMatchObject({ ok: false });
    }
    expect(checkNumbers("فاضلك تسعة", set("9"), "strict")).toEqual({ ok: true });
    expect(checkNumbers("واحد من العملاء", set(), "strict")).toEqual({ ok: true });
    expect(checkNumbers("one of your customers", set(), "strict")).toEqual({ ok: true });
  });

  it("strict: a bad grouping or an apostrophe between digits is one raw token", () => {
    expect(checkNumbers("عمولتك 1,5%", set("1", "5"), "strict")).toEqual({ ok: false, unknown: ["1,5"] });
    expect(checkNumbers("عمولتك 1\u2019860 ريال", set("1", "860"), "strict")).toEqual({ ok: false, unknown: ["1\u2019860"] });
    expect(checkNumbers("عمولتك 1'860 ريال", set("1", "860"), "strict")).toEqual({ ok: false, unknown: ["1'860"] });
    expect(checkNumbers("عمولتك 1,5%", set("1,5"), "strict")).toEqual({ ok: true });
    expect(numbersIn("نسبة 1,5%")).toEqual(["1,5"]);
  });

  it("strict: marks, fillers and blanks between digits join them (4140, not 414 and 0)", () => {
    for (const t of ["414\u034F0", "414\uFE0F0", "414\u06510", "414\u31640", "414\u06400", "414\u03320", "414\u20E30", "414\u115F0", "414\uFFA00", "414\u28000"]) {
      expect(numbersIn(t), JSON.stringify(t)).toEqual(["4140"]);
      expect(checkNumbers(`عمولتك ${t} ريال`, set("414", "0"), "strict"), JSON.stringify(t)).toEqual({ ok: false, unknown: ["4140"] });
    }
    expect(numbersIn("1\uFE0F\u20E38\uFE0F\u20E36\uFE0F\u20E30\uFE0F\u20E3")).toEqual(["1860"]);
  });

  it("strict: grand, roman numerals and letter-O zeros fail closed", () => {
    for (const t of ["عمولتك 5 grand", "عمولتك XV ريال", "\u216B riyals", "XII riyals", "عمولتك 5OO ريال"]) {
      expect(checkNumbers(t, set("5"), "strict"), t).toMatchObject({ ok: false });
    }
    expect(checkNumbers("I visited 5 customers", set("5"), "strict")).toEqual({ ok: true });
    for (const t of ["عمولتك ضعف عمولتك اللي فاتت", "your commission is double", "you'll get twice"]) {
      expect(checkNumbers(t, set(), "strict"), t).toMatchObject({ ok: false });
    }
  });

  it("reads a scale glued to the end of a number word and number words after ف or ك", () => {
    expect(numbersIn("عمولتك عشرينالف ريال")).toEqual(["20000"]);
    for (const t of ["كعشرين ألف", "فعشرين ألف", "وكعشرين ألف", "فبعشرين ألف"]) expect(numbersIn(t), t).toEqual(["20000"]);
    expect(checkNumbers("كتلات ريال", set(), "strict").ok).toBe(false);
    expect(checkNumbers("فخمسة ريال", set(), "loose").ok).toBe(false);
    expect(numbersIn("الكمية كويسة")).toEqual([]);
  });

  it("never reads 'one point five million' as five million", () => {
    expect(numbersIn("one point five million")).not.toContain("5000000");
    expect(checkNumbers("one point five million", set("1", "5", "5000000"), "strict").ok).toBe(false);
    expect(numbersIn("1.5 million")).toEqual(["1.5", "1500000"]);
  });

  it("loose: the catalogs' currency and unit labels and common money and count words are units", () => {
    for (const t of [
      "هتكسب 5 د.إ", "هتكسب 5 د. إ", "هتكسب 5 ر.ق", "هتكسب 5 ج.م", "هتكسب 5 ج. م", "5 پاؤنڈ", "5 ڈالر", "5 عملاء", "5 عميل",
      "5 outlets", "5 customers", "5 کسٹمر", "5 گاہک", "5 فلوس", "3 كاش", "3 دينار", "3 يورو", "3 euro", "3 eur", "3 كريتين",
      "3 دسته", "3 باكو", "3 pieces", "3 bottles", "3 cans", "3 كانز", "3 فالمية", "3 pc", "3 grand", "3 مبلغ", "3 per-cent",
    ]) {
      expect(checkNumbers(t, set(), "loose"), t).toMatchObject({ ok: false });
    }
  });

  it("loose: a unit word two words away on either side counts", () => {
    for (const t of ["3 كمان ريال", "3 تقريبا ريال", "3 يعني ريال", "خمسة تقريبا ريال", "ريال كمان 3", "3 مرات المبلغ"]) {
      expect(checkNumbers(t, set(), "loose"), t).toMatchObject({ ok: false });
    }
    expect(checkNumbers("جرّب 3 زيارات بكرة", set(), "loose")).toEqual({ ok: true });
  });
});

describe("fix round 1: every currency and unit label of the catalogs is a unit word", () => {
  // Reads the message catalogs in the test only (the domain may not import them), so a new
  // currency or unit label that the constants in numbers.ts miss makes this test fail.
  const labels: string[] = [];
  for (const locale of ["ar", "en", "ur"]) {
    const m = JSON.parse(readFileSync(`${process.cwd()}/src/i18n/messages/${locale}.json`, "utf8")) as {
      currency: Record<string, string>;
      home: { unit: Record<string, string> };
      admin: { lines: { units: Record<string, string> }; focus: { units: Record<string, string> }; incentives: { units: Record<string, string> } };
    };
    labels.push(
      ...Object.values(m.currency),
      ...Object.values(m.home.unit),
      ...Object.values(m.admin.lines.units),
      ...Object.values(m.admin.focus.units),
      ...Object.values(m.admin.incentives.units),
    );
  }
  it.each([...new Set(labels)])("%s", (label) => {
    expect(checkNumbers(`3 ${label}`, set(), "loose")).toMatchObject({ ok: false });
    expect(checkNumbers(`${label} 3`, set(), "loose")).toMatchObject({ ok: false });
  });
});
