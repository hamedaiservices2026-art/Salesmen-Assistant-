import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { saveLocale } from "./locale";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctx = (): Ctx => ({
  db,
  companyId: seed.companyId,
  userId: seed.repId,
  role: "rep",
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const stored = async (id: string) =>
  (
    await db
      .select({ l: s.users.locale })
      .from(s.users)
      .where(eq(s.users.id, id))
  )[0]!.l;

describe("saveLocale", () => {
  it("stores a supported language on the user row", async () => {
    expect(await saveLocale(ctx(), "en")).toEqual({ ok: true });
    expect(await stored(seed.repId)).toBe("en");
  });
  it("rejects an unsupported language and leaves the row unchanged", async () => {
    const before = await stored(seed.repId);
    expect(await saveLocale(ctx(), "fr")).toEqual({ ok: false });
    expect(await stored(seed.repId)).toBe(before);
  });
  it("does not touch another user's row", async () => {
    const before = await stored(seed.otherRepId);
    await saveLocale(ctx(), "ur");
    expect(await stored(seed.otherRepId)).toBe(before);
  });
});

describe("setLocale cookie", () => {
  it("is secure in production, like the session cookie", async () => {
    const set = vi.fn();
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => ({ set }) }));
    vi.stubEnv("NODE_ENV", "production");
    const { setLocale } = await import("./locale");
    expect(await setLocale(ctx(), "en")).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith("locale", "en", expect.objectContaining({ secure: true }));
    vi.unstubAllEnvs();
    vi.doUnmock("next/headers");
  });
});
