import { describe, expect, it } from "vitest";
import { unitLabel } from "./unit-label";

const t = (key: string) => `T:${key}`;

describe("unitLabel", () => {
  it("asks for the unit key for cases and outlets", () => {
    expect(unitLabel(t, "cases", "AED")).toBe("T:home.unit.cases");
    expect(unitLabel(t, "outlets", "SAR")).toBe("T:home.unit.outlets");
  });
  it("asks for the currency key for value", () => {
    expect(unitLabel(t, "value", "AED")).toBe("T:currency.AED");
    expect(unitLabel(t, "value", "SAR")).toBe("T:currency.SAR");
  });
});
