import { eq } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import { validateComponents, type Component } from "@/domain/commission";
import type { LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import { loadSchemeRefs } from "@/server/admin/schemes";
import type { Ctx } from "@/server/ctx";

type PilotLine = { code: string; nameAr: string; nameEn: string; nameUr: string; unit: Unit; kind: LineKind };

/** The pilot company's six target lines, in display order (PRODUCT.md, "Pilot commission rules"). */
const PILOT_LINES: PilotLine[] = [
  { code: "can185", nameAr: "علب 185 مل", nameEn: "185 ml cans", nameUr: "185 ملی لیٹر کین", unit: "cases", kind: "sales" },
  { code: "can250", nameAr: "علب 250 مل", nameEn: "250 ml cans", nameUr: "250 ملی لیٹر کین", unit: "cases", kind: "sales" },
  { code: "can320", nameAr: "علب 320 مل", nameEn: "320 ml cans", nameUr: "320 ملی لیٹر کین", unit: "cases", kind: "sales" },
  { code: "kinza", nameAr: "كينزا", nameEn: "Kinza", nameUr: "کنزا", unit: "cases", kind: "sales" },
  { code: "food", nameAr: "أغذية", nameEn: "Food", nameUr: "اشیائے خوردونوش", unit: "value", kind: "sales" },
  { code: "coverage", nameAr: "التغطية", nameEn: "Coverage", nameUr: "کوریج", unit: "outlets", kind: "coverage" },
];

const PERIOD = { year: 2026, month: 11 };
const SCHEME_NAME = "نوفمبر 2026";

/**
 * Only what PRODUCT.md fixes, in halalas: 300, 600 and 600 SAR at 100% on the three can sizes and
 * the 1,000 SAR Kinza-and-Food bonus. The 90% to 99% tiers, the 110% tier, any extra incentive at
 * 100% and the month's variable component are the admin's to add in the editor.
 */
function pilotComponents(id: (code: string) => string): Component[] {
  const can = (n: "185" | "250" | "320", amount: number): Component => ({
    id: `c_${n}`,
    type: "tiered",
    label: `شرائح علب ${n} مل`,
    lineId: id(`can${n}`),
    tiers: [{ minPct: 100, pay: { kind: "fixed", amount } }],
  });
  return [
    can("185", 30_000),
    can("250", 60_000),
    can("320", 60_000),
    {
      id: "b_kinza_food",
      type: "bonus",
      label: "حافز كينزا والأغذية",
      condition: {
        kind: "all",
        conditions: [
          { kind: "line_pct_at_least", lineId: id("kinza"), minPct: 90 },
          { kind: "line_pct_at_least", lineId: id("food"), minPct: 70 },
        ],
      },
      amount: 100_000,
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
    },
  ];
}

/**
 * Gives a company the pilot's six lines and a draft (unpublished) November 2026 scheme. Safe to run
 * again: lines and the scheme row that already exist (by code, and by company and month) are left as
 * they are, so an admin's later edits survive. Line ids and the scheme id are qualified by the
 * company (`target_lines.id` is one global key). The draft is checked with the same validation and
 * the same references the scheme editor uses before it is stored.
 */
export async function seedPilotStructure(db: Db, companyId: string): Promise<void> {
  const [company] = await db.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.id, companyId));
  if (!company) throw new Error(`Unknown company: ${companyId}`);

  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx
      .insert(s.targetLines)
      .values(PILOT_LINES.map((l, i) => ({ ...l, id: `${companyId}-${l.code}`, companyId, sort: i + 1, active: true })))
      .onConflictDoNothing();

    const lines = await tx.select({ id: s.targetLines.id, code: s.targetLines.code }).from(s.targetLines).where(eq(s.targetLines.companyId, companyId));
    const idOf = (code: string) => lines.find((l) => l.code === code)?.id ?? `${companyId}-${code}`;

    const ctx = { db: tx, companyId } as unknown as Ctx; // `loadSchemeRefs` reads only the company
    const checked = validateComponents(pilotComponents(idOf), await loadSchemeRefs(tx, ctx, PERIOD));
    if (!checked.ok) throw new Error(`Pilot draft is invalid: ${JSON.stringify(checked.issues)}`);

    await tx
      .insert(s.schemes)
      .values({
        id: `${companyId}-${PERIOD.year}-${PERIOD.month}`,
        companyId,
        name: SCHEME_NAME,
        ...PERIOD,
        components: [],
        published: false,
        draft: checked.components,
        draftRev: 1,
        version: 0,
      })
      .onConflictDoNothing();
  });
}
