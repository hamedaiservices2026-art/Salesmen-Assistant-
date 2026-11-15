import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";

const migrationsFolder = () => path.join(process.cwd(), "drizzle");

export async function migratePglite(db: PgliteDatabase<Record<string, unknown>>) {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

/** Fixed key of the Postgres advisory lock that serialises migrations across instances. */
export const MIGRATION_LOCK_KEY = 727_001;

/**
 * Applies pending migrations while holding a Postgres advisory lock, so several instances that
 * cold-start together do not race. Uses its own single connection (a session-level lock must be
 * released on the connection that took it) and closes it afterwards.
 */
export async function migratePostgres(url: string): Promise<void> {
  const [{ drizzle }, { migrate }, { default: postgres }] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("drizzle-orm/postgres-js/migrator"),
    import("postgres"),
  ]);
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: migrationsFolder() });
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
