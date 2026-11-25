import type { Db } from "@/db/client";
import { sweepDrafts } from "@/server/ai/drafts";
import { sweepCounters } from "@/server/ai/quota";
import { sweepUsage } from "@/server/ai/usage";
import { sweepMessages } from "@/server/assistant/conversation";
import { sweepFiles } from "@/server/files/files";
import { getFileStore, type FileStore } from "@/server/files/store";

/** Least time between two runs started by one server instance (R59). */
export const MAINTENANCE_INTERVAL_MS = 10 * 60_000;
/** A bounded sweep is repeated while it returns a full batch, at most this many times per run (R67). */
const MAX_BATCHES = 5;
/** Rows a database sweep deletes per call, and photos the photo sweep handles per call. */
const ROW_BATCH = 1000;
const FILE_BATCH = 50;

export type MaintenanceResult = { files: number; messages: number; usage: number; drafts: number; counters: number };

const NOTHING: MaintenanceResult = { files: 0, messages: 0, usage: 0, drafts: 0, counters: 0 };

let lastRunAt: number | null = null;

/** Forgets the last run (tests only). */
export function resetMaintenanceThrottle(): void {
  lastRunAt = null;
}

/**
 * Runs `sweep` while it returns a full batch, at most `MAX_BATCHES` times. A failure stops this
 * sweep only (it is logged by class name; nothing else is written) and what was deleted before it
 * is still counted.
 */
async function drain(name: string, sweep: () => Promise<number>, batch: number): Promise<number> {
  let total = 0;
  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await sweep();
      total += n;
      if (n < batch) break;
    }
  } catch (e) {
    console.error(`maintenance: ${name} sweep failed`, e instanceof Error ? e.name : "unknown error");
  }
  return total;
}

/**
 * Clears what retention says is due, across companies (system maintenance, no rep data is read):
 * expired draft receipts first, then photos (a receipt never blocks a photo row; R28), then old
 * conversations, usage rows and counters. Each sweep is bounded, isolated from the others (a
 * failure counts what it had deleted, usually 0) and returns the rows it deleted.
 *
 * A server instance runs it at most once per 10 minutes: a call inside that time does nothing and
 * returns zeros, so a visitor cannot make it run more often. `force` skips that check (tests).
 * Callers schedule it with `after()` from route and action files, never from here (R38); the same
 * function is what plan 4's cron calls.
 */
export async function runMaintenance(db: Db, now: Date, deps: { store?: FileStore; force?: boolean } = {}): Promise<MaintenanceResult> {
  const at = now.getTime();
  if (!deps.force) {
    if (lastRunAt !== null && at - lastRunAt >= 0 && at - lastRunAt < MAINTENANCE_INTERVAL_MS) return { ...NOTHING };
    // Claimed before the work starts, so two requests at once run it once.
    lastRunAt = at;
  }
  const drafts = await drain("drafts", () => sweepDrafts(db, now), ROW_BATCH);
  // The store is created here, not by the caller: a bad storage configuration then fails this sweep only.
  const files = await drain("files", async () => sweepFiles(db, deps.store ?? getFileStore(), now, FILE_BATCH), FILE_BATCH);
  const messages = await drain("messages", () => sweepMessages(db, now), ROW_BATCH);
  const usage = await drain("usage", () => sweepUsage(db, now), ROW_BATCH);
  const counters = await drain("counters", () => sweepCounters(db, now), ROW_BATCH);
  return { files, messages, usage, drafts, counters };
}
