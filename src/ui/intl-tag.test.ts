import { describe, expect, it } from "vitest";
import { dayMonth } from "./intl-tag";

describe("dayMonth", () => {
  it("shows an ISO date as the day and month of the language, with Western digits", () => {
    expect(dayMonth("2026-11-12", "en")).toBe("12 November");
    expect(dayMonth("2026-11-12", "ar")).toMatch(/^12 /);
    expect(dayMonth("2026-11-12", "ar")).not.toMatch(/[٠-٩]/);
    expect(dayMonth("2026-11-12", "ur")).toMatch(/12/);
  });

  it("gives back anything that is not a date as it is", () => {
    expect(dayMonth("2026-13-40", "en")).toBe("2026-13-40");
    expect(dayMonth("x", "ar")).toBe("x");
  });
});
