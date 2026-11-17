import { describe, expect, it } from "vitest";
import { seedRefusal } from "./seed-guard";

describe("seedRefusal", () => {
  it("allows seeding the local database when DATABASE_URL is unset or empty", () => {
    expect(seedRefusal({})).toBeNull();
    expect(seedRefusal({ DATABASE_URL: "" })).toBeNull();
  });
  it("refuses when DATABASE_URL is set without ALLOW_DEMO_SEED=1", () => {
    expect(seedRefusal({ DATABASE_URL: "postgres://x" })).toMatch(/ALLOW_DEMO_SEED=1/);
    // The demo owner and admin carry published passwords: the refusal says so, so they never reach a real database unnoticed.
    expect(seedRefusal({ DATABASE_URL: "postgres://x" })).toMatch(/owner and admin accounts with published passwords/);
    expect(seedRefusal({ DATABASE_URL: "postgres://x", ALLOW_DEMO_SEED: "0" })).not.toBeNull();
  });
  it("still refuses ALLOW_DEMO_SEED values other than exactly 1", () => {
    for (const v of ["true", "TRUE", "yes", " ", " 1", "1 ", ""]) {
      expect(seedRefusal({ DATABASE_URL: "postgres://x", ALLOW_DEMO_SEED: v })).not.toBeNull();
    }
  });
  it("allows it when ALLOW_DEMO_SEED is 1", () => {
    expect(seedRefusal({ DATABASE_URL: "postgres://x", ALLOW_DEMO_SEED: "1" })).toBeNull();
  });
});
