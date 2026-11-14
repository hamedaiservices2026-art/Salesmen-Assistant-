import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDay } from "./today";

afterEach(() => vi.unstubAllEnvs());

describe("currentDay APP_TODAY", () => {
  it("returns APP_TODAY when set outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_TODAY", "2026-11-14");
    expect(currentDay("Asia/Riyadh")).toBe("2026-11-14");
  });
  it("ignores APP_TODAY in production unless ALLOW_APP_TODAY is 1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_TODAY", "2001-01-01");
    expect(currentDay("Asia/Riyadh")).not.toBe("2001-01-01");
    vi.stubEnv("ALLOW_APP_TODAY", "1");
    expect(currentDay("Asia/Riyadh")).toBe("2001-01-01");
  });
});
