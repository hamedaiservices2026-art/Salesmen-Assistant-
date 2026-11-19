import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { publishScheme, saveDraft } from "./schemes";
import { listFocusItems, saveFocusItem, type FocusInput } from "./focus";
import { listFocusInfo } from "./focus-lookup";

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
const rep = (id: string) => ctxOf(id, "rep");
const NOV = { year: 2026, month: 11 };
const TODAY = { ...NOV, today: "2026-11-14" as const };

async function otherAdmin(): Promise<Ctx> {
  await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "O", login: "admin@other.test" });
  return ctxOf("other-admin", "admin", "other-co");
}

const input = (over: Partial<FocusInput> = {}): FocusInput => ({
  name: "كوكتيل",
  unit: "cases",
  target: 300,
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
  repIds: ["ahmed", "khaled"],
  ...over,
});

async function snapshot() {
  const items = (await db.select().from(s.focusItems)).map((i) => ({ ...i, updatedAt: null, createdAt: null }));
  const assigns = (await db.select().from(s.focusAssignments)).map((a) => ({ c: a.companyId, i: a.focusItemId, u: a.userId }));
  return { items: items.sort((a, b) => a.id.localeCompare(b.id)), assigns: assigns.sort((a, b) => (a.i + a.u).localeCompare(b.i + b.u)) };
}

