import { describe, expect, it } from "vitest";
import { normaliseArabic } from "./normalise";

describe("normaliseArabic", () => {
  it("removes tashkeel, unifies letters, converts digits and drops punctuation", () => {
    expect(normaliseArabic("الأُسبوع، ١٢٣ كرتونة")).toBe("الاسبوع 123 كرتونه");
  });

  it("keeps a separator between two digits", () => {
    expect(normaliseArabic("1,140")).toBe("1,140");
    expect(normaliseArabic("3.5")).toBe("3.5");
  });

  it("maps alef forms, ya, ta marbuta, waw and ya with hamza", () => {
    expect(normaliseArabic("إآٱأ ى ة ؤ ئ")).toBe("اااا ي ه و ي");
  });

  it("removes tatweel and converts Persian digits", () => {
    expect(normaliseArabic("مـــشروبات ۱۲۳")).toBe("مشروبات 123");
  });

  it("lower-cases Latin and collapses spaces", () => {
    expect(normaliseArabic("  Cash   Sales?  ")).toBe("cash sales");
  });

  it("turns punctuation into a space when not between two digits", () => {
    expect(normaliseArabic("باقي؟كام!1;2 3:")).toBe("باقي كام 1;2 3");
  });

  it("applies NFKC to presentation forms", () => {
    // U+FEFB is the lam-alef ligature; NFKC gives lam + alef.
    expect(normaliseArabic("ﻻ")).toBe("لا");
  });
});

describe("normaliseArabic: Urdu letters and Arabic separators (Task 12)", () => {
  it("maps Urdu kaf, farsi yeh, yeh barree and heh goal to their Arabic letters", () => {
    expect(normaliseArabic("کیےہ")).toBe("كييه");
    expect(normaliseArabic("وصولی")).toBe("وصولي");
    expect(normaliseArabic("اشیائے")).toBe(normaliseArabic("اشيائي"));
  });

  it("reads the Arabic decimal and thousands separators between digits", () => {
    expect(normaliseArabic("١٬١٤٠")).toBe("1,140");
    expect(normaliseArabic("٣٫٥")).toBe("3.5");
    expect(normaliseArabic("7٬900٫50")).toBe("7,900.50");
  });

  it("turns the Arabic separators into a space when not between two digits", () => {
    expect(normaliseArabic("مشروبات٬ اغذية٫")).toBe("مشروبات اغذيه");
    expect(normaliseArabic("12٬ 5")).toBe("12 5");
  });
});
