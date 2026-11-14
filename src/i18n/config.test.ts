import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, dirOf } from "./config";

describe("i18n config", () => {
  it("defaults to Arabic", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
    expect(LOCALES).toEqual(["ar", "en", "ur"]);
  });
  it("gives direction per locale", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("ur")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });
});
