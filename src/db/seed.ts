import { eq } from "drizzle-orm";
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

/** Reps added to the demo team: the same amount on each of the 11 selling days, so their totals are easy to check. */
const TEAM = [
  { id: "khaled", name: "خالد", bev: 120, foodSar: 8000, collSar: 20000, supervisor: true },
  { id: "omar", name: "عمر", bev: 70, foodSar: 5000, collSar: 10000, supervisor: false },
  { id: "yousef", name: "يوسف", bev: 0, foodSar: 0, collSar: 0, supervisor: false },
] as const;

/**
 * DEMO-ONLY credentials for local sample data, never for a real database (the seed guard refuses
 * a deployed database unless ALLOW_DEMO_SEED=1). Precomputed once so seeding runs no scrypt:
 * owner@platform.test / demo-owner-2026 and admin@demo.test / demo-admin-2026.
 */
const DEMO_OWNER_PASSWORD_HASH =
  "scrypt$16384$8$1$bfe6bc238e0b044f59845848a0b4617b$9956113c1bdb160f375b9e1fc258ca39f79b108eccd0b70b9f0d2946b3621e86";
const DEMO_ADMIN_PASSWORD_HASH =
  "scrypt$16384$8$1$f14288bdc455efbcccc5fed6912a1334$fdd92907e7b022bc7c26cefbd9126f61f74eed068687b9fc14288d80383967cf";

export type SeedResult = {
  companyId: string;
  repId: string;
  inviteToken: string;
  otherRepId: string;
  otherInviteToken: string;
  /** Supervisor `sami` of the demo company, supervising `ahmed` and `khaled`. */
  supervisorId: string;
  supervisorInviteToken: string;
  /** Platform owner `owner@platform.test` in company `platform`. */
  ownerId: string;
  /** Admin `admin@demo.test` of the demo company. */
  adminId: string;
  /** Deployed mode only: the owner has no password yet, this invite sets it. */
  ownerInviteToken?: string;
  /** Deployed mode only: the admin has no password yet, this invite sets it. */
  adminInviteToken?: string;
};

export type SeedOptions = {
  /**
   * True for a database reachable from the internet: the demo owner and admin are created without
   * a password and get invites instead, so no credential written in this repository opens them.
   */
  deployed: boolean;
};

/**
 * Inserts the shared sample data plus a second company for access tests.
 * Idempotent: seeded rows have fixed ids and are inserted with do-nothing upserts.
 * Invites: each call issues a fresh token for each seeded rep and replaces the stored
 * hash and expiry on the fixed invite row (clearing used_at), so row counts never change
 * and earlier invite links stop working.
 */
export async function seedDemo(db: Db, options: SeedOptions = { deployed: false }): Promise<SeedResult> {
  const { deployed } = options;
  const companyId = "demo-co";
  const repId = "ahmed";
  const otherCompanyId = "other-co";
  const otherRepId = "other-rep";
  const platformId = "platform";
  const ownerId = "owner";
  const adminId = "demo-admin";
  const supervisorId = "sami";

  await db.transaction(async (tx) => {
    const ins = <T extends PgTable>(table: T, rows: T["$inferInsert"][]) =>
      tx.insert(table).values(rows).onConflictDoNothing();

    await ins(s.companies, [
      { id: companyId, name: "Demo Distribution Co.", sellingWeekdays: [6, 0, 1, 2, 3, 4] },
      { id: otherCompanyId, name: "Other Trading Co.", sellingWeekdays: [6, 0, 1, 2, 3, 4] },
      { id: platformId, name: "Platform", sellingWeekdays: [6, 0, 1, 2, 3, 4], weekStartsOn: 6 },
    ]);
    await ins(s.users, [
      { id: supervisorId, companyId, role: "supervisor", name: "سامي", login: "sami" },
      { id: repId, companyId, role: "rep", name: "أحمد", login: "ahmed", supervisorId },
      ...TEAM.map((m) => ({
        id: m.id,
        companyId,
        role: "rep" as const,
        name: m.name,
        login: m.id,
        supervisorId: m.supervisor ? supervisorId : null,
      })),
      { id: otherRepId, companyId: otherCompanyId, role: "rep", name: "Other Rep", login: "other-rep" },
      {
        id: ownerId,
        companyId: platformId,
        role: "owner",
        name: "Platform Owner",
        login: "owner@platform.test",
        passwordHash: deployed ? null : DEMO_OWNER_PASSWORD_HASH,
      },
      {
        id: adminId,
        companyId,
        role: "admin",
        name: "مدير العرض",
        login: "admin@demo.test",
        passwordHash: deployed ? null : DEMO_ADMIN_PASSWORD_HASH,
      },
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
    const target = (userId: string, lineId: string, amount: number) => ({
      id: `target-${userId}-2026-11-${lineId}`,
      companyId,
      userId,
      year: 2026,
      month: 11,
      lineId,
      amount,
    });
    await ins(s.targets, [
      ...[repId, ...TEAM.map((m) => m.id)].flatMap((userId) => [
        target(userId, "bev", 3000),
        target(userId, "food", 18_000_000),
        target(userId, "coll", 45_000_000),
      ]),
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
      { id: "cola", companyId, name: "كولا 330 مل علب", nameEn: "Cola 330 ml cans", nameUr: "کولا 330 ملی لیٹر کین", unit: "cases", target: 400, startsOn: "2026-11-01", endsOn: "2026-11-30" },
      { id: "mango", companyId, name: "عصير مانجو 1 لتر", nameEn: "Mango juice 1 L", unit: "cases", target: 200, startsOn: "2026-11-01", endsOn: "2026-11-20" },
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
    for (const m of TEAM) {
      if (m.bev === 0) continue;
      for (const d of DAYS) {
        const closeId = `close-${m.id}-2026-11-${d}`;
        const food = m.foodSar * 100;
        const cash = Math.round(food * 0.6);
        closes.push({
          id: closeId,
          companyId,
          userId: m.id,
          date: `2026-11-${d}`,
          source: "manual",
          status: "confirmed",
          cashSales: cash,
          creditSales: food - cash,
          collections: m.collSar * 100,
          expenses: 0,
          loaded: m.bev,
          sold: m.bev,
          returned: 0,
        });
        lines.push(
          { id: `${closeId}-bev`, companyId, closeId, lineId: "bev", amount: m.bev },
          { id: `${closeId}-food`, companyId, closeId, lineId: "food", amount: food },
          { id: `${closeId}-coll`, companyId, closeId, lineId: "coll", amount: m.collSar * 100 },
        );
      }
    }
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
        version: 1,
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      })
      .onConflictDoNothing();
    // The same shape migration 0005 gives a scheme published before versions were logged.
    await ins(s.schemeVersions, [
      {
        id: "scheme-2026-11-v1",
        companyId,
        schemeId: "scheme-2026-11",
        version: 1,
        components: sampleScheme.components,
        publishedBy: null,
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
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
  const supervisorInviteToken = await issue("invite-sami", companyId, supervisorId);

  const result: SeedResult = {
    companyId,
    repId,
    inviteToken,
    otherRepId,
    otherInviteToken,
    supervisorId,
    supervisorInviteToken,
    ownerId,
    adminId,
  };
  if (deployed) {
    // Only while the account still has no password: a re-seed must not reopen an account that is set up.
    const needsInvite = async (userId: string) =>
      (await db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, userId)))[0]?.hash == null;
    if (await needsInvite(ownerId)) result.ownerInviteToken = await issue("invite-owner", platformId, ownerId);
    if (await needsInvite(adminId)) result.adminInviteToken = await issue("invite-demo-admin", companyId, adminId);
  }
  return result;
}
