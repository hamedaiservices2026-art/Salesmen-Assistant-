import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent, parseAmount } from "./money";

describe("formatAmount", () => {
  it("groups case counts", () => expect(formatAmount(1140, "cases")).toBe("1,140"));
  it("converts halalas to SAR, hiding zero decimals", () => {
    expect(formatAmount(8280000, "value")).toBe("82,800");
    expect(formatAmount(97855, "value")).toBe("978.55");
  });
});

describe("formatPercent", () => {
  it("floors to whole percent", () => expect(formatPercent(1140, 3000)).toBe("38%"));
  it("shows a dash when denominator is 0", () => expect(formatPercent(5, 0)).toBe("—"));
});

describe("parseAmount", () => {
  it("parses Arabic-Indic digits", () => expect(parseAmount("١٢٠", "cases")).toBe(120));
  it("parses grouping separators", () => {
    expect(parseAmount("1,140", "cases")).toBe(1140);
    expect(parseAmount("82٬800", "value")).toBe(8280000);
  });
  it("parses decimals for value into halalas", () => expect(parseAmount("978.55", "value")).toBe(97855));
  it("rejects invalid input", () => {
    expect(parseAmount("12.5", "cases")).toBeNull();
    expect(parseAmount("abc", "value")).toBeNull();
    expect(parseAmount("", "cases")).toBeNull();
    expect(parseAmount("-3", "cases")).toBeNull();
  });
});
