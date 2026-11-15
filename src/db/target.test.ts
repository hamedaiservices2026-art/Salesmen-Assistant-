import { describe, expect, it } from "vitest";
import { resolveDbTarget } from "./target";

describe("resolveDbTarget", () => {
  it("uses Postgres when DATABASE_URL is set, in any mode", () => {
    expect(resolveDbTarget({ DATABASE_URL: "postgres://x" })).toEqual({ kind: "postgres", url: "postgres://x" });
    expect(resolveDbTarget({ DATABASE_URL: "postgres://x", NODE_ENV: "production" })).toEqual({
      kind: "postgres",
      url: "postgres://x",
    });
  });
  it("uses local PGlite when nothing is set outside production", () => {
    expect(resolveDbTarget({})).toEqual({ kind: "pglite", dir: ".data/pglite" });
    expect(resolveDbTarget({ NODE_ENV: "development", DATABASE_URL: "" })).toEqual({ kind: "pglite", dir: ".data/pglite" });
  });
  it("refuses a silent local database in production", () => {
    expect(() => resolveDbTarget({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is not set/);
    expect(() => resolveDbTarget({ NODE_ENV: "production", DATABASE_URL: "" })).toThrow(/DATABASE_URL is not set/);
  });
  it("lets a local production build opt in with ALLOW_LOCAL_DB=1", () => {
    expect(resolveDbTarget({ NODE_ENV: "production", ALLOW_LOCAL_DB: "1" })).toEqual({
      kind: "pglite",
      dir: ".data/pglite",
    });
  });
  it("honours PGLITE_DIR", () => {
    expect(resolveDbTarget({ PGLITE_DIR: "/tmp/x" })).toEqual({ kind: "pglite", dir: "/tmp/x" });
  });
});
