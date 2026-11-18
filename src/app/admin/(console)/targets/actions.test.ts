import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { saveTargetsAction } from "./actions";

const h = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
    }
  }
  return { Redirect, db: undefined as unknown, jar: new Map<string, string>() };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new h.Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db/client", () => ({ getDb: async () => h.db }));

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  h.db = db;
  h.jar.clear();
  seed = await seedDemo(db);
  h.jar.set("session", await createSession(db, seed.adminId));
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const amountOf = async (userId: string, lineId: string) =>
  (await db.select().from(s.targets).where(and(eq(s.targets.userId, userId), eq(s.targets.lineId, lineId), eq(s.targets.month, 11))))[0]?.amount;

describe("saveTargetsAction", () => {
  it("saves typed amounts, parsed by the line's unit", async () => {
    const r = await saveTargetsAction({}, form({ ym: "2026-11", "c:ahmed|bev": "3,200", "c:ahmed|food": "190,000.50" }));
    expect(r).toEqual({ changed: 2 });
    expect(await amountOf("ahmed", "bev")).toBe(3200);
    expect(await amountOf("ahmed", "food")).toBe(19_000_050);
  });

  it("an emptied cell removes the target", async () => {
    const r = await saveTargetsAction({}, form({ ym: "2026-11", "c:ahmed|bev": "  ", "c:ahmed|food": "180,000" }));
    expect(r).toEqual({ changed: 1 });
    expect(await amountOf("ahmed", "bev")).toBeUndefined();
    expect(await amountOf("ahmed", "food")).toBe(18_000_000);
  });

  it("an unparsable cell refuses the whole save and keeps what was typed", async () => {
    const r = await saveTargetsAction({}, form({ ym: "2026-11", "c:ahmed|bev": "3200", "c:khaled|food": "12x" }));
    expect(r.errors).toEqual({ "khaled|food": "invalid" });
    expect(r.values).toMatchObject({ "ahmed|bev": "3200", "khaled|food": "12x" });
    expect(await amountOf("ahmed", "bev")).toBe(3000);
    expect(await db.select().from(s.targetChanges)).toHaveLength(0);
  });

  it("a forged cell key of another company is refused and nothing is saved in either company", async () => {
    const otherBefore = await amountOf("other-rep", "other-line");
    const r = await saveTargetsAction({}, form({ ym: "2026-11", "c:ahmed|bev": "3200", "c:other-rep|other-line": "5" }));
    expect(r.errors).toEqual({ "other-rep|other-line": "not_found" });
    expect(await amountOf("ahmed", "bev")).toBe(3000);
    expect(await amountOf("other-rep", "other-line")).toBe(otherBefore);
    expect(await db.select().from(s.targetChanges)).toHaveLength(0);
  });

  it("an emptied forged cell does not remove another company's target", async () => {
    const otherBefore = await amountOf("other-rep", "other-line");
    const r = await saveTargetsAction({}, form({ ym: "2026-11", "c:other-rep|other-line": "" }));
    expect(r.errors).toEqual({ "other-rep|other-line": "not_found" });
    expect(await amountOf("other-rep", "other-line")).toBe(otherBefore);
  });

  it("refuses a bad month, and a rep session is turned away", async () => {
    expect(await saveTargetsAction({}, form({ ym: "1999-12", "c:ahmed|bev": "1" }))).toEqual({ errors: { period: "invalid" } });
    h.jar.set("session", await createSession(db, "ahmed"));
    await expect(saveTargetsAction({}, form({ ym: "2026-11", "c:ahmed|bev": "1" }))).rejects.toBeInstanceOf(h.Redirect);
    expect(await amountOf("ahmed", "bev")).toBe(3000);
  });
});
