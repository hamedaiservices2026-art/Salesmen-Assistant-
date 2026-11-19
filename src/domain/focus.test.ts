import { describe, expect, it } from "vitest";
import { focusName } from "./focus";

describe("focusName", () => {
  const f = { name: "عصير مانجو", nameEn: "Mango juice", nameUr: null };
  it("uses the name of the requested language", () => {
    expect(focusName(f, "en")).toBe("Mango juice");
    expect(focusName(f, "ar")).toBe("عصير مانجو");
  });
  it("falls back to the Arabic name when the requested one is missing or blank", () => {
    expect(focusName(f, "ur")).toBe("عصير مانجو");
    expect(focusName({ ...f, nameEn: "  " }, "en")).toBe("عصير مانجو");
  });
});
