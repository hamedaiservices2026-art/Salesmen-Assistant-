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

    expect((await db.select().from(s.companies)).map((c) => c.id).sort()).toEqual(["demo-co", "other-co", "platform"]);
    const staff = await db.select().from(s.users).where(eq(s.users.login, "owner@platform.test"));
    expect(staff[0]).toMatchObject({ id: r.ownerId, companyId: "platform", role: "owner" });
    const admin = await db.select().from(s.users).where(eq(s.users.login, "admin@demo.test"));
    expect(admin[0]).toMatchObject({ id: r.adminId, companyId: r.companyId, role: "admin" });
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
    expect(schemes[0]!).toMatchObject({ version: 1, draft: null, draftRev: 0, publishedBy: null });
    const versions = await db.select().from(s.schemeVersions).where(eq(s.schemeVersions.companyId, r.companyId));
    expect(versions).toEqual([expect.objectContaining({ schemeId: schemes[0]!.id, version: 1, publishedBy: null })]);
    expect(versions[0]!.components).toEqual(schemes[0]!.components);

    const other = await db.select().from(s.users).where(eq(s.users.id, r.otherRepId));
    expect(other[0]!.id).toBe("other-rep");
    expect(r.inviteToken).not.toBe(r.otherInviteToken);
  });

  it("seeds the team: four reps and one supervisor in demo-co, with the shared totals (R5)", async () => {
    const db = await createTestDb();
    const r = await seedDemo(db);
    const users = await db.select().from(s.users).where(eq(s.users.companyId, r.companyId));
    expect(users.filter((u) => u.role === "rep").map((u) => u.id).sort()).toEqual(["ahmed", "khaled", "omar", "yousef"]);
    expect(users.filter((u) => u.role === "supervisor").map((u) => u.id)).toEqual(["sami"]);
    expect(r.supervisorId).toBe("sami");
    const supervisorOf = Object.fromEntries(users.map((u) => [u.id, u.supervisorId]));
    expect(supervisorOf).toMatchObject({ ahmed: "sami", khaled: "sami", omar: null, yousef: null });

    const sumFor = async (userId: string, lineId: string) => {
      const [row] = await db
        .select({ n: sql<number>`coalesce(sum(${s.closeLines.amount}), 0)::bigint` })
        .from(s.closeLines)
        .innerJoin(s.dailyCloses, eq(s.closeLines.closeId, s.dailyCloses.id))
        .where(and(eq(s.dailyCloses.userId, userId), eq(s.closeLines.lineId, lineId)));
      return Number(row!.n);
    };
    expect(await sumFor("khaled", "bev")).toBe(1320);
    expect(await sumFor("khaled", "food")).toBe(8_800_000);
    expect(await sumFor("khaled", "coll")).toBe(22_000_000);
    expect(await sumFor("omar", "bev")).toBe(770);
    expect(await sumFor("omar", "food")).toBe(5_500_000);
    expect(await sumFor("omar", "coll")).toBe(11_000_000);
    expect(await sumFor("yousef", "bev")).toBe(0);
    expect((await db.select().from(s.dailyCloses).where(eq(s.dailyCloses.userId, "yousef")))).toHaveLength(0);

    const team = ["ahmed", "khaled", "omar", "yousef"];
    for (const id of team) {
      const t = await db.select().from(s.targets).where(eq(s.targets.userId, id));
      expect(Object.fromEntries(t.map((x) => [x.lineId, x.amount]))).toEqual({ bev: 3000, food: 18_000_000, coll: 45_000_000 });
    }
    // Team totals from the shared sample data.
    let bev = 0;
    let food = 0;
    let coll = 0;
    for (const id of team) {
      bev += await sumFor(id, "bev");
      food += await sumFor(id, "food");
      coll += await sumFor(id, "coll");
    }
    expect([bev, food, coll]).toEqual([3230, 22_580_000, 51_900_000]);

    const { peekInvite } = await import("@/server/auth/invites");
    expect(await peekInvite(db, r.supervisorInviteToken)).toMatchObject({ login: "sami" });
  });

  it("is idempotent: a second run changes no row counts", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const before = await counts(db);
    expect(before.invites).toBe(3);
    await seedDemo(db);
    expect(await counts(db)).toEqual(before);
  });

  describe("deployed mode (R15)", () => {
    it("creates the demo owner and admin without passwords and returns their invites", async () => {
      const db = await createTestDb();
      const r = await seedDemo(db, { deployed: true });
      const owner = (await db.select().from(s.users).where(eq(s.users.id, r.ownerId)))[0]!;
      const admin = (await db.select().from(s.users).where(eq(s.users.id, r.adminId)))[0]!;
      expect(owner.passwordHash).toBeNull();
      expect(admin.passwordHash).toBeNull();
      expect(r.ownerInviteToken).toBeTruthy();
      expect(r.adminInviteToken).toBeTruthy();
      const { peekAdminInvite, acceptAdminInvite } = await import("@/server/auth/invites");
      expect(await peekAdminInvite(db, r.ownerInviteToken!)).toMatchObject({ login: "owner@platform.test" });
      expect(await peekAdminInvite(db, r.adminInviteToken!)).toMatchObject({ login: "admin@demo.test" });
      expect((await acceptAdminInvite(db, r.adminInviteToken!, "a-long-password-1")).ok).toBe(true);
    });

    it("does not issue a new owner or admin invite once the password is set", async () => {
      const db = await createTestDb();
      const first = await seedDemo(db, { deployed: true });
      const { acceptAdminInvite } = await import("@/server/auth/invites");
      await acceptAdminInvite(db, first.adminInviteToken!, "a-long-password-1");
      const again = await seedDemo(db, { deployed: true });
      expect(again.adminInviteToken).toBeUndefined();
      expect(again.ownerInviteToken).toBeTruthy();
      expect((await db.select().from(s.users).where(eq(s.users.id, again.adminId)))[0]!.passwordHash).toMatch(/^scrypt\$/);
    });

    it("local mode keeps the demo hashes and returns no admin invites", async () => {
      const db = await createTestDb();
      const r = await seedDemo(db, { deployed: false });
      expect((await db.select().from(s.users).where(eq(s.users.id, r.ownerId)))[0]!.passwordHash).toMatch(/^scrypt\$/);
      expect((await db.select().from(s.users).where(eq(s.users.id, r.adminId)))[0]!.passwordHash).toMatch(/^scrypt\$/);
      expect(r.ownerInviteToken).toBeUndefined();
      expect(r.adminInviteToken).toBeUndefined();
    });
  });
});
