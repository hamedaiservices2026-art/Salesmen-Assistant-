import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { isStorageKey, type FileKind } from "@/domain/files";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { UPLOADS_USER_DAY } from "@/server/ai/limits";
import { localStore } from "./local-store";
import type { FileStore } from "./store";
import {
  CLOSE_PHOTOS_MAX,
  FILE_RETENTION_DAYS,
  RETURN_PHOTOS_MAX,
  SWEEP_MAX_ATTEMPTS,
  UNATTACHED_HOURS,
  attachFiles,
  attachOrder,
  canView,
  readFile,
  removeOwnFile,
  saveUpload,
  sweepFiles,
} from "./files";

let db: Db;
let root: string;
let store: FileStore;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
  root = await mkdtemp(path.join(tmpdir(), "files-records-"));
  store = localStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctxOf = (userId: string, role: Role = "rep", companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const ahmed = () => ctxOf("ahmed");
/** 10:00 in Riyadh on 14 Nov 2026. */
const NOW = new Date("2026-11-14T07:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const deps = (extra: Partial<{ now: Date; today: string }> = {}) => ({ store, now: NOW, today: "2026-11-14", ...extra });

let jpeg800: Uint8Array;
const grey = async (w: number, h: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer());
beforeEach(async () => {
  jpeg800 ??= await grey(800, 600);
});

async function upload(ctx = ahmed(), kind: FileKind = "return", extra: Partial<{ now: Date; today: string }> = {}) {
  const r = await saveUpload(ctx, { kind, date: "2026-11-14", bytes: jpeg800 }, deps(extra));
  if (!r.ok) throw new Error(`upload failed: ${r.error}`);
  return r.id;
}
const row = async (id: string) => (await db.select().from(s.files).where(eq(s.files.id, id)))[0];
/** The rep's upload counter for 14 Nov (0 when it has no row). */
const uploadCount = async (userId = "ahmed") =>
  (
    await db
      .select({ c: s.aiCounters.count })
      .from(s.aiCounters)
      .where(and(eq(s.aiCounters.scope, `user:${userId}`), eq(s.aiCounters.bucket, "2026-11-14"), eq(s.aiCounters.kind, "upload")))
  )[0]?.c ?? 0;
const fileCount = async () => (await db.select({ id: s.files.id }).from(s.files)).length;
/** Every object under the store root (a recursive listing). */
async function storedObjects(): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return (await readdir(root, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}

describe("constants", () => {
  it("has the plan's values", () => {
    expect(FILE_RETENTION_DAYS).toEqual({ report: 30, return: 180 });
    expect(UNATTACHED_HOURS).toBe(24);
    expect(RETURN_PHOTOS_MAX).toBe(3);
    expect(CLOSE_PHOTOS_MAX).toBe(12);
  });
});

describe("canView", () => {
  it("a return photo: owner, supervisor and admin; a report photo: the owner only", () => {
    expect(canView("return", "owner")).toBe(true);
    expect(canView("return", "supervisor")).toBe(true);
    expect(canView("return", "admin")).toBe(true);
    expect(canView("report", "owner")).toBe(true);
    expect(canView("report", "supervisor")).toBe(false);
    expect(canView("report", "admin")).toBe(false);
  });
});

describe("saveUpload", () => {
  it("stores Ahmed's return photo with his company and user, unattached, readable back as a JPEG", async () => {
    const r = await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps());
    expect(r).toEqual({ ok: true, id: expect.stringMatching(/^[0-9a-f]{32}$/), width: 800, height: 600 });
    if (!r.ok) return;
    const f = (await row(r.id))!;
    expect(f).toMatchObject({ companyId: "demo-co", userId: "ahmed", kind: "return", date: "2026-11-14", closeId: null, returnPos: null });
    expect(f.attachedAt).toBeNull();
    expect(f.deletedAt).toBeNull();
    expect(isStorageKey(f.storageKey)).toBe(true);
    expect(f.storageKey).toBe(`demo-co/ahmed/2026-11-14/return-${r.id}.jpg`);
    expect(f.bytes).toBeGreaterThan(0);
    const got = await readFile(ahmed(), r.id, { store });
    expect([...got!.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(got!.bytes.byteLength).toBe(f.bytes);
  });

  it("refuses SVG bytes: unsupported_type, no row, no stored object", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: svg }, deps())).toEqual({ ok: false, error: "unsupported_type" });
    expect(await fileCount()).toBe(0);
    expect(await storedObjects()).toEqual([]);
  });

  it("refuses a future date, a date more than 62 days back and a date that is not real", async () => {
    const bad = async (date: string) => saveUpload(ahmed(), { kind: "return", date, bytes: jpeg800 }, deps());
    expect(await bad("2026-11-15")).toEqual({ ok: false, error: "bad_date" });
    expect(await bad("2026-09-12")).toEqual({ ok: false, error: "bad_date" }); // 63 days back
    expect(await bad("2026-02-30")).toEqual({ ok: false, error: "bad_date" });
    expect(await bad("14/11/2026")).toEqual({ ok: false, error: "bad_date" });
    expect((await bad("2026-09-13")).ok).toBe(true); // exactly 62 days back
    expect(await fileCount()).toBe(1);
  });

  it("the 41st upload of a day is refused as quota", async () => {
    expect(UPLOADS_USER_DAY).toBe(40);
    // Only the counter matters here: pre-fill it to 39 rather than decoding 40 photos.
    await db.insert(s.aiCounters).values({ scope: "user:ahmed", bucket: "2026-11-14", kind: "upload", companyId: "demo-co", count: 39 });
    expect((await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps())).ok).toBe(true);
    expect(await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps())).toEqual({ ok: false, error: "quota" });
    expect(await fileCount()).toBe(1);
  });

  it("a store whose put throws: storage_failed; the row is soft-deleted so the sweep removes anything half-written (R71)", async () => {
    let wroteKey = "";
    // A write that fails after part of the object reached the store.
    const failing: FileStore = {
      ...store,
      put: async (key, bytes) => {
        wroteKey = key;
        await store.put(key, bytes);
        throw new Error("connection reset");
      },
    };
    expect(await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, { ...deps(), store: failing })).toEqual({
      ok: false,
      error: "storage_failed",
    });
    const rows = await db.select().from(s.files);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(await readFile(ahmed(), rows[0]!.id, { store })).toBeNull();
    // The upload slot is given back (R70.5).
    expect(await uploadCount()).toBe(0);
    // The next sweep removes the row and the object that did get written.
    expect(await sweepFiles(db, store, new Date(NOW.getTime() + 60_000))).toBe(1);
    expect(await store.get(wroteKey)).toBeNull();
    expect(await fileCount()).toBe(0);
  });

  it("the row is written before the object: an insert that fails never stores an object (R70.4)", async () => {
    // A user id that passes every key check but has no users row: the insert fails on its foreign key.
    const ghost = ctxOf("ghost");
    const put = vi.spyOn(store, "put");
    const r = await saveUpload(ghost, { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps());
    expect(r).toEqual({ ok: false, error: "storage_failed" });
    expect(put).not.toHaveBeenCalled();
    expect(await storedObjects()).toEqual([]);
    expect(await fileCount()).toBe(0);
    expect(await uploadCount("ghost")).toBe(0);
  });

  it("every stored object has its row: while the object is written, the row already exists (R70.4)", async () => {
    let rowsDuringPut = -1;
    const watching: FileStore = {
      ...store,
      put: async (key, bytes) => {
        rowsDuringPut = await fileCount();
        return store.put(key, bytes);
      },
    };
    expect((await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, { ...deps(), store: watching })).ok).toBe(true);
    expect(rowsDuringPut).toBe(1);
  });

  it("a refused photo still spends its upload slot (R70.5)", async () => {
    const svg = new TextEncoder().encode("<svg/>");
    await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: svg }, deps());
    await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) }, deps());
    expect(await uploadCount()).toBe(2);
  });

  it("a report photo may be at most 30 days old, a return photo 62 (R70.1)", async () => {
    const at = async (kind: FileKind, date: string) => (await saveUpload(ahmed(), { kind, date, bytes: jpeg800 }, deps())).ok;
    expect(await at("report", "2026-10-14")).toBe(false); // 31 days back
    expect(await at("report", "2026-10-15")).toBe(true); // 30 days back
    expect(await at("return", "2026-09-13")).toBe(true); // 62 days back
  });

  it("refuses a context made by repCtx and an admin or owner", async () => {
    const tagged = { ...ahmed(), actingFor: "supervisor" as const };
    await expect(saveUpload(tagged, { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps())).rejects.toThrow(Forbidden);
    await expect(saveUpload(ctxOf("demo-admin", "admin"), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps())).rejects.toThrow(Forbidden);
    expect(await fileCount()).toBe(0);
  });

  it("a supervisor may store his own photo", async () => {
    expect((await saveUpload(ctxOf("sami", "supervisor"), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps())).ok).toBe(true);
  });
});

