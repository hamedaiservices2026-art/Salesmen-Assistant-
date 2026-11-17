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
  it("rejects unknown names, offsets and empty input", () => {
    expect(canonicalTimeZone("Mars/Base")).toBeNull();
    expect(canonicalTimeZone("+03:00")).toBeNull();
    expect(canonicalTimeZone("utc+3")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
    expect(canonicalTimeZone("   ")).toBeNull();
  });
});
