import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { resolveDbTarget } from "./target";

/** Drizzle database type that both the Postgres and PGlite drivers satisfy. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

async function open(): Promise<Db> {
  const target = resolveDbTarget(process.env);
  if (target.kind === "postgres") {
    const [{ drizzle }, { default: postgres }, { migratePostgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
      import("./migrate"),
    ]);
    await migratePostgres(target.url);
    // prepare: false keeps it working behind a transaction-mode pooler (Supabase).
    return drizzle(postgres(target.url, { prepare: false }), { schema }) as unknown as Db;
  }
  const [{ drizzle }, { PGlite }, { migratePglite }, { mkdir }, { dirname }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
    import("./migrate"),
    import("node:fs/promises"),
    import("node:path"),
  ]);
  await mkdir(dirname(target.dir), { recursive: true });
  const db = drizzle(new PGlite(target.dir), { schema });
  await migratePglite(db as never);
  return db as unknown as Db;
}

const g = globalThis as unknown as { __db?: Promise<Db> };

/** Opens the database once per process and applies pending migrations. */
export function getDb(): Promise<Db> {
  g.__db ??= open().catch((e) => {
    g.__db = undefined;
    throw e;
  });
  return g.__db;
}
