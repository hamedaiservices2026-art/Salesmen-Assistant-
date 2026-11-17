import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

/**
 * Fresh in-memory PGlite with migrations applied up to and including `lastTag`, read from a
 * temporary copy of `drizzle/` whose journal is cut after that entry. Lets a test seed old-shape
 * rows, then call `migrateRest` to prove a migration's backfill.
 */
export async function createTestDbAt(lastTag: string): Promise<Db> {
  const source = path.join(process.cwd(), "drizzle");
  const dir = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
  try {
    await cp(source, dir, { recursive: true });
    const journalPath = path.join(dir, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === lastTag);
    if (at < 0) throw new Error(`Unknown migration tag: ${lastTag}`);
    journal.entries = journal.entries.slice(0, at + 1);
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    const db = drizzle(new PGlite(), { schema });
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: dir });
    return db as unknown as Db;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Applies every migration not yet applied (all of them, from the real `drizzle/` folder). */
export async function migrateRest(db: Db): Promise<void> {
  await migratePglite(db as never);
}
