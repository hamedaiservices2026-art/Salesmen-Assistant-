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
