import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./client";
import { migratePglite } from "./migrate";
import * as schema from "./schema";

/** Fresh in-memory PGlite with migrations applied. Never touches the filesystem database. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migratePglite(db as never);
  return db as unknown as Db;
}
