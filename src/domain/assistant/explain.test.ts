import { describe, expect, it } from "vitest";
import { explainHref, explainOffered, isNotificationId } from "./explain";

describe("explain link", () => {
  it("accepts only the shape of a notification id", () => {
    expect(isNotificationId("n_abc-123")).toBe(true);
    expect(isNotificationId("a".repeat(64))).toBe(true);
    for (const bad of ["", "a".repeat(65), "a b", "a/b", "../x", "a?b=1", "a&b", "<x>", undefined, null, 5, "ا"]) expect(isNotificationId(bad)).toBe(false);
  });

  it("builds the address from a valid id only", () => {
    expect(explainHref("n_abc-123")).toBe("/app/assistant?explain=n_abc-123");
    expect(explainHref("a b&c")).toBeNull();
  });

  it("is offered when AI is available or only the notice is missing", () => {
    expect(explainOffered({ available: true, reason: null })).toBe(true);
    expect(explainOffered({ available: false, reason: "no_notice" })).toBe(true);
    for (const reason of ["disabled", "company_off", "no_provider", "quota", "rate_limited", "failed"] as const)
      expect(explainOffered({ available: false, reason })).toBe(false);
  });
});
