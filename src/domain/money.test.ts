import { describe, expect, it } from "vitest";
import { formatAmount, formatPercent, inputValue, parseAmount } from "./money";

describe("formatAmount", () => {
  it("groups case counts", () => expect(formatAmount(1140, "cases")).toBe("1,140"));
  it("converts halalas to SAR, hiding zero decimals", () => {
    expect(formatAmount(8280000, "value")).toBe("82,800");
    expect(formatAmount(97855, "value")).toBe("978.55");
  });
  it("always shows two decimals when the fraction is non-zero", () => {
    expect(formatAmount(97850, "value")).toBe("978.50");
    expect(formatAmount(-97850, "value")).toBe("-978.50");
    expect(formatAmount(825050, "value")).toBe("8,250.50");
  });
});

describe("inputValue", () => {
  it("shows cases as a plain number", () => expect(inputValue(1140, "cases")).toBe("1140"));
  it("shows value without grouping, with decimals only when needed", () => {
    expect(inputValue(1900000, "value")).toBe("19000");
    expect(inputValue(825050, "value")).toBe("8250.50");
  });
  it("parses back to the same amount", () => {
    for (const n of [0, 5, 825050, 1900000, 97855]) expect(parseAmount(inputValue(n, "value"), "value")).toBe(n);
  });
});

describe("formatPercent", () => {
  it("floors to whole percent", () => expect(formatPercent(1140, 3000)).toBe("38%"));
  it("shows a dash when denominator is 0", () => expect(formatPercent(5, 0)).toBe("—"));
});

describe("parseAmount separators", () => {
  const units = ["cases", "value", "outlets"] as const;
  it("rejects a comma that is not a thousands separator, for every unit", () => {
    for (const unit of units)
      for (const bad of ["0,5", "0,500", "0,050", "00,500", "2,5", "8250,50", "12,34", ",5", "1,14", "1,1400", "80,5", "1,٥", "1 14", "٠،٥".replace("،", ",")])
        expect(parseAmount(bad, unit), `${bad} ${unit}`).toBeNull();
  });
  it("accepts grouped thousands, also with a decimal part for value", () => {
    for (const unit of units) {
      expect(parseAmount("1,140", unit)).toBe(unit === "value" ? 114000 : 1140);
      expect(parseAmount("82٬800", unit)).toBe(unit === "value" ? 8280000 : 82800);
      expect(parseAmount("1 140", unit)).toBe(unit === "value" ? 114000 : 1140);
    }
    expect(parseAmount("1,500.50", "value")).toBe(150050);
    expect(parseAmount("٠٫٥", "value")).toBe(50);
    expect(parseAmount("1,234,567", "cases")).toBe(1234567);
  });
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

describe("outlets unit", () => {
  it("formats and parses like cases", () => {
    expect(formatAmount(1234, "outlets")).toBe("1,234");
    expect(parseAmount("١٢", "outlets")).toBe(12);
    expect(parseAmount("1.5", "outlets")).toBeNull();
  });
});
