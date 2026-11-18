import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./testing";
import { seedDemo } from "./seed";
import { findCompany, seedPilotStructure } from "./pilot";
import * as s from "./schema";
import { createCompany } from "@/server/admin/companies";
import { validateComponents } from "@/domain/commission";
import type { Ctx } from "@/server/ctx";

async function newCompany() {
  const db = await createTestDb();
  const seeded = await seedDemo(db);
  const owner: Ctx = { db, companyId: "platform", userId: seeded.ownerId, role: "owner", locale: "ar", timeZone: "Asia/Riyadh" };
  const made = await createCompany(owner, {
    name: "Pilot Test Co.",
    currency: "SAR",
    timeZone: "Asia/Riyadh",
    defaultLocale: "ar",
    adminName: "Pilot Admin",
    adminEmail: "pilot-admin@example.test",
  });
  if (!made.ok) throw new Error("company not created");
  return { db, companyId: made.companyId };
}

describe("seedPilotStructure", () => {
  it("creates the six lines and one draft November scheme, and is idempotent", async () => {
    const { db, companyId } = await newCompany();
    await seedPilotStructure(db, companyId);
    await seedPilotStructure(db, companyId);

    const lines = await db.select().from(s.targetLines).where(eq(s.targetLines.companyId, companyId));
    expect(lines.map((l) => l.code).sort()).toEqual(["can185", "can250", "can320", "coverage", "food", "kinza"]);
    expect(lines.every((l) => l.id === `${companyId}-${l.code}` && l.active)).toBe(true);
    const by = Object.fromEntries(lines.map((l) => [l.code, l]));
    expect(by.coverage).toMatchObject({ unit: "outlets", kind: "coverage", nameAr: "التغطية" });
    expect(by.food).toMatchObject({ unit: "value", kind: "sales", nameAr: "أغذية" });
    for (const c of ["can185", "can250", "can320", "kinza"]) expect(by[c]).toMatchObject({ unit: "cases", kind: "sales" });
    expect(by.can185!.nameAr).toBe("علب 185 مل");
    expect(by.kinza!.nameEn).not.toBe("");
    expect(by.kinza!.nameUr).not.toBe("");

    const schemes = await db.select().from(s.schemes).where(eq(s.schemes.companyId, companyId));
    expect(schemes).toHaveLength(1);
    const scheme = schemes[0]!;
    expect(scheme).toMatchObject({ year: 2026, month: 11, published: false, version: 0, components: [] });
    expect(scheme.id).toBe(`${companyId}-2026-11`);
    const draft = scheme.draft!;
    expect(draft.map((c) => c.id)).toEqual(["c_185", "c_250", "c_320", "b_kinza_food"]);
    const amounts = draft.map((c) =>
      c.type === "tiered" && c.tiers[0]!.pay.kind === "fixed" ? c.tiers[0]!.pay.amount : c.type === "bonus" ? c.amount : -1,
    );
    expect(amounts).toEqual([30_000, 60_000, 60_000, 100_000]);
    expect(draft[0]).toMatchObject({ lineId: `${companyId}-can185`, tiers: [{ minPct: 100 }] });
    expect(draft[3]).toMatchObject({
      label: "حافز كينزا والأغذية",
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      condition: {
        kind: "all",
        conditions: [
          { kind: "line_pct_at_least", lineId: `${companyId}-kinza`, minPct: 90 },
          { kind: "line_pct_at_least", lineId: `${companyId}-food`, minPct: 70 },
        ],
      },
    });
    const refs = {
      lines: lines.map((l) => ({ id: l.id, unit: l.unit, kind: l.kind })),
      focus: [],
      period: { start: "2026-11-01", end: "2026-11-30" },
    };
    expect(validateComponents(draft, refs).ok).toBe(true);
  });

  it("does not touch a scheme the admin already has, and does not collide with the demo's food line", async () => {
    const { db, companyId } = await newCompany();
    await seedPilotStructure(db, companyId);
    await db.update(s.schemes).set({ draft: [], draftRev: 3 }).where(eq(s.schemes.companyId, companyId));
    await seedPilotStructure(db, companyId);
    const [row] = await db.select().from(s.schemes).where(and(eq(s.schemes.companyId, companyId)));
    expect(row).toMatchObject({ draft: [], draftRev: 3 });
    const demoFood = await db.select().from(s.targetLines).where(eq(s.targetLines.id, "food"));
    expect(demoFood[0]!.companyId).toBe("demo-co");
  });

  it("refuses an unknown company", async () => {
    const db = await createTestDb();
    await expect(seedPilotStructure(db, "nope")).rejects.toThrow(/unknown company/i);
  });

  it("leaves a published scheme alone, even when a line was deactivated since", async () => {
    const { db, companyId } = await newCompany();
    await seedPilotStructure(db, companyId);
    const [row] = await db.select().from(s.schemes).where(eq(s.schemes.companyId, companyId));
    await db
      .update(s.schemes)
      .set({ published: true, version: 2, components: row!.draft!, draft: null, draftRev: 5 })
      .where(eq(s.schemes.id, row!.id));
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, `${companyId}-kinza`));
    await seedPilotStructure(db, companyId);
    const [after] = await db.select().from(s.schemes).where(eq(s.schemes.companyId, companyId));
    expect(after).toMatchObject({ published: true, version: 2, draft: null, draftRev: 5 });
    expect(after!.components).toEqual(row!.draft);
  });
});

describe("findCompany", () => {
  it("finds by id or by exact name, and never the platform company", async () => {
    const { db, companyId } = await newCompany();
    expect(await findCompany(db, companyId)).toMatchObject({ ok: true, id: companyId, name: "Pilot Test Co." });
    expect(await findCompany(db, "Pilot Test Co.")).toMatchObject({ ok: true, id: companyId });
    expect(await findCompany(db, "platform")).toMatchObject({ ok: false, reason: "none" });
    expect(await findCompany(db, "Platform")).toMatchObject({ ok: false, reason: "none" });
  });

  it("refuses a name two companies share, and lists the customers", async () => {
    const { db, companyId } = await newCompany();
    await db.update(s.companies).set({ name: "Same Name" }).where(eq(s.companies.id, "other-co"));
    await db.update(s.companies).set({ name: "Same Name" }).where(eq(s.companies.id, companyId));
    const r = await findCompany(db, "Same Name");
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!r.ok) expect(r.known.map((c) => c.id)).not.toContain("platform");
  });
});
