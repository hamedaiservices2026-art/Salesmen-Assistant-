import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Drizzle database type that both the Postgres and PGlite drivers satisfy. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const PGLITE_DIR = ".data/pglite";

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ drizzle }, { default: postgres }, { migratePostgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
      import("./migrate"),
    ]);
    const db = drizzle(postgres(url), { schema });
    await migratePostgres(db as never);
    return db as unknown as Db;
  }
  const [{ drizzle }, { PGlite }, { migratePglite }, { mkdir }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
    import("./migrate"),
    import("node:fs/promises"),
  ]);
  await mkdir(".data", { recursive: true });
  const db = drizzle(new PGlite(PGLITE_DIR), { schema });
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
