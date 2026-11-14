import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb } from "./testing";
import { seedDemo } from "./seed";
import * as s from "./schema";

async function counts(db: Awaited<ReturnType<typeof createTestDb>>) {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(s)) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = row!.n;
  }
  return out;
}

describe("seedDemo", () => {
  it("inserts the shared sample data", async () => {
    const db = await createTestDb();
    const r = await seedDemo(db);

    expect((await db.select().from(s.companies)).length).toBe(2);
    const lines = await db.select().from(s.targetLines).where(eq(s.targetLines.companyId, r.companyId));
    expect(lines.map((l) => l.id).sort()).toEqual(["bev", "coll", "food"]);

    const targets = await db.select().from(s.targets).where(eq(s.targets.userId, r.repId));
    const byLine = Object.fromEntries(targets.map((t) => [t.lineId, t.amount]));
    expect(byLine).toEqual({ bev: 3000, food: 18_000_000, coll: 45_000_000 });

    const closes = await db.select().from(s.dailyCloses).where(eq(s.dailyCloses.userId, r.repId));
    expect(closes).toHaveLength(11);
    const sumFor = async (lineId: string) => {
      const [row] = await db
        .select({ n: sql<number>`sum(${s.closeLines.amount})::bigint` })
        .from(s.closeLines)
        .innerJoin(s.dailyCloses, eq(s.closeLines.closeId, s.dailyCloses.id))
        .where(and(eq(s.dailyCloses.userId, r.repId), eq(s.closeLines.lineId, lineId)));
      return Number(row!.n);
    };
    expect(await sumFor("bev")).toBe(1140);
    expect(await sumFor("food")).toBe(8_280_000);
    expect(await sumFor("coll")).toBe(18_900_000);
    expect(closes[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const item of ["cola", "mango"]) {
      const [row] = await db
        .select({ n: sql<number>`sum(${s.closeFocus.amount})::bigint` })
        .from(s.closeFocus)
        .where(eq(s.closeFocus.focusItemId, item));
      expect(Number(row!.n)).toBe(120);
    }

    const schemes = await db.select().from(s.schemes).where(eq(s.schemes.companyId, r.companyId));
    expect(schemes).toHaveLength(1);
    expect(schemes[0]!.published).toBe(true);
    expect(schemes[0]!.components).toHaveLength(5);

    const other = await db.select().from(s.users).where(eq(s.users.id, r.otherRepId));
    expect(other[0]!.id).toBe("other-rep");
    expect(r.inviteToken).not.toBe(r.otherInviteToken);
  });

  it("is idempotent: a second run changes no row counts", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const before = await counts(db);
    expect(before.invites).toBe(2);
    await seedDemo(db);
    expect(await counts(db)).toEqual(before);
  });
});
