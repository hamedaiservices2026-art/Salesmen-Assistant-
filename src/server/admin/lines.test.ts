import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getCommissionView } from "@/server/repos/commission";
import { getMonthView } from "@/server/repos/month-view";
import { listAllLines, moveLine, saveLine, setLineActive, type LineInput } from "./lines";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const admin = () => ctxOf(seed.adminId, "admin");
const ahmed = () => ctxOf("ahmed", "rep");

async function otherAdmin(): Promise<Ctx> {
  await db.insert(s.users).values({
    id: "other-admin",
    companyId: "other-co",
    role: "admin",
    name: "Other Admin",
    login: "admin@other.test",
  });
  return ctxOf("other-admin", "admin", "other-co");
}

/** Every line row of both companies, so "nothing changed in either company" is one comparison. */
async function snapshot() {
  const lines = (await db.select().from(s.targetLines)).map((l) => ({ ...l, updatedAt: null }));
  return lines.sort((a, b) => a.id.localeCompare(b.id));
}

/** A day after the published November scheme, so deactivating its lines is allowed. */
const AFTER_NOV = "2026-12-05";

const input = (over: Partial<LineInput> = {}): LineInput => ({
  code: "newline",
  nameAr: "خط جديد",
  nameEn: "New line",
  nameUr: "نئی لائن",
  unit: "cases",
  kind: "sales",
  sort: 10,
  active: true,
  ...over,
});

const lineRow = async (id: string) => (await db.select().from(s.targetLines).where(eq(s.targetLines.id, id)))[0]!;

