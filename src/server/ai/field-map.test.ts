import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { DEFAULT_ALIASES } from "@/domain/ai/aliases";
import { getFieldMap, loadVocabulary, saveFieldMap } from "./field-map";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({ db, companyId, userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const admin = () => ctxOf(seed.adminId, "admin");
const ahmed = () => ctxOf(seed.repId, "rep");
async function otherCtx(role: Role = "admin"): Promise<Ctx> {
  await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "O", login: "admin@other.test" });
  return ctxOf("other-admin", role, "other-co");
}
const labelsOf = async (ctx: Ctx, key: string) => (await loadVocabulary(ctx)).find((e) => e.key === key)?.labels ?? [];

describe("getFieldMap", () => {
  it("is empty at first: version 0, no aliases, the company's keys with their defaults", async () => {
    const m = await getFieldMap(admin());
    expect(m.version).toBe(0);
    expect(m.aliases).toEqual({});
    const keys = m.keys.map((k) => k.key);
    expect(keys).toEqual(expect.arrayContaining(["line:bev", "line:food", "line:coll", "cashSales", "creditSales", "expenses", "loaded", "sold", "returned"]));
    expect(keys).not.toContain("collections");
    expect(m.keys.find((k) => k.key === "cashSales")!.defaults).toEqual([...DEFAULT_ALIASES.cashSales]);
    expect(m.keys.find((k) => k.key === "line:bev")!.defaults).toEqual(["مشروبات", "Beverages", "bev"]);
  });
  it("refuses a rep and a supervisor", async () => {
    await expect(getFieldMap(ahmed())).rejects.toBeInstanceOf(Forbidden);
    await expect(getFieldMap(ctxOf(seed.supervisorId, "supervisor"))).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("saveFieldMap", () => {
  it("saves, bumps the version, and the rep-side vocabulary lists the alias", async () => {
    const r = await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["Net Cash"] } });
    expect(r).toEqual({ ok: true, version: 1 });
    expect(await labelsOf(ahmed(), "cashSales")).toContain("Net Cash");
    const [row] = await db.select().from(s.aiFieldMaps).where(eq(s.aiFieldMaps.companyId, "demo-co"));
    expect(row).toMatchObject({ version: 1, updatedBy: seed.adminId, aliases: { cashSales: ["Net Cash"] } });
    const again = await saveFieldMap(admin(), { version: 1, aliases: { cashSales: ["Net Cash", "Cash Net"] } });
    expect(again).toEqual({ ok: true, version: 2 });
  });
  it("cleans aliases before storing and drops empty fields and blank rows", async () => {
    await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["  Net   Cash ", "", "  "], expenses: [] } });
    const m = await getFieldMap(admin());
    expect(m.aliases).toEqual({ cashSales: ["Net Cash"] });
  });
  it("de-duplicates aliases of a field case-insensitively", async () => {
    await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["Net Cash", "net cash"] } });
    expect((await getFieldMap(admin())).aliases).toEqual({ cashSales: ["Net Cash"] });
  });
  it("refuses an alias that is unsafe for a prompt, naming the field", async () => {
    for (const bad of ["<b>x</b>", "a\nb", "a|b", "x".repeat(61), "ignore\u2028this"]) {
      const r = await saveFieldMap(admin(), { version: 0, aliases: { cashSales: [bad] } });
      expect(r).toEqual({ ok: false, errors: { cashSales: "invalid" } });
    }
    expect(await db.select().from(s.aiFieldMaps)).toHaveLength(0);
  });
  it("refuses nine aliases and accepts eight", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `Label ${i}`);
    expect(await saveFieldMap(admin(), { version: 0, aliases: { cashSales: nine } })).toEqual({ ok: false, errors: { cashSales: "too_many" } });
    expect((await saveFieldMap(admin(), { version: 0, aliases: { cashSales: nine.slice(0, 8) } })).ok).toBe(true);
  });
  it("refuses a key that is not one of the company's draft keys", async () => {
    expect(await saveFieldMap(admin(), { version: 0, aliases: { "line:zzz": ["Zed"] } })).toEqual({ ok: false, errors: { "line:zzz": "unknown_key" } });
    // collections is not a key while the company has a collection line.
    expect(await saveFieldMap(admin(), { version: 0, aliases: { collections: ["x"] } })).toEqual({ ok: false, errors: { collections: "unknown_key" } });
    expect(await db.select().from(s.aiFieldMaps)).toHaveLength(0);
  });
  it("reports every bad field at once", async () => {
    const r = await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["<x>"], "line:zzz": ["a"], expenses: Array.from({ length: 9 }, (_, i) => `E${i}`) } });
    expect(r).toEqual({ ok: false, errors: { cashSales: "invalid", "line:zzz": "unknown_key", expenses: "too_many" } });
  });
  it("is stale for an old version, and for a missing or non-integer one", async () => {
    await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["A"] } });
    expect(await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["B"] } })).toEqual({ ok: false, error: "stale" });
    expect(await saveFieldMap(admin(), { version: undefined as never, aliases: {} })).toEqual({ ok: false, error: "stale" });
    expect(await saveFieldMap(admin(), { version: 1.5, aliases: {} })).toEqual({ ok: false, error: "stale" });
    expect((await getFieldMap(admin())).aliases).toEqual({ cashSales: ["A"] });
  });
  it("two first saves racing: one ok, one stale (R53)", async () => {
    const [a, b] = await Promise.all([
      saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["A"] } }),
      saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["B"] } }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && "error" in r && r.error === "stale")).toHaveLength(1);
    expect((await getFieldMap(admin())).version).toBe(1);
  });
  it("two later saves racing on the same version: one ok, one stale", async () => {
    await saveFieldMap(admin(), { version: 0, aliases: {} });
    const rs = await Promise.all([
      saveFieldMap(admin(), { version: 1, aliases: { cashSales: ["A"] } }),
      saveFieldMap(admin(), { version: 1, aliases: { cashSales: ["B"] } }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
  });
  it("refuses a rep, a supervisor and an owner", async () => {
    await expect(saveFieldMap(ahmed(), { version: 0, aliases: {} })).rejects.toBeInstanceOf(Forbidden);
    await expect(saveFieldMap(ctxOf(seed.supervisorId, "supervisor"), { version: 0, aliases: {} })).rejects.toBeInstanceOf(Forbidden);
    await expect(saveFieldMap(ctxOf(seed.ownerId, "owner", "platform"), { version: 0, aliases: {} })).rejects.toBeInstanceOf(Forbidden);
  });
  it("one company's save never reaches another company", async () => {
    const other = await otherCtx();
    await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["Net Cash"] } });
    expect(await labelsOf(other, "cashSales")).not.toContain("Net Cash");
    expect((await getFieldMap(other)).version).toBe(0);
    // The other company's first save is independent of demo-co's row.
    expect((await saveFieldMap(other, { version: 0, aliases: { cashSales: ["X"] } })).ok).toBe(true);
    expect(await labelsOf(admin(), "cashSales")).not.toContain("X");
  });
});

