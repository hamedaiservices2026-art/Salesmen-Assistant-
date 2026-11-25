import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { FileStore } from "@/server/files/store";
import { MAINTENANCE_INTERVAL_MS, resetMaintenanceThrottle, runMaintenance } from "./maintenance";

const NOW = new Date("2026-11-14T07:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: Db;
let removed: string[];
let store: FileStore;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
  removed = [];
  store = { put: async () => undefined, get: async () => null, remove: async (key) => void removed.push(key) };
  resetMaintenanceThrottle();
});

const ID = (c: string) => c.repeat(32);
const fileRow = (c: string, createdAt: Date) => ({
  id: ID(c),
  companyId: "demo-co",
  userId: "ahmed",
  kind: "report" as const,
  date: "2026-11-12",
  storageKey: `demo-co/ahmed/2026-11-12/report-${ID(c)}.jpg`,
  bytes: 1,
  width: 1,
  height: 1,
  createdAt,
});
const usageRow = (id: string, createdAt: Date) => ({
  id,
  companyId: "demo-co",
  userId: "ahmed",
  kind: "chat" as const,
  feature: "assistant" as const,
  outcome: "ok" as const,
  attempts: 1,
  fallback: false,
  latencyMs: 1,
  createdAt,
});
const message = (id: string, createdAt: Date) => ({ id, companyId: "demo-co", userId: "ahmed", role: "user" as const, text: "x", createdAt });
const counter = (bucket: string, updatedAt: Date) => ({ scope: "user:ahmed", bucket, kind: "chat", companyId: "demo-co", count: 1, updatedAt });

/** One row of each kind that retention says must go, and one of each that it says must stay. */
async function seedRows() {
  await db.insert(s.files).values([fileRow("a", ago(2 * DAY)), fileRow("b", ago(HOUR))]); // unattached for 48 h / 1 h
  await db.insert(s.assistantMessages).values([message("m-old", ago(31 * DAY)), message("m-new", ago(DAY))]);
  await db.insert(s.aiUsage).values([usageRow("u-old", ago(91 * DAY)), usageRow("u-new", ago(DAY))]);
  await db.insert(s.aiCounters).values([counter("2026-11-10", ago(4 * DAY)), counter("2026-11-13", ago(DAY))]);
  // A receipt made 48 h ago expires 24 h ago (the rule is `expires_at <= now - 24 h`; R59), and it points at the old file.
  await db.insert(s.aiDrafts).values([
    { id: "d-old", companyId: "demo-co", userId: "ahmed", date: "2026-11-12", source: "photo", fileId: ID("a"), createdAt: ago(48 * HOUR), expiresAt: ago(24 * HOUR) },
    { id: "d-new", companyId: "demo-co", userId: "ahmed", date: "2026-11-14", source: "photo", fileId: null, createdAt: ago(HOUR), expiresAt: new Date(NOW.getTime() + HOUR) },
  ]);
}

const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id).sort();

describe("runMaintenance", () => {
  it("deletes what retention says, returns one count per sweep and keeps the rest", async () => {
    await seedRows();
    const result = await runMaintenance(db, NOW, { store, force: true });
    expect(result).toEqual({ files: 1, messages: 1, usage: 1, drafts: 1, counters: 1 });
    expect(await ids(db.select({ id: s.files.id }).from(s.files))).toEqual([ID("b")]);
    expect(await ids(db.select({ id: s.assistantMessages.id }).from(s.assistantMessages))).toEqual(["m-new"]);
    expect(await ids(db.select({ id: s.aiUsage.id }).from(s.aiUsage))).toEqual(["u-new"]);
    expect(await ids(db.select({ id: s.aiDrafts.id }).from(s.aiDrafts))).toEqual(["d-new"]);
    expect((await db.select({ bucket: s.aiCounters.bucket }).from(s.aiCounters)).map((r) => r.bucket)).toEqual(["2026-11-13"]);
    expect(removed).toEqual([`demo-co/ahmed/2026-11-12/report-${ID("a")}.jpg`]);
  });

  it("a receipt that points at a file deleted in the same run does not block it (drafts first; R28)", async () => {
    await seedRows();
    const result = await runMaintenance(db, NOW, { store, force: true });
    expect(result.files).toBe(1);
    expect(result.drafts).toBe(1);
  });

  it("a store whose remove throws gives files 0 and the other sweeps still run", async () => {
    await seedRows();
    const broken: FileStore = { ...store, remove: async () => Promise.reject(new Error("storage down")) };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await runMaintenance(db, NOW, { store: broken, force: true });
      expect(result).toEqual({ files: 0, messages: 1, usage: 1, drafts: 1, counters: 1 });
    } finally {
      quiet.mockRestore();
    }
    // the photo row is still there (soft-deleted, so it can no longer be read), waiting for the next run
    const [row] = await db.select().from(s.files).where(eq(s.files.id, ID("a")));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("a sweep that throws counts 0 and does not stop the sweeps after it", async () => {
    await seedRows();
    // no store passed and an unusable configuration: the file sweep cannot even start
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saved = { driver: process.env.STORAGE_DRIVER, url: process.env.SUPABASE_URL };
    process.env.STORAGE_DRIVER = "supabase";
    delete process.env.SUPABASE_URL;
    try {
      const result = await runMaintenance(db, NOW, { force: true });
      expect(result).toEqual({ files: 0, messages: 1, usage: 1, drafts: 1, counters: 1 });
    } finally {
      quiet.mockRestore();
      if (saved.driver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = saved.driver;
      if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
    }
  });

  it("works through up to 5 batches of a bounded sweep per run, no more", async () => {
    const old = ago(91 * DAY);
    const rows = Array.from({ length: 5003 }, (_, i) => usageRow(`u-${i}`, old));
    for (let i = 0; i < rows.length; i += 1000) await db.insert(s.aiUsage).values(rows.slice(i, i + 1000));
    const first = await runMaintenance(db, NOW, { store, force: true });
    expect(first.usage).toBe(5000);
    const second = await runMaintenance(db, NOW, { store, force: true });
    expect(second.usage).toBe(3);
  });

  it("without force: a second call within 10 minutes does nothing, one after 10 minutes runs", async () => {
    await seedRows();
    const first = await runMaintenance(db, NOW, { store });
    expect(first).toEqual({ files: 1, messages: 1, usage: 1, drafts: 1, counters: 1 });
    // new work arrives; a call 5 minutes later is skipped
    await db.insert(s.aiUsage).values(usageRow("u-old-2", ago(91 * DAY)));
    const five = await runMaintenance(db, new Date(NOW.getTime() + 5 * 60_000), { store });
    expect(five).toEqual({ files: 0, messages: 0, usage: 0, drafts: 0, counters: 0 });
    expect(await ids(db.select({ id: s.aiUsage.id }).from(s.aiUsage))).toContain("u-old-2");
    const later = await runMaintenance(db, new Date(NOW.getTime() + MAINTENANCE_INTERVAL_MS), { store });
    expect(later.usage).toBe(1);
  });

  it("force runs even inside the interval", async () => {
    await runMaintenance(db, NOW, { store });
    await db.insert(s.aiUsage).values(usageRow("u-old-3", ago(91 * DAY)));
    expect((await runMaintenance(db, new Date(NOW.getTime() + 60_000), { store, force: true })).usage).toBe(1);
  });

  it("the interval is 10 minutes", () => {
    expect(MAINTENANCE_INTERVAL_MS).toBe(600_000);
  });
});
