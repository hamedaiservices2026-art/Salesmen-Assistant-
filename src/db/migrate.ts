import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

const migrationsFolder = () => path.join(process.cwd(), "drizzle");

export async function migratePglite(db: PgliteDatabase<Record<string, unknown>>) {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

export async function migratePostgres(db: PostgresJsDatabase<Record<string, unknown>>) {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