describe("readFile", () => {
  async function supervisorWithoutAhmed(): Promise<Ctx> {
    await db.insert(s.users).values({ id: "sup2", companyId: "demo-co", role: "supervisor", name: "مشرف", login: "sup2" });
    return ctxOf("sup2", "supervisor");
  }

  it("a return photo: Ahmed, his supervisor and his admin get bytes; nobody else does", async () => {
    const id = await upload();
    const sees = async (ctx: Ctx) => (await readFile(ctx, id, { store })) !== null;
    expect(await sees(ahmed())).toBe(true);
    expect(await sees(ctxOf("sami", "supervisor"))).toBe(true);
    expect(await sees(ctxOf("demo-admin", "admin"))).toBe(true);
    expect(await sees(ctxOf("khaled"))).toBe(false);
    expect(await sees(await supervisorWithoutAhmed())).toBe(false);
    expect(await sees(ctxOf("other-admin", "admin", "other-co"))).toBe(false);
    expect(await sees(ctxOf("other-rep", "rep", "other-co"))).toBe(false);
    expect(await sees(ctxOf("owner", "owner", "platform"))).toBe(false);
    // Even with the right company, an owner role never sees a photo.
    expect(await sees(ctxOf("owner", "owner", "demo-co"))).toBe(false);
  });

  it("a report photo: Ahmed only", async () => {
    const id = await upload(ahmed(), "report");
    const sees = async (ctx: Ctx) => (await readFile(ctx, id, { store })) !== null;
    expect(await sees(ahmed())).toBe(true);
    expect(await sees(ctxOf("sami", "supervisor"))).toBe(false);
    expect(await sees(ctxOf("demo-admin", "admin"))).toBe(false);
    expect(await sees(ctxOf("khaled"))).toBe(false);
  });

  it("a tagged (repCtx) context is refused, even for Ahmed's own id", async () => {
    const id = await upload();
    expect(await readFile({ ...ahmed(), actingFor: "admin" }, id, { store })).toBeNull();
    expect(await readFile({ ...ahmed(), actingFor: "supervisor" }, id, { store })).toBeNull();
  });

  it("a malformed id is null without touching the store", async () => {
    const get = vi.fn(store.get);
    const spy: FileStore = { ...store, get };
    expect(await readFile(ahmed(), "../../etc/passwd", { store: spy })).toBeNull();
    expect(await readFile(ahmed(), "0123456789abcdef0123456789abcde", { store: spy })).toBeNull(); // 31 characters
    expect(await readFile(ahmed(), "0123456789ABCDEF0123456789ABCDEF", { store: spy })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("an unknown well-formed id is null, and a refused viewer never reaches the store", async () => {
    const id = await upload();
    const get = vi.fn(store.get);
    const spy: FileStore = { ...store, get };
    expect(await readFile(ahmed(), "f".repeat(32), { store: spy })).toBeNull();
    expect(await readFile(ctxOf("khaled"), id, { store: spy })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("a photo past its retention is not readable even before the sweep (R70.6)", async () => {
    const report = await upload(ahmed(), "report");
    const ret = await upload(ahmed(), "return");
    const at = (days: number) => ({ store, now: new Date(Date.parse("2026-11-14T07:00:00Z") + days * DAY) });
    expect(await readFile(ahmed(), report, at(30))).not.toBeNull();
    expect(await readFile(ahmed(), report, at(31))).toBeNull();
    expect(await readFile(ahmed(), ret, at(180))).not.toBeNull();
    expect(await readFile(ahmed(), ret, at(181))).toBeNull();
  });

  it("a soft-deleted photo is null", async () => {
    const id = await upload();
    await db.update(s.files).set({ deletedAt: NOW }).where(eq(s.files.id, id));
    expect(await readFile(ahmed(), id, { store })).toBeNull();
    expect(await readFile(ctxOf("demo-admin", "admin"), id, { store })).toBeNull();
  });
});

describe("removeOwnFile", () => {
  it("only the owner removes; afterwards nobody reads it", async () => {
    const id = await upload();
    expect(await removeOwnFile(ctxOf("khaled"), id)).toEqual({ ok: false, error: "not_found" });
    expect(await removeOwnFile(ctxOf("sami", "supervisor"), id)).toEqual({ ok: false, error: "not_found" });
    expect(await removeOwnFile(ctxOf("other-rep", "rep", "other-co"), id)).toEqual({ ok: false, error: "not_found" });
    expect((await row(id))!.deletedAt).toBeNull();
    expect(await removeOwnFile(ahmed(), id)).toEqual({ ok: true });
    expect((await row(id))!.deletedAt).not.toBeNull();
    expect(await readFile(ahmed(), id, { store })).toBeNull();
  });

  it("a malformed or unknown id is not_found; a tagged context is refused", async () => {
    expect(await removeOwnFile(ahmed(), "../x")).toEqual({ ok: false, error: "not_found" });
    expect(await removeOwnFile(ahmed(), "f".repeat(32))).toEqual({ ok: false, error: "not_found" });
    const id = await upload();
    await expect(removeOwnFile({ ...ahmed(), actingFor: "admin" }, id)).rejects.toThrow(Forbidden);
  });

  it("an attached photo is left to the next save of its close (R71): ok, but still there", async () => {
    const id = await upload();
    await db.update(s.files).set({ closeId: "close-ahmed-2026-11-12", returnPos: 0, attachedAt: NOW }).where(eq(s.files.id, id));
    expect(await removeOwnFile(ahmed(), id)).toEqual({ ok: true });
    expect((await row(id))!.deletedAt).toBeNull();
    expect(await readFile(ahmed(), id, { store })).not.toBeNull();
  });
});

describe("sweepFiles", () => {
  /** An upload by Ahmed made at `NOW`, dated `date`, optionally attached to his 12 Nov close. */
  async function make(kind: FileKind, opts: { attached: boolean; date?: string }): Promise<string> {
    const date = opts.date ?? "2026-11-14";
    const r = await saveUpload(ahmed(), { kind, date, bytes: jpeg800 }, deps());
    if (!r.ok) throw new Error(r.error);
    if (opts.attached) {
      await db.update(s.files).set({ closeId: "close-ahmed-2026-11-12", returnPos: 0, attachedAt: NOW }).where(eq(s.files.id, r.id));
    }
    return r.id;
  }
  const exists = async (id: string) => (await row(id)) !== undefined;
  const hasBytes = async (id: string) => {
    const f = await row(id);
    return f ? (await store.get(f.storageKey)) !== null : false;
  };
  const keyOf = async (id: string) => (await row(id))!.storageKey;

  it("at upload + 25 h removes an unattached file (row and object) and keeps an attached one", async () => {
    const loose = await make("return", { attached: false });
    const kept = await make("return", { attached: true });
    const looseKey = await keyOf(loose);
    expect(await sweepFiles(db, store, new Date(NOW.getTime() + 25 * HOUR))).toBe(1);
    expect(await exists(loose)).toBe(false);
    expect(await store.get(looseKey)).toBeNull();
    expect(await exists(kept)).toBe(true);
    expect(await hasBytes(kept)).toBe(true);
  });

  it("keeps an unattached file at exactly 24 h", async () => {
    const loose = await make("return", { attached: false });
    expect(await sweepFiles(db, store, new Date(NOW.getTime() + 24 * HOUR))).toBe(0);
    expect(await hasBytes(loose)).toBe(true);
  });

  it("retention counts from the photo's date: report 30 days, return 180 days", async () => {
    const report = await make("report", { attached: true });
    const ret = await make("return", { attached: true });
    // Exactly at the limit (the 30th day after the date, at any hour): both kept.
    expect(await sweepFiles(db, store, new Date(Date.parse("2026-11-14T00:00:00Z") + 30 * DAY + 23 * HOUR))).toBe(0);
    expect(await hasBytes(report)).toBe(true);
    // date + 31 days: the report goes, the return stays.
    expect(await sweepFiles(db, store, new Date(Date.parse("2026-11-14T07:00:00Z") + 31 * DAY))).toBe(1);
    expect(await exists(report)).toBe(false);
    expect(await hasBytes(ret)).toBe(true);
    // date + 180 days (the limit): kept; + 181 days: removed.
    expect(await sweepFiles(db, store, new Date(Date.parse("2026-11-14T07:00:00Z") + 180 * DAY))).toBe(0);
    expect(await hasBytes(ret)).toBe(true);
    expect(await sweepFiles(db, store, new Date(Date.parse("2026-11-14T07:00:00Z") + 181 * DAY))).toBe(1);
    expect(await exists(ret)).toBe(false);
  });

  it("removes a soft-deleted file at once, attached or not", async () => {
    const id = await make("return", { attached: true });
    const key = await keyOf(id);
    await db.update(s.files).set({ deletedAt: NOW }).where(eq(s.files.id, id));
    expect(await sweepFiles(db, store, new Date(NOW.getTime() + HOUR))).toBe(1);
    expect(await exists(id)).toBe(false);
    expect(await store.get(key)).toBeNull();
  });

  it("a store whose remove throws leaves the row (and it stays unreadable) for the next sweep", async () => {
    const id = await make("return", { attached: false });
    const failing: FileStore = { ...store, remove: async () => Promise.reject(new Error("offline")) };
    const later = new Date(NOW.getTime() + 25 * HOUR);
    expect(await sweepFiles(db, failing, later)).toBe(0);
    expect(await exists(id)).toBe(true);
    expect(await readFile(ahmed(), id, { store })).toBeNull();
    expect(await sweepFiles(db, store, later)).toBe(1);
    expect(await exists(id)).toBe(false);
  });

  it("a row whose remove keeps failing is skipped after 5 attempts and does not starve others (R70.3)", async () => {
    expect(SWEEP_MAX_ATTEMPTS).toBe(5);
    const stuck = await make("return", { attached: false });
    const stuckKey = await keyOf(stuck);
    const later = new Date(NOW.getTime() + 25 * HOUR);
    const picky: FileStore = { ...store, remove: async (key) => (key === stuckKey ? Promise.reject(new Error("offline")) : store.remove(key)) };
    for (let i = 0; i < 5; i++) expect(await sweepFiles(db, picky, later, 1)).toBe(0);
    expect((await row(stuck))!.sweepAttempts).toBe(5);
    // Now a second due file is reached even with a batch of one; the stuck row is left alone.
    const next = await make("return", { attached: false });
    const removes = vi.spyOn(picky, "remove");
    expect(await sweepFiles(db, picky, later, 1)).toBe(1);
    expect(await exists(next)).toBe(false);
    expect(await exists(stuck)).toBe(true);
    expect(removes).not.toHaveBeenCalledWith(stuckKey);
  });

  it("soft-deleted photos go first", async () => {
    const old = await make("return", { attached: false });
    const removed = await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps({ now: new Date(NOW.getTime() + HOUR) }));
    if (!removed.ok) throw new Error(removed.error);
    await removeOwnFile(ahmed(), removed.id);
    expect(await sweepFiles(db, store, new Date(NOW.getTime() + 25 * HOUR), 1)).toBe(1);
    expect(await exists(removed.id)).toBe(false);
    expect(await exists(old)).toBe(true);
  });

  it("two sweeps at once never take the same row", async () => {
    const ids = [await make("return", { attached: false }), await make("return", { attached: false }), await make("return", { attached: false })];
    const removes = vi.fn(store.remove);
    const counting: FileStore = { ...store, remove: removes };
    const later = new Date(NOW.getTime() + 25 * HOUR);
    const [a, b] = await Promise.all([sweepFiles(db, counting, later), sweepFiles(db, counting, later)]);
    expect(a + b).toBe(3);
    expect(removes).toHaveBeenCalledTimes(3);
    for (const id of ids) expect(await exists(id)).toBe(false);
  });

  it("works in bounded batches and across companies", async () => {
    const a = await make("return", { attached: false });
    const b = await saveUpload(ctxOf("other-rep", "rep", "other-co"), { kind: "return", date: "2026-11-14", bytes: jpeg800 }, deps());
    if (!b.ok) throw new Error(b.error);
    const later = new Date(NOW.getTime() + 25 * HOUR);
    expect(await sweepFiles(db, store, later, 1)).toBe(1);
    expect(await sweepFiles(db, store, later, 1)).toBe(1);
    expect(await sweepFiles(db, store, later, 1)).toBe(0);
    expect(await exists(a)).toBe(false);
    expect(await exists(b.id)).toBe(false);
  });
});

describe("attachFiles (R70.2)", () => {
  const CLOSE = "close-ahmed-2026-11-12";
  const OTHER_CLOSE = "close-ahmed-2026-11-11";
  const attach = (ids: string[], closeId = CLOSE, ctx = ahmed()) =>
    db.transaction((tx) => attachFiles(tx as unknown as Db, ctx, closeId, ids.map((id, i) => ({ id, kind: "return" as const, returnPos: i })), NOW));

  it("attaches the rep's own unattached photos with their positions", async () => {
    const a = await upload();
    const b = await upload();
    expect(await attach([a, b])).toEqual({ missing: [] });
    expect(await row(a)).toMatchObject({ closeId: CLOSE, returnPos: 0 });
    expect(await row(b)).toMatchObject({ closeId: CLOSE, returnPos: 1 });
    expect((await row(a))!.attachedAt).not.toBeNull();
    // Re-attaching to the same close moves the position.
    expect(await attach([b])).toEqual({ missing: [] });
    expect((await row(b))!.returnPos).toBe(0);
  });

  it("reports every photo it could not attach and changes none of them", async () => {
    const deleted = await upload();
    await removeOwnFile(ahmed(), deleted);
    const khaleds = await upload(ctxOf("khaled"));
    const report = await upload(ahmed(), "report");
    const elsewhere = await upload();
    expect(await attach([elsewhere], OTHER_CLOSE)).toEqual({ missing: [] });
    const unknown = "f".repeat(32);
    const ok = await upload();
    const r = await attach([deleted, khaleds, report, elsewhere, unknown, "../x", ok]);
    expect(r.missing).toEqual([deleted, khaleds, report, elsewhere, unknown, "../x"]);
    expect((await row(deleted))!.closeId).toBeNull();
    expect((await row(khaleds))!.closeId).toBeNull();
    expect((await row(report))!.closeId).toBeNull();
    expect((await row(elsewhere))!.closeId).toBe(OTHER_CLOSE);
    expect((await row(ok))!.closeId).toBe(CLOSE);
  });

  it("updates in id order whatever order the form lists them, so two saves cannot deadlock (R71)", async () => {
    const ids = [await upload(), await upload(), await upload()];
    const items = [...ids].sort().reverse().map((id, i) => ({ id, kind: "return" as const, returnPos: i }));
    expect(attachOrder(items).map((it) => it.id)).toEqual([...ids].sort());
    // The positions travel with their ids.
    expect(attachOrder(items).every((it) => items.find((x) => x.id === it.id)!.returnPos === it.returnPos)).toBe(true);
    // A missing id is still reported in the form's order.
    const r = await db.transaction((tx) =>
      attachFiles(tx as unknown as Db, ahmed(), CLOSE, [{ id: "f".repeat(32), kind: "return", returnPos: 0 }, ...items, { id: "e".repeat(32), kind: "return", returnPos: 1 }], NOW),
    );
    expect(r.missing).toEqual(["f".repeat(32), "e".repeat(32)]);
  });

  it("another company's context attaches nothing", async () => {
    const a = await upload();
    expect((await attach([a], CLOSE, ctxOf("ahmed", "rep", "other-co"))).missing).toEqual([a]);
  });

  it("a photo the sweep removed in between is reported, never silently lost", async () => {
    const a = await upload();
    await sweepFiles(db, store, new Date(NOW.getTime() + 25 * HOUR));
    expect((await attach([a])).missing).toEqual([a]);
  });
});
