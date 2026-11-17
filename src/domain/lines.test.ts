import { describe, expect, it } from "vitest";
import { isLineCode, lineName, lineShapeError } from "./lines";

describe("lineShapeError", () => {
  it("rejects a collection line that is not in value", () =>
    expect(lineShapeError({ unit: "cases", kind: "collection" })).toBe("collection_needs_value"));
  it("rejects a coverage line that is not in outlets", () =>
    expect(lineShapeError({ unit: "value", kind: "coverage" })).toBe("coverage_needs_outlets"));
  it("rejects outlets on a non-coverage line", () =>
    expect(lineShapeError({ unit: "outlets", kind: "sales" })).toBe("outlets_only_for_coverage"));
  it("accepts a coverage line in outlets", () =>
    expect(lineShapeError({ unit: "outlets", kind: "coverage" })).toBeNull());
  it("accepts ordinary lines", () => {
    expect(lineShapeError({ unit: "cases", kind: "sales" })).toBeNull();
    expect(lineShapeError({ unit: "value", kind: "collection" })).toBeNull();
  });
});

describe("isLineCode", () => {
  it("accepts lowercase codes", () => expect(isLineCode("can185")).toBe(true));
  it("rejects spaces and capitals", () => expect(isLineCode("Can 185")).toBe(false));
  it("limits the length to 32", () => {
    expect(isLineCode("a".repeat(32))).toBe(true);
    expect(isLineCode("a".repeat(33))).toBe(false);
  });
});

describe("lineName", () => {
  const l = { nameAr: "أ", nameEn: "A", nameUr: "" };
  it("falls back to Arabic when the Urdu name is empty", () => expect(lineName(l, "ur")).toBe("أ"));
  it("returns the English name", () => expect(lineName(l, "en")).toBe("A"));
  it("returns the Arabic name", () => expect(lineName(l, "ar")).toBe("أ"));
});
