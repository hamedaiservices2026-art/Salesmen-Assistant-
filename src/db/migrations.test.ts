import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDbAt, migrateRest } from "./testing";

describe("migration 0001 line shapes", () => {
  it("backfills code, Urdu name and behind percentage on plan-1 rows", async () => {
    const db = await createTestDbAt("0000_zippy_marvel_boy");
    await db.execute(
      sql`insert into companies (id, name, selling_weekdays) values ('c1', 'Co', '{6,0,1,2,3,4}')`,
    );
    await db.execute(
      sql`insert into target_lines (id, company_id, name_ar, name_en, unit, kind)
          values ('bev', 'c1', 'مشروبات', 'Beverages', 'cases', 'sales')`,
    );
    await migrateRest(db);
    const line = (await db.execute(sql`select code, name_ur from target_lines where id = 'bev'`)) as unknown as {
      rows: { code: string; name_ur: string }[];
    };
    expect(line.rows[0]!).toEqual({ code: "bev", name_ur: "مشروبات" });
    const co = (await db.execute(sql`select behind_pct from companies where id = 'c1'`)) as unknown as {
      rows: { behind_pct: number }[];
    };
    expect(co.rows[0]!.behind_pct).toBe(10);
  });
});

describe("migration 0002 admin auth", () => {
  it("adds password_hash and failed_at, backfilling failed_at from updated_at on rows with failures", async () => {
    const db = await createTestDbAt("0001_line_shapes");
    await db.execute(sql`insert into companies (id, name, selling_weekdays) values ('c1', 'Co', '{6,0,1,2,3,4}')`);
    await db.execute(
      sql`insert into users (id, company_id, role, name, login, failed_attempts, updated_at) values
          ('stuck', 'c1', 'rep', 'A', 'stuck', 5, '2026-11-14T09:00:00Z'),
          ('clean', 'c1', 'rep', 'B', 'clean', 0, '2026-11-14T09:00:00Z')`,
    );
    await migrateRest(db);
    const rows = (await db.execute(
      sql`select id, failed_at, password_hash from users order by id`,
    )) as unknown as { rows: { id: string; failed_at: string | Date | null; password_hash: string | null }[] };
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId.clean!.failed_at).toBeNull();
    expect(new Date(byId.stuck!.failed_at!).toISOString()).toBe("2026-11-14T09:00:00.000Z");
    expect(byId.stuck!.password_hash).toBeNull();
  });
});
