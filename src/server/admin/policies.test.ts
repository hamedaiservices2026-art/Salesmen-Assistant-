import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { deletePolicy, getPolicy, listPolicies, savePolicy } from "./policies";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
  // The demo seed carries one policy document (plan 3); these tests start from none (R44).
  await db.delete(s.policyDocuments).where(eq(s.policyDocuments.companyId, "demo-co"));
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({ db, companyId, userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const admin = () => ctxOf(seed.adminId, "admin");
async function otherAdmin(): Promise<Ctx> {
  await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "O", login: "admin@other.test" });
  return ctxOf("other-admin", "admin", "other-co");
}
const BODY = "مقدمة\n# المرتجعات\nنص\n2) الخصم\nنص2";

async function create(body = BODY, ctx = admin()) {
  const r = await savePolicy(ctx, { title: "سياسة", locale: "ar", body });
  if (!r.ok || !("id" in r)) throw new Error("create failed");
  return r;
}

describe("savePolicy", () => {
  it("stores the body and its sections", async () => {
    const r = await create();
    expect(r.sections).toHaveLength(3);
    const got = await getPolicy(admin(), r.id);
    expect(got).toMatchObject({ ok: true, policy: { title: "سياسة", locale: "ar", body: BODY, version: 0, sectionsCount: 3 } });
    if (got.ok) expect(got.policy.sections[1]).toEqual({ label: "المرتجعات", text: "نص" });
    const [row] = await db.select().from(s.policyDocuments).where(eq(s.policyDocuments.id, r.id));
    expect(row).toMatchObject({ companyId: "demo-co", uploadedBy: seed.adminId });
  });

  it("refuses 200 001 characters, counted as code points, and accepts 200 000", async () => {
    expect(await savePolicy(admin(), { title: "t", locale: "en", body: "x".repeat(200_001) })).toEqual({ ok: false, errors: { body: "too_long" } });
    // 100 001 astral characters are 200 002 UTF-16 units but 100 001 code points: allowed.
    expect((await savePolicy(admin(), { title: "t", locale: "en", body: "😀".repeat(100_001) })).ok).toBe(true);
    expect((await savePolicy(admin(), { title: "t", locale: "en", body: "x".repeat(200_000) })).ok).toBe(true);
    expect(await savePolicy(admin(), { title: "t", locale: "en", body: "😀".repeat(200_001) })).toEqual({ ok: false, errors: { body: "too_long" } });
  });

  it("requires a body, a title of at most 200 characters and a supported locale", async () => {
    expect(await savePolicy(admin(), { title: "t", locale: "en", body: " \n\t" })).toEqual({ ok: false, errors: { body: "required" } });
    expect(await savePolicy(admin(), { title: "  ", locale: "en", body: "x" })).toEqual({ ok: false, errors: { title: "required" } });
    expect(await savePolicy(admin(), { title: "t".repeat(201), locale: "en", body: "x" })).toEqual({ ok: false, errors: { title: "too_long" } });
    expect(await savePolicy(admin(), { title: "t", locale: "fr" as never, body: "x" })).toEqual({ ok: false, errors: { locale: "invalid" } });
    expect(await listPolicies(admin())).toEqual([]);
  });

  it("stores markup verbatim as text, and survives NUL and lone surrogates", async () => {
    const r = await create("<script>alert(1)</script>\n# <b>x</b>\n\u0000a\ud800b");
    const got = await getPolicy(admin(), r.id);
    if (!got.ok) throw new Error("missing");
    expect(got.policy.body.startsWith("<script>alert(1)</script>\n# <b>x</b>\n")).toBe(true);
    expect(got.policy.sections[1]!.label).toBe("<b>x</b>");
    expect(got.policy.body).not.toContain("\u0000");
    // A lone surrogate is replaced with U+FFFD (toWellFormed), not removed; NUL is removed.
    expect(got.policy.body.endsWith("a\ufffdb")).toBe(true);
  });

  it("edits with the version it read; a second save with the old version is stale", async () => {
    const r = await create();
    const a = await savePolicy(admin(), { id: r.id, version: 0, title: "A", locale: "en", body: "one" });
    expect(a).toMatchObject({ ok: true, version: 1 });
    expect(await savePolicy(admin(), { id: r.id, version: 0, title: "B", locale: "en", body: "two" })).toEqual({ ok: false, error: "stale" });
    expect(await savePolicy(admin(), { id: r.id, title: "B", locale: "en", body: "two" })).toEqual({ ok: false, error: "stale" });
    const got = await getPolicy(admin(), r.id);
    expect(got).toMatchObject({ ok: true, policy: { title: "A", body: "one", version: 1, sectionsCount: 1 } });
    expect(await savePolicy(admin(), { id: r.id, version: 1, title: "C", locale: "ur", body: "three" })).toMatchObject({ ok: true, version: 2 });
  });

  it("two simultaneous saves: exactly one wins", async () => {
    const r = await create();
    const [x, y] = await Promise.all([
      savePolicy(admin(), { id: r.id, version: 0, title: "X", locale: "en", body: "x" }),
      savePolicy(admin(), { id: r.id, version: 0, title: "Y", locale: "en", body: "y" }),
    ]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
  });
});

describe("company isolation and roles", () => {
  it("get, delete and edit of another company's id answer not_found and change nothing", async () => {
    const mine = await create();
    const other = await otherAdmin();
    const theirs = await create("other text", other);
    expect(await getPolicy(admin(), theirs.id)).toEqual({ ok: false, error: "not_found" });
    expect(await deletePolicy(admin(), theirs.id)).toEqual({ ok: false, error: "not_found" });
    expect(await savePolicy(admin(), { id: theirs.id, version: 0, title: "x", locale: "en", body: "hacked" })).toEqual({ ok: false, error: "not_found" });
    expect(await getPolicy(admin(), "nope")).toEqual({ ok: false, error: "not_found" });
    expect(await getPolicy(other, mine.id)).toEqual({ ok: false, error: "not_found" });
    const got = await getPolicy(other, theirs.id);
    expect(got).toMatchObject({ ok: true, policy: { body: "other text", version: 0 } });
    expect((await listPolicies(admin())).map((p) => p.id)).toEqual([mine.id]);
  });

  it("deletes its own", async () => {
    const r = await create();
    expect(await deletePolicy(admin(), r.id)).toEqual({ ok: true });
    expect(await listPolicies(admin())).toEqual([]);
    expect(await deletePolicy(admin(), r.id)).toEqual({ ok: false, error: "not_found" });
  });

  it("lists title, locale, sections count and date without the body", async () => {
    await create();
    const [row] = await listPolicies(admin());
    expect(row).toMatchObject({ title: "سياسة", locale: "ar", sectionsCount: 3, version: 0 });
    expect(row!.updatedAt).toBeInstanceOf(Date);
    expect(row).not.toHaveProperty("body");
  });

  it("refuses a rep, a supervisor and an owner", async () => {
    for (const role of ["rep", "supervisor", "owner"] as const) {
      const ctx = ctxOf("ahmed", role);
      await expect(savePolicy(ctx, { title: "t", locale: "en", body: "x" })).rejects.toBeInstanceOf(Forbidden);
      await expect(listPolicies(ctx)).rejects.toBeInstanceOf(Forbidden);
      await expect(getPolicy(ctx, "x")).rejects.toBeInstanceOf(Forbidden);
      await expect(deletePolicy(ctx, "x")).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
