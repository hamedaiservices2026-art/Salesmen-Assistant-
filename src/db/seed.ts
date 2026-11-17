import { sampleScheme } from "@/domain/commission/sample-fixture";
import { hashToken, newToken } from "@/server/auth/token";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import * as s from "./schema";

const DAYS = ["01", "02", "03", "04", "05", "07", "08", "09", "10", "11", "12"];
const BEV = [96, 118, 104, 122, 88, 110, 121, 92, 99, 84, 106];
const FOOD_SAR = [7200, 8100, 7400, 7900, 6800, 7600, 8300, 7100, 7500, 7000, 7900];
const COLL_SAR = [17000, 17000, 17000, 17000, 17000, 17000, 17000, 17000, 17000, 17000, 19000];
const FOCUS_PER_DAY = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20]; // sums to 120
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SeedResult = {
  companyId: string;
  repId: string;
  inviteToken: string;
  otherRepId: string;
  otherInviteToken: string;
};

/**
 * Inserts the shared sample data plus a second company for access tests.
 * Idempotent: seeded rows have fixed ids and are inserted with do-nothing upserts.
 * Invites: each call issues a fresh token for each seeded rep and replaces the stored
 * hash and expiry on the fixed invite row (clearing used_at), so row counts never change
 * and earlier invite links stop working.
 */
export async function seedDemo(db: Db): Promise<SeedResult> {
  const companyId = "demo-co";
  const repId = "ahmed";
  const otherCompanyId = "other-co";
  const otherRepId = "other-rep";

  await db.transaction(async (tx) => {
    const ins = <T extends PgTable>(table: T, rows: T["$inferInsert"][]) =>
      tx.insert(table).values(rows).onConflictDoNothing();

    await ins(s.companies, [
      { id: companyId, name: "Demo Distribution Co.", sellingWeekdays: [6, 0, 1, 2, 3, 4] },
      { id: otherCompanyId, name: "Other Trading Co.", sellingWeekdays: [6, 0, 1, 2, 3, 4] },
    ]);
    await ins(s.users, [
      { id: repId, companyId, role: "rep", name: "أحمد", login: "ahmed" },
      { id: otherRepId, companyId: otherCompanyId, role: "rep", name: "Other Rep", login: "other-rep" },
    ]);
    await ins(s.targetLines, [
      { id: "bev", companyId, code: "bev", nameAr: "مشروبات", nameEn: "Beverages", nameUr: "مشروبات", unit: "cases", kind: "sales", sort: 1 },
      { id: "food", companyId, code: "food", nameAr: "أغذية", nameEn: "Food", nameUr: "اشیائے خوردونوش", unit: "value", kind: "sales", sort: 2 },
      { id: "coll", companyId, code: "coll", nameAr: "تحصيل", nameEn: "Collection", nameUr: "وصولی", unit: "value", kind: "collection", sort: 3 },
      {
        id: "other-line",
        companyId: otherCompanyId,
        code: "other-line",
        nameAr: "مبيعات",
        nameEn: "Sales",
        nameUr: "فروخت",
        unit: "cases",
        kind: "sales",
        sort: 1,
      },
    ]);
    const target = (lineId: string, amount: number) => ({
      id: `target-${repId}-2026-11-${lineId}`,
      companyId,
      userId: repId,
      year: 2026,
      month: 11,
      lineId,
      amount,
    });
    await ins(s.targets, [
      target("bev", 3000),
      target("food", 18_000_000),
      target("coll", 45_000_000),
      {
        id: "target-other-rep-2026-11-other-line",
        companyId: otherCompanyId,
        userId: otherRepId,
        year: 2026,
        month: 11,
        lineId: "other-line",
        amount: 500,
      },
    ]);

    await ins(s.focusItems, [
      { id: "cola", companyId, name: "كولا 330 مل علب", unit: "cases", target: 400, startsOn: "2026-11-01", endsOn: "2026-11-30" },
      { id: "mango", companyId, name: "عصير مانجو 1 لتر", unit: "cases", target: 200, startsOn: "2026-11-01", endsOn: "2026-11-20" },
    ]);
    await ins(s.focusAssignments, [
      { id: "assign-cola-ahmed", companyId, focusItemId: "cola", userId: repId },
      { id: "assign-mango-ahmed", companyId, focusItemId: "mango", userId: repId },
    ]);

    const closes: (typeof s.dailyCloses.$inferInsert)[] = [];
    const lines: (typeof s.closeLines.$inferInsert)[] = [];
    const focus: (typeof s.closeFocus.$inferInsert)[] = [];
    DAYS.forEach((d, i) => {
      const closeId = `close-ahmed-2026-11-${d}`;
      const food = FOOD_SAR[i]! * 100;
      const cash = Math.round(food * 0.6);
      closes.push({
        id: closeId,
        companyId,
        userId: repId,
        date: `2026-11-${d}`,
        source: "manual",
        status: "confirmed",
        cashSales: cash,
        creditSales: food - cash,
        collections: COLL_SAR[i]! * 100,
        expenses: 0,
        loaded: BEV[i]!,
        sold: BEV[i]!,
        returned: 0,
      });
      lines.push(
        { id: `${closeId}-bev`, companyId, closeId, lineId: "bev", amount: BEV[i]! },
        { id: `${closeId}-food`, companyId, closeId, lineId: "food", amount: food },
        { id: `${closeId}-coll`, companyId, closeId, lineId: "coll", amount: COLL_SAR[i]! * 100 },
      );
      for (const item of ["cola", "mango"]) {
        focus.push({ id: `${closeId}-${item}`, companyId, closeId, focusItemId: item, amount: FOCUS_PER_DAY[i]! });
      }
    });
    await ins(s.dailyCloses, [
      ...closes,
      {
        id: "close-other-rep-2026-11-01",
        companyId: otherCompanyId,
        userId: otherRepId,
        date: "2026-11-01",
        source: "manual",
        status: "confirmed",
        cashSales: 100_000,
      },
    ]);
    await ins(s.closeLines, [
      ...lines,
      {
        id: "close-other-rep-2026-11-01-other-line",
        companyId: otherCompanyId,
        closeId: "close-other-rep-2026-11-01",
        lineId: "other-line",
        amount: 20,
      },
    ]);
    await ins(s.closeFocus, focus);

    await tx
      .insert(s.schemes)
      .values({
        id: "scheme-2026-11",
        companyId,
        name: sampleScheme.name,
        year: 2026,
        month: 11,
        components: sampleScheme.components,
        published: true,
      })
      .onConflictDoNothing();
  });

  const issue = async (id: string, cid: string, userId: string) => {
    const token = newToken();
    const values = {
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      usedAt: null,
      updatedAt: new Date(),
    };
    await db
      .insert(s.invites)
      .values({ id, companyId: cid, userId, ...values })
      .onConflictDoUpdate({ target: s.invites.id, set: values });
    return token;
  };
  const inviteToken = await issue("invite-ahmed", companyId, repId);
  const otherInviteToken = await issue("invite-other-rep", otherCompanyId, otherRepId);

  return { companyId, repId, inviteToken, otherRepId, otherInviteToken };
}