describe("listAllLines", () => {
  it("lists the company's lines with order, state and whether each is in use, never another company's", async () => {
    await saveLine(admin(), input({ code: "fresh", sort: 9 }));
    const rows = await listAllLines(admin());
    expect(rows.map((r) => [r.code, r.sort, r.active, r.inUse])).toEqual([
      ["bev", 1, true, true],
      ["food", 2, true, true],
      ["coll", 3, true, true],
      ["fresh", 9, true, false],
    ]);
    expect(rows.some((r) => r.code === "other-line")).toBe(false);
  });

  it("refuses a rep and a supervisor", async () => {
    await expect(listAllLines(ahmed())).rejects.toBeInstanceOf(Forbidden);
    await expect(listAllLines(ctxOf("sami", "supervisor"))).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("saveLine: create", () => {
  it("creates a line with an id qualified by the company and returns it", async () => {
    const r = await saveLine(admin(), input({ code: "coverage", nameAr: "التغطية", unit: "outlets", kind: "coverage" }));
    expect(r).toEqual({ ok: true, id: "demo-co-coverage" });
    expect(await lineRow("demo-co-coverage")).toMatchObject({ companyId: "demo-co", code: "coverage", unit: "outlets", kind: "coverage" });
  });

  it("two companies can both have a line with the same code", async () => {
    const other = await otherAdmin();
    expect(await saveLine(admin(), input({ code: "shared" }))).toEqual({ ok: true, id: "demo-co-shared" });
    expect(await saveLine(other, input({ code: "shared" }))).toEqual({ ok: true, id: "other-co-shared" });
  });

  it("a collection line in cases is refused with collection_needs_value", async () => {
    const r = await saveLine(admin(), input({ code: "pay", kind: "collection", unit: "cases" }));
    expect(r).toEqual({ ok: false, errors: { unit: "collection_needs_value" } });
  });

  it("refuses a coverage line that is not in outlets and outlets on a sales line", async () => {
    expect(await saveLine(admin(), input({ code: "cov", kind: "coverage", unit: "value" }))).toEqual({
      ok: false,
      errors: { unit: "coverage_needs_outlets" },
    });
    expect(await saveLine(admin(), input({ code: "oth", kind: "sales", unit: "outlets" }))).toEqual({
      ok: false,
      errors: { unit: "outlets_only_for_coverage" },
    });
  });

  it("accepts a collection line in value and a coverage line in outlets", async () => {
    expect((await saveLine(admin(), input({ code: "pay", kind: "collection", unit: "value" }))).ok).toBe(true);
    expect((await saveLine(admin(), input({ code: "cov", kind: "coverage", unit: "outlets" }))).ok).toBe(true);
  });

  it("refuses a code that is already used in the company (taken) but not one used by another company", async () => {
    expect(await saveLine(admin(), input({ code: "bev" }))).toEqual({ ok: false, errors: { code: "taken" } });
    expect((await saveLine(admin(), input({ code: "other-line" }))).ok).toBe(true);
  });

  it("checks code, names, unit, kind, order and active flag", async () => {
    const r = await saveLine(admin(), {
      code: "Bad Code!",
      nameAr: "  ",
      nameEn: "x".repeat(81),
      nameUr: "",
      unit: "boxes" as never,
      kind: "other" as never,
      sort: 1.5,
      active: "yes" as never,
    });
    expect(r).toEqual({
      ok: false,
      errors: { code: "invalid", nameAr: "required", nameEn: "invalid", unit: "invalid", kind: "invalid", sort: "invalid", active: "invalid" },
    });
    expect(await listAllLines(admin())).toHaveLength(3);
  });

  it("trims names, lowercases the code, and an empty English or Urdu name is allowed", async () => {
    const r = await saveLine(admin(), input({ code: " Fresh ", nameAr: " طازج ", nameEn: "", nameUr: " " }));
    expect(r.ok && (await lineRow(r.id))).toMatchObject({ code: "fresh", nameAr: "طازج", nameEn: "", nameUr: "" });
  });

  it("a code freed by a rename can be used by a new line without an id clash", async () => {
    const first = await saveLine(admin(), input({ code: "alpha" }));
    if (!first.ok) throw new Error("setup");
    expect((await saveLine(admin(), { ...input({ code: "beta" }), id: first.id })).ok).toBe(true);
    const again = await saveLine(admin(), input({ code: "alpha" }));
    expect(again.ok && again.id).not.toBe(first.id);
    expect(again.ok).toBe(true);
  });

  it("refuses a rep", async () => {
    await expect(saveLine(ahmed(), input())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("saveLine: edit", () => {
  it("renames bev in all three languages", async () => {
    const r = await saveLine(admin(), {
      id: "bev",
      code: "bev",
      nameAr: "مشروبات باردة",
      nameEn: "Cold drinks",
      nameUr: "ٹھنڈے مشروبات",
      unit: "cases",
      kind: "sales",
      sort: 1,
      active: true,
    });
    expect(r).toEqual({ ok: true, id: "bev" });
    expect(await lineRow("bev")).toMatchObject({ nameAr: "مشروبات باردة", nameEn: "Cold drinks", nameUr: "ٹھنڈے مشروبات" });
  });

  it("a line with targets and closes cannot change its code, unit or kind (in_use)", async () => {
    const base = { id: "bev", nameAr: "مشروبات", nameEn: "Beverages", nameUr: "مشروبات", sort: 1, active: true };
    expect(await saveLine(admin(), { ...base, code: "bev", unit: "value", kind: "sales" })).toEqual({ ok: false, errors: { unit: "in_use" } });
    expect(await saveLine(admin(), { ...base, code: "drinks", unit: "cases", kind: "sales" })).toEqual({ ok: false, errors: { code: "in_use" } });
    expect(await saveLine(admin(), { ...base, code: "bev", unit: "value", kind: "collection" })).toEqual({
      ok: false,
      errors: { unit: "in_use", kind: "in_use" },
    });
    expect(await lineRow("bev")).toMatchObject({ code: "bev", unit: "cases", kind: "sales" });
  });

  it("a coverage line with a coverage update is in use: its unit and kind are fixed", async () => {
    const created = await saveLine(admin(), input({ code: "cov", kind: "coverage", unit: "outlets" }));
    if (!created.ok) throw new Error("setup");
    expect((await listAllLines(admin())).find((l) => l.lineId === created.id)!.inUse).toBe(false);
    await db.insert(s.coverageUpdates).values({
      id: "cu1", companyId: "demo-co", userId: "ahmed", lineId: created.id, covered: 5, total: 10, asOf: "2026-11-10", enteredBy: "ahmed", enteredRole: "rep",
    });
    expect((await listAllLines(admin())).find((l) => l.lineId === created.id)!.inUse).toBe(true);
    const r = await saveLine(admin(), { ...input({ code: "cov", kind: "sales", unit: "cases" }), id: created.id });
    expect(r.ok).toBe(false);
    expect(await lineRow(created.id)).toMatchObject({ unit: "outlets", kind: "coverage" });
  });

  it("a line in use can still change its order and be deactivated", async () => {
    const r = await saveLine(admin(), {
      id: "food", code: "food", nameAr: "أغذية", nameEn: "Food", nameUr: "غذا", unit: "value", kind: "sales", sort: 7, active: false,
    }, { today: AFTER_NOV });
    expect(r.ok).toBe(true);
    expect(await lineRow("food")).toMatchObject({ sort: 7, active: false });
  });

  it("a line nobody uses yet can change its shape", async () => {
    const created = await saveLine(admin(), input({ code: "fresh" }));
    if (!created.ok) throw new Error("setup");
    const r = await saveLine(admin(), { ...input({ code: "pay", unit: "value", kind: "collection" }), id: created.id });
    expect(r.ok).toBe(true);
    expect(await lineRow(created.id)).toMatchObject({ code: "pay", unit: "value", kind: "collection" });
  });

  it("the shape rule applies to an edit too", async () => {
    const created = await saveLine(admin(), input({ code: "fresh" }));
    if (!created.ok) throw new Error("setup");
    const r = await saveLine(admin(), { ...input({ code: "fresh", unit: "cases", kind: "collection" }), id: created.id });
    expect(r).toEqual({ ok: false, errors: { unit: "collection_needs_value" } });
  });

  it("another line's code is taken, its own is not", async () => {
    expect(await saveLine(admin(), { ...input({ code: "food", unit: "cases" }), id: "bev" })).toEqual({ ok: false, errors: { code: "taken" } });
  });

  it("a forged line id from another company is not_found and nothing changes in either company (Review Focus 1)", async () => {
    const other = await otherAdmin();
    const before = await snapshot();
    const payload = { code: "other-line", nameAr: "اختراق", nameEn: "Hacked", nameUr: "x", unit: "cases", kind: "sales", sort: 5, active: false } as const;
    expect(await saveLine(admin(), { ...payload, id: "other-line" })).toEqual({ ok: false, errors: { id: "not_found" } });
    expect(await saveLine(other, { ...payload, id: "bev", code: "bev" })).toEqual({ ok: false, errors: { id: "not_found" } });
    expect(await saveLine(admin(), { ...payload, id: "no-such-line" })).toEqual({ ok: false, errors: { id: "not_found" } });
    expect(await snapshot()).toEqual(before);
  });
});

describe("setLineActive and moveLine", () => {
  it("deactivates and reactivates a line", async () => {
    expect(await setLineActive(admin(), "coll", false, { today: AFTER_NOV })).toEqual({ ok: true });
    expect((await lineRow("coll")).active).toBe(false);
    expect(await setLineActive(admin(), "coll", true)).toEqual({ ok: true });
    expect((await lineRow("coll")).active).toBe(true);
  });

  it("moves a line up and down, renumbering, and stays put at the ends", async () => {
    const order = async () => (await listAllLines(admin())).map((r) => r.code);
    expect(await moveLine(admin(), "coll", "up")).toEqual({ ok: true });
    expect(await order()).toEqual(["bev", "coll", "food"]);
    expect(await moveLine(admin(), "bev", "down")).toEqual({ ok: true });
    expect(await order()).toEqual(["coll", "bev", "food"]);
    expect(await moveLine(admin(), "coll", "up")).toEqual({ ok: true });
    expect(await moveLine(admin(), "food", "down")).toEqual({ ok: true });
    expect(await order()).toEqual(["coll", "bev", "food"]);
  });

  it("renumbers equal and gappy sort values 1..n in the order the list displays (mixed-case, hyphenated ids)", async () => {
    for (const [i, id] of ["Zed-line", "a-line", "A_line", "b-Line"].entries()) {
      await db.insert(s.targetLines).values({ id, companyId: "demo-co", code: `code${i}`, nameAr: id, nameEn: "", nameUr: "", unit: "cases", kind: "sales", sort: 5 });
    }
    await db.update(s.targetLines).set({ sort: 5 }).where(eq(s.targetLines.companyId, "demo-co")); // all equal
    await db.update(s.targetLines).set({ sort: 40 }).where(eq(s.targetLines.id, "coll")); // and one gap
    const displayed = async () => (await listAllLines(admin())).map((r) => r.lineId);
    const before = await displayed();
    expect(before).toHaveLength(7);
    const mover = before[3]!;
    expect(await moveLine(admin(), mover, "up")).toEqual({ ok: true });
    const expected = [...before];
    [expected[2], expected[3]] = [expected[3]!, expected[2]!];
    expect(await displayed()).toEqual(expected);
    const rows = await db.select().from(s.targetLines).where(eq(s.targetLines.companyId, "demo-co"));
    expect(rows.map((r) => r.sort).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("forged ids of another company are not_found and nothing changes in either company (Review Focus 1)", async () => {
    const other = await otherAdmin();
    const before = await snapshot();
    expect(await setLineActive(admin(), "other-line", false)).toEqual({ ok: false, error: "not_found" });
    expect(await setLineActive(other, "bev", false)).toEqual({ ok: false, error: "not_found" });
    expect(await moveLine(admin(), "other-line", "up")).toEqual({ ok: false, error: "not_found" });
    expect(await moveLine(other, "bev", "down")).toEqual({ ok: false, error: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a rep", async () => {
    await expect(setLineActive(ahmed(), "bev", false)).rejects.toBeInstanceOf(Forbidden);
    await expect(moveLine(ahmed(), "bev", "up")).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("what a rep sees", () => {
  const NOV = { year: 2026, month: 11, today: "2026-11-14" } as const;

  it("a renamed line shows its new name in the rep's language", async () => {
    await saveLine(admin(), { id: "bev", code: "bev", nameAr: "مشروبات", nameEn: "Beverages", nameUr: "ٹھنڈے مشروبات", unit: "cases", kind: "sales", sort: 1, active: true });
    const view = await getMonthView(ahmed(), NOV);
    expect(view.lines.find((l) => l.lineId === "bev")?.nameUr).toBe("ٹھنڈے مشروبات");
  });

  it("deactivating coll removes it from Ahmed's month view, the home still renders, and the commission view still evaluates", async () => {
    await setLineActive(admin(), "coll", false, { today: AFTER_NOV });
    const view = await getMonthView(ahmed(), NOV);
    expect(view.lines.map((l) => l.lineId)).toEqual(["bev", "food"]);
    await expect(getCommissionView(ahmed(), NOV)).resolves.toBeDefined();
  });

  it("deactivating food removes it from Ahmed's month view", async () => {
    await setLineActive(admin(), "food", false, { today: AFTER_NOV });
    expect((await getMonthView(ahmed(), NOV)).lines.map((l) => l.lineId)).toEqual(["bev", "coll"]);
  });
});

describe("R23: turning a line off does not rewrite money", () => {
  const IN_NOV = "2026-11-14";
  const base = { id: "coll", code: "coll", nameAr: "وصولي", nameEn: "Collection", nameUr: "وصولی", unit: "value", kind: "collection", sort: 3 } as const;

  it("setLineActive(false) is refused with in_scheme while a published scheme of this or a later month names the line", async () => {
    expect(await setLineActive(admin(), "coll", false, { today: IN_NOV })).toEqual({ ok: false, error: "in_scheme" });
    expect((await lineRow("coll")).active).toBe(true);
    expect(await setLineActive(admin(), "bev", false, { today: "2026-10-30" })).toEqual({ ok: false, error: "in_scheme" });
  });

  it("saveLine with active=false is refused the same way and changes nothing", async () => {
    const r = await saveLine(admin(), { ...base, nameEn: "Renamed", active: false }, { today: IN_NOV });
    expect(r).toEqual({ ok: false, errors: { active: "in_scheme" } });
    expect(await lineRow("coll")).toMatchObject({ active: true, nameEn: "Collection" });
  });

  it("allowed once every scheme naming the line is in a past month, and reactivating is always allowed", async () => {
    expect(await setLineActive(admin(), "coll", false, { today: AFTER_NOV })).toEqual({ ok: true });
    expect(await setLineActive(admin(), "coll", true, { today: IN_NOV })).toEqual({ ok: true });
  });

  it("an unpublished draft naming the line does not block", async () => {
    await db.insert(s.schemes).values({
      id: "dec", companyId: "demo-co", name: "Dec", year: 2026, month: 12, components: [], published: false,
      draft: [{ id: "d", type: "tiered", label: "x", lineId: "food", tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 1 } }] }],
    });
    expect(await setLineActive(admin(), "food", false, { today: AFTER_NOV })).toEqual({ ok: true });
  });
});

describe("B2: editing a line does not touch its order or active flag", () => {
  const edit = { id: "food", code: "food", nameAr: "أغذية", nameEn: "Food 2", nameUr: "غذا", unit: "value", kind: "sales" } as const;

  it("a save without sort/active leaves a deactivation made since the form opened, and the order", async () => {
    await setLineActive(admin(), "food", false, { today: AFTER_NOV });
    await moveLine(admin(), "food", "up");
    const before = await lineRow("food");
    expect(await saveLine(admin(), { ...edit })).toEqual({ ok: true, id: "food" });
    expect(await lineRow("food")).toMatchObject({ active: false, sort: before.sort, nameEn: "Food 2" });
  });

  it("a new line without sort goes last and starts active", async () => {
    const r = await saveLine(admin(), { code: "last", nameAr: "آخر", nameEn: "", nameUr: "", unit: "cases", kind: "sales" });
    if (!r.ok) throw new Error("setup");
    const rows = await listAllLines(admin());
    expect(rows[rows.length - 1]).toMatchObject({ lineId: r.id, active: true });
  });
});
