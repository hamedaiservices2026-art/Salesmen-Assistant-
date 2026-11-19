import { describe, expect, it } from "vitest";
import { canonicalTimeZone } from "./time-zone";

describe("canonicalTimeZone", () => {
  it("accepts IANA names and UTC", () => {
    expect(canonicalTimeZone("Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });
  it("returns the canonical spelling for any case", () => {
    expect(canonicalTimeZone("asia/riyadh")).toBe("Asia/Riyadh");
    expect(canonicalTimeZone(" ASIA/DUBAI ")).toBe("Asia/Dubai");
    expect(canonicalTimeZone("utc")).toBe("UTC");
  });
  it("accepts zones the runtime knows but the supported list may lack, canonicalised by the runtime (B3)", () => {
    for (const z of ["Asia/Kolkata", "Etc/GMT+3"]) {
      const expected = new Intl.DateTimeFormat("en", { timeZone: z }).resolvedOptions().timeZone;
      expect(canonicalTimeZone(z)).toBe(expected);
    }
  });
  it("still rejects an invalid name with a slash", () => {
    expect(canonicalTimeZone("Mars/Base")).toBeNull();
    expect(canonicalTimeZone("Asia/Nowhere")).toBeNull();
  });
  it("rejects unknown names, offsets and empty input", () => {
    expect(canonicalTimeZone("Mars/Base")).toBeNull();
    expect(canonicalTimeZone("+03:00")).toBeNull();
    expect(canonicalTimeZone("utc+3")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
    expect(canonicalTimeZone("   ")).toBeNull();
  });
});