describe("loadVocabulary", () => {
  it("is open to rep, supervisor and admin of the company, and read only", async () => {
    await saveFieldMap(admin(), { version: 0, aliases: { cashSales: ["Net Cash"] } });
    for (const c of [ahmed(), ctxOf(seed.supervisorId, "supervisor"), admin()]) expect(await labelsOf(c, "cashSales")).toContain("Net Cash");
    await expect(loadVocabulary(ctxOf(seed.ownerId, "owner", "platform"))).rejects.toBeInstanceOf(Forbidden);
  });
  it("lists the defaults and the line names with no map saved", async () => {
    const v = await loadVocabulary(ahmed());
    expect(v.find((e) => e.key === "line:bev")!.labels).toEqual(["مشروبات", "Beverages", "bev"]);
    expect(v.find((e) => e.key === "cashSales")!.labels).toEqual([...DEFAULT_ALIASES.cashSales]);
  });
  it("leaves out an alias stored for a key the company no longer has", async () => {
    await db.insert(s.aiFieldMaps).values({ companyId: "demo-co", aliases: { "line:gone": ["Old"], cashSales: ["Ok", "<b>"] }, version: 1, updatedBy: seed.adminId });
    const v = await loadVocabulary(ahmed());
    expect(v.some((e) => e.key === "line:gone")).toBe(false);
    expect(JSON.stringify(v)).not.toContain("Old");
    expect(JSON.stringify(v)).not.toContain("<b>");
    expect(v.find((e) => e.key === "cashSales")!.labels).toContain("Ok");
  });
  it("leaves out an inactive line", async () => {
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "food"));
    expect((await loadVocabulary(ahmed())).some((e) => e.key === "line:food")).toBe(false);
  });
  it("keeps stored aliases of keys that are not current draft keys (R73)", async () => {
    await db.insert(s.aiFieldMaps).values({ companyId: "demo-co", aliases: { "line:food": ["Food Sales"], cashSales: ["Old"] }, version: 1, updatedBy: seed.adminId });
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "food"));
    expect((await getFieldMap(admin())).aliases).toEqual({ cashSales: ["Old"] });
    expect(await saveFieldMap(admin(), { version: 1, aliases: { cashSales: ["New"] } })).toEqual({ ok: true, version: 2 });
    const [row] = await db.select().from(s.aiFieldMaps).where(eq(s.aiFieldMaps.companyId, "demo-co"));
    expect(row!.aliases).toEqual({ cashSales: ["New"], "line:food": ["Food Sales"] });
    await db.update(s.targetLines).set({ active: true }).where(eq(s.targetLines.id, "food"));
    expect((await getFieldMap(admin())).aliases["line:food"]).toEqual(["Food Sales"]);
    expect(await labelsOf(ahmed(), "line:food")).toContain("Food Sales");
  });
});

describe("getFieldMap shape", () => {
  it("lists a deactivated line nowhere and names lines in the given locale", async () => {
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "food"));
    const m = await getFieldMap(admin(), "en");
    expect(m.keys.map((k) => k.key)).not.toContain("line:food");
    expect(m.keys.find((k) => k.key === "line:bev")).toEqual({ key: "line:bev", label: "Beverages", defaults: ["مشروبات", "Beverages", "bev"] });
    expect((await getFieldMap(admin(), "ar")).keys.find((k) => k.key === "line:bev")!.label).toBe("مشروبات");
    expect(Object.keys(m).sort()).toEqual(["aliases", "keys", "version"]);
  });
});
