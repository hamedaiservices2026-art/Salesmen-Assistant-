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

describe("migration 0005 scheme versions", () => {
  it("makes each published scheme version 1 with one logged version and no publisher; drafts start empty", async () => {
    const db = await createTestDbAt("0004_target_changes");
    await db.execute(sql`insert into companies (id, name, selling_weekdays) values ('c1', 'Co', '{6,0,1,2,3,4}'), ('c2', 'Co2', '{6,0,1,2,3,4}')`);
    await db.execute(
      sql`insert into target_lines (id, company_id, code, name_ar, name_en, name_ur, unit, kind)
          values ('bev', 'c1', 'bev', 'مشروبات', 'Beverages', 'مشروبات', 'cases', 'sales')`,
    );
    const components = JSON.stringify([
      { id: "c_bev", type: "tiered", label: "شرائح", lineId: "bev", tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 1 } }] },
    ]);
    await db.execute(
      sql`insert into schemes (id, company_id, name, year, month, components, published, updated_at) values
          ('s-nov', 'c1', 'November', 2026, 11, ${components}::jsonb, true, '2026-11-01T08:00:00Z'),
          ('s-dec', 'c1', 'December', 2026, 12, '[]'::jsonb, false, '2026-11-02T08:00:00Z'),
          ('s-other', 'c2', 'November', 2026, 11, '[]'::jsonb, true, '2026-11-03T08:00:00Z')`,
    );
    await migrateRest(db);

    const schemes = (await db.execute(
      sql`select id, version, draft, draft_rev, published_at, published_by from schemes order by id`,
    )) as unknown as {
      rows: { id: string; version: number; draft: unknown; draft_rev: number; published_at: string | Date | null; published_by: string | null }[];
    };
    const byId = Object.fromEntries(schemes.rows.map((r) => [r.id, r]));
    expect(byId["s-nov"]).toMatchObject({ version: 1, draft: null, draft_rev: 0, published_by: null });
    expect(new Date(byId["s-nov"]!.published_at!).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(byId["s-dec"]).toMatchObject({ version: 0, draft: null, draft_rev: 0, published_at: null, published_by: null });
    expect(byId["s-other"]).toMatchObject({ version: 1 });

    const versions = (await db.execute(
      sql`select id, company_id, scheme_id, version, components, published_by from scheme_versions order by id`,
    )) as unknown as { rows: Record<string, unknown>[] };
    expect(versions.rows).toEqual([
      { id: "s-nov-v1", company_id: "c1", scheme_id: "s-nov", version: 1, components: JSON.parse(components), published_by: null },
      { id: "s-other-v1", company_id: "c2", scheme_id: "s-other", version: 1, components: [], published_by: null },
    ]);
  });
});

describe("migration 0012 target_changes index and upload foreign key", () => {
  it("keeps real upload links, clears one that points at no upload, and adds the index and the constraint", async () => {
    const db = await createTestDbAt("0011_policy_documents");
    await db.execute(sql`insert into companies (id, name, selling_weekdays) values ('c1', 'Co', '{6,0,1,2,3,4}')`);
    await db.execute(sql`insert into users (id, company_id, role, name, login) values ('u1', 'c1', 'admin', 'A', 'a@x.test')`);
    await db.execute(
      sql`insert into target_lines (id, company_id, code, name_ar, name_en, name_ur, unit, kind) values ('l1', 'c1', 'l1', 'x', 'x', 'x', 'cases', 'sales')`,
    );
    await db.execute(sql`insert into uploads (id, company_id, kind, filename, uploaded_by) values ('up-real', 'c1', 'targets', 'f.xlsx', 'u1')`);
    await db.execute(
      sql`insert into target_changes (id, company_id, user_id, line_id, year, month, source, changed_by, upload_id) values
          ('a', 'c1', 'u1', 'l1', 2026, 11, 'excel', 'u1', 'up-real'),
          ('b', 'c1', 'u1', 'l1', 2026, 11, 'excel', 'u1', 'up-gone'),
          ('c', 'c1', 'u1', 'l1', 2026, 11, 'form', 'u1', NULL)`,
    );
    await migrateRest(db);
    const rows = (await db.execute(sql`select id, upload_id from target_changes order by id`)) as unknown as {
      rows: { id: string; upload_id: string | null }[];
    };
    expect(rows.rows).toEqual([
      { id: "a", upload_id: "up-real" },
      { id: "b", upload_id: null },
      { id: "c", upload_id: null },
    ]);
    const idx = (await db.execute(sql`select indexname from pg_indexes where indexname = 'target_changes_company_created'`)) as unknown as {
      rows: unknown[];
    };
    expect(idx.rows).toHaveLength(1);
    await expect(
      db.execute(
        sql`insert into target_changes (id, company_id, user_id, line_id, year, month, source, changed_by, upload_id) values ('d', 'c1', 'u1', 'l1', 2026, 11, 'excel', 'u1', 'nope')`,
      ),
    ).rejects.toThrow();
  });
});

describe("migration 0013 ai core", () => {
  it("adds the AI switch (off) and the notice version (0) to existing rows, and the counter and usage tables", async () => {
    const db = await createTestDbAt("0012_target_changes_index_fk");
    await db.execute(sql`insert into companies (id, name, selling_weekdays) values ('c1', 'Co', '{6,0,1,2,3,4}')`);
    await db.execute(sql`insert into users (id, company_id, role, name, login) values ('u1', 'c1', 'rep', 'A', 'a')`);
    await migrateRest(db);
    const co = (await db.execute(sql`select ai_enabled from companies where id = 'c1'`)) as unknown as {
      rows: { ai_enabled: boolean }[];
    };
    expect(co.rows[0]!.ai_enabled).toBe(false);
    const user = (await db.execute(sql`select ai_notice_version, ai_notice_at from users where id = 'u1'`)) as unknown as {
      rows: { ai_notice_version: number; ai_notice_at: unknown }[];
    };
    expect(user.rows[0]!).toEqual({ ai_notice_version: 0, ai_notice_at: null });
    const tables = (await db.execute(
      sql`select table_name from information_schema.tables where table_name in ('ai_counters', 'ai_usage') order by table_name`,
    )) as unknown as { rows: { table_name: string }[] };
    expect(tables.rows.map((r) => r.table_name)).toEqual(["ai_counters", "ai_usage"]);
    // No column of the usage log can hold content (a question, a transcript, a reply, a file name, an amount).
    const cols = (await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'ai_usage' order by ordinal_position`,
    )) as unknown as { rows: { column_name: string }[] };
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      "id",
      "company_id",
      "user_id",
      "kind",
      "feature",
      "provider",
      "model",
      "outcome",
      "attempts",
      "fallback",
      "latency_ms",
      "tokens_in",
      "tokens_out",
      "topic",
      "created_at",
    ]);
  });
});