describe("saveFocusItem", () => {
  it("creates an item assigned to chosen reps only", async () => {
    const r = await saveFocusItem(admin(), input());
    expect(r.ok).toBe(true);
    const ahmed = await getMonthView(rep("ahmed"), TODAY);
    expect(ahmed.focus.map((f) => f.name)).toContain("كوكتيل");
    const omar = await getMonthView(rep("omar"), TODAY);
    expect(omar.focus.map((f) => f.name)).not.toContain("كوكتيل");
  });

  it("stores names, sku and nulls blank optionals", async () => {
    const r = await saveFocusItem(admin(), input({ nameEn: " Cocktail ", nameUr: "  ", sku: " SKU-1 " }));
    if (!r.ok) throw new Error("expected ok");
    const [row] = await db.select().from(s.focusItems).where(eq(s.focusItems.id, r.id));
    expect(row).toMatchObject({ nameEn: "Cocktail", nameUr: null, sku: "SKU-1", companyId: "demo-co", target: 300 });
  });

  it("refuses a window that ends before it starts", async () => {
    const before = await snapshot();
    const r = await saveFocusItem(admin(), input({ startsOn: "2026-11-30", endsOn: "2026-11-01" }));
    expect(r).toEqual({ ok: false, errors: { endsOn: "window_order" } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses bad dates, empty name, targets of zero, negative, fractional or over the cap", async () => {
    for (const over of [{ startsOn: "2026-02-30" }, { name: "  " }, { target: 0 }, { target: -5 }, { target: 1.5 }, { target: 1e11 + 1 }, { unit: "outlets" }] as Partial<FocusInput>[]) {
      const r = await saveFocusItem(admin(), input(over));
      expect(r.ok).toBe(false);
    }
    expect((await saveFocusItem(admin(), input({ target: 1e11 }))).ok).toBe(true);
    expect(await saveFocusItem(admin(), input({ target: 0 }))).toEqual({ ok: false, errors: { target: "invalid" } });
  });

  it("a rep of another company is not_found and nothing is written", async () => {
    const before = await snapshot();
    expect(await saveFocusItem(admin(), input({ repIds: ["other-rep"] }))).toEqual({ ok: false, errors: { repIds: "not_found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("an unknown rep id gives the same result as another company's (no oracle)", async () => {
    const a = await saveFocusItem(admin(), input({ repIds: ["other-rep"] }));
    const b = await saveFocusItem(admin(), input({ repIds: ["nobody"] }));
    expect(a).toEqual(b);
  });

  it("refuses a supervisor, an admin and an inactive rep as assignees", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "omar"));
    for (const id of ["sami", seed.adminId, "omar"]) {
      expect(await saveFocusItem(admin(), input({ repIds: [id] }))).toEqual({ ok: false, errors: { repIds: "not_found" } });
    }
  });

  it("an item id of another company is not_found", async () => {
    const mine = await saveFocusItem(admin(), input());
    if (!mine.ok) throw new Error("x");
    const other = await otherAdmin();
    const before = await snapshot();
    expect(await saveFocusItem(other, input({ id: mine.id, repIds: [] }))).toEqual({ ok: false, errors: { id: "not_found" } });
    expect(await saveFocusItem(admin(), input({ id: "nope" }))).toEqual({ ok: false, errors: { id: "not_found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("replaces the assignments to match repIds, duplicates ignored", async () => {
    const r = await saveFocusItem(admin(), input({ repIds: ["ahmed", "ahmed", "khaled"] }));
    if (!r.ok) throw new Error("x");
    expect((await saveFocusItem(admin(), input({ id: r.id, repIds: ["omar", "khaled"] }))).ok).toBe(true);
    const rows = await db.select().from(s.focusAssignments).where(eq(s.focusAssignments.focusItemId, r.id));
    expect(rows.map((x) => x.userId).sort()).toEqual(["khaled", "omar"]);
    expect((await saveFocusItem(admin(), input({ id: r.id, repIds: [] }))).ok).toBe(true);
    expect(await db.select().from(s.focusAssignments).where(eq(s.focusAssignments.focusItemId, r.id))).toEqual([]);
  });

  it("two saves at once leave exactly one consistent assignment set", async () => {
    const r = await saveFocusItem(admin(), input());
    if (!r.ok) throw new Error("x");
    await Promise.all([
      saveFocusItem(admin(), input({ id: r.id, repIds: ["ahmed"] })),
      saveFocusItem(admin(), input({ id: r.id, repIds: ["khaled", "omar"] })),
    ]);
    const rows = (await db.select().from(s.focusAssignments).where(eq(s.focusAssignments.focusItemId, r.id))).map((x) => x.userId).sort();
    expect([["ahmed"], ["khaled", "omar"]]).toContainEqual(rows);
  });

  it("refuses moving the window of an item a published bonus names (in_scheme), and changes nothing", async () => {
    const before = await snapshot();
    const mango = (await listFocusItems(admin(), NOV)).find((f) => f.id === "mango")!;
    expect(mango.inScheme).toBe(true);
    const r = await saveFocusItem(admin(), input({ id: "mango", name: mango.name, target: 200, startsOn: "2026-11-01", endsOn: "2026-11-25", repIds: ["ahmed"] }));
    expect(r).toEqual({ ok: false, errors: { endsOn: "in_scheme" } });
    expect(await snapshot()).toEqual(before);
  });

  it("allows renaming, retargeting and reassigning an item that is in a scheme, and moving one that is not", async () => {
    const r = await saveFocusItem(admin(), input({ id: "mango", name: "مانجو", nameEn: "Mango", target: 250, startsOn: "2026-11-01", endsOn: "2026-11-20", repIds: ["ahmed", "omar"] }));
    expect(r).toEqual({ ok: true, id: "mango" });
    const cola = await saveFocusItem(admin(), input({ id: "cola", name: "كولا", target: 400, startsOn: "2026-11-02", endsOn: "2026-11-29", repIds: ["ahmed"] }));
    expect(cola).toEqual({ ok: true, id: "cola" });
  });

  it("refuses changing the unit of an item in a scheme", async () => {
    const r = await saveFocusItem(admin(), input({ id: "mango", name: "x", unit: "value", target: 200, startsOn: "2026-11-01", endsOn: "2026-11-20" }));
    expect(r).toEqual({ ok: false, errors: { unit: "in_scheme" } });
  });

  it("a scheme published after the item exists locks it from then on", async () => {
    const made = await saveFocusItem(admin(), input({ name: "جديد", startsOn: "2026-12-01", endsOn: "2026-12-31" }));
    if (!made.ok) throw new Error("x");
    const components = [
      { id: "b1", type: "bonus", label: "x", condition: { kind: "focus_at_least", focusItemId: made.id, min: 10 }, amount: 1000, startsOn: "2026-12-01", endsOn: "2026-12-31" },
    ];
    const DEC = { year: 2026, month: 12 };
    expect((await saveDraft(admin(), { ...DEC, components, expectedVersion: 0, expectedDraftRev: 0 })).ok).toBe(true);
    expect((await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 1 })).ok).toBe(true);
    const r = await saveFocusItem(admin(), input({ id: made.id, name: "جديد", startsOn: "2026-12-02", endsOn: "2026-12-31" }));
    expect(r).toEqual({ ok: false, errors: { startsOn: "in_scheme" } });
  });

  it("refuses non-admin callers", async () => {
    await expect(saveFocusItem(rep("ahmed"), input())).rejects.toBeInstanceOf(Forbidden);
    await expect(listFocusItems(rep("ahmed"), NOV)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("listFocusItems", () => {
  it("lists the month's items of the company with names, reps and the scheme flag", async () => {
    const made = await saveFocusItem(admin(), input({ nameEn: "Cocktail", sku: "K1" }));
    if (!made.ok) throw new Error("x");
    await saveFocusItem(admin(), input({ name: "ديسمبر", startsOn: "2026-12-01", endsOn: "2026-12-31", repIds: [] }));
    const list = await listFocusItems(admin(), NOV);
    expect(list.map((f) => f.id).sort()).toEqual(["cola", "mango", made.id].sort());
    expect(list.find((f) => f.id === made.id)).toMatchObject({ name: "كوكتيل", nameEn: "Cocktail", nameUr: null, sku: "K1", unit: "cases", target: 300, repIds: ["ahmed", "khaled"], inScheme: false });
    expect(list.find((f) => f.id === "cola")).toMatchObject({ inScheme: false, repIds: ["ahmed"] });
  });

  it("does not show another company's items", async () => {
    const other = await otherAdmin();
    await db.insert(s.focusItems).values({ id: "o-focus", companyId: "other-co", name: "x", unit: "cases", target: 5, startsOn: "2026-11-01", endsOn: "2026-11-30" });
    expect((await listFocusItems(admin(), NOV)).map((f) => f.id)).not.toContain("o-focus");
    expect((await listFocusItems(other, NOV)).map((f) => f.id)).toEqual(["o-focus"]);
  });
});

describe("listFocusInfo", () => {
  it("carries the three names", async () => {
    await db.update(s.focusItems).set({ nameEn: "Mango juice" }).where(eq(s.focusItems.id, "mango"));
    const [m] = await listFocusInfo(admin(), ["mango"]);
    expect(m).toMatchObject({ id: "mango", name: "عصير مانجو 1 لتر", nameEn: "Mango juice", nameUr: null, unit: "cases" });
  });
});

describe("rep views", () => {
  it("FocusView carries nameEn and nameUr", async () => {
    await db.update(s.focusItems).set({ nameEn: "Mango juice" }).where(eq(s.focusItems.id, "mango"));
    const view = await getMonthView(rep("ahmed"), TODAY);
    expect(view.focus.find((f) => f.id === "mango")).toMatchObject({ nameEn: "Mango juice", nameUr: null });
  });
});
