import { randomBytes } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { todayIn, type ISODate } from "@/domain/calendar";
import { isFileId, storageKey, type FileKind } from "@/domain/files";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { UPLOADS_USER_DAY } from "@/server/ai/limits";
import { reserve } from "@/server/ai/quota";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { normalisePhoto } from "./image";
import { getFileStore, type FileStore } from "./store";

/** Days a photo is kept, counted from its date (decision 5). */
export const FILE_RETENTION_DAYS: Readonly<Record<FileKind, number>> = { report: 30, return: 180 };
/** A photo not attached to a close is deleted after this many hours. */
export const UNATTACHED_HOURS = 24;
/** Photos per return row, and per close (Task 8). */
export const RETURN_PHOTOS_MAX = 3;
export const CLOSE_PHOTOS_MAX = 12;
/** A photo may be dated at most this many days before today. */
const MAX_DAYS_BACK = 62;
/** The counter kind for photo uploads (scope `user:<id>`, the company's day). */
const UPLOAD_COUNTER = "upload";
const SWEEP_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type SaveUploadError = "too_large" | "unsupported_type" | "too_many_pixels" | "corrupt" | "busy" | "bad_date" | "quota" | "storage_failed";
export type SaveUploadResult = { ok: true; id: string; width: number; height: number } | { ok: false; error: SaveUploadError };

const fail = (error: SaveUploadError): SaveUploadResult => ({ ok: false, error });

/** Midnight UTC of a `YYYY-MM-DD` that is a real date, else null. */
function dayNumber(date: string): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return null;
  return t / DAY_MS;
}

/**
 * Stores a photo the rep (or supervisor) took for himself, unattached. In order: own context and
 * role; the date (a real date, not after today, at most 62 days back); one slot of the daily upload
 * counter (spent even when the photo is then refused, so decoding work is bounded per rep per day);
 * `normalisePhoto` (the stored bytes are always a JPEG the server encoded); the bytes go to the
 * store first, then the row is inserted; if the insert fails the stored object is removed.
 */
export async function saveUpload(
  ctx: Ctx,
  input: { kind: FileKind; date: ISODate; bytes: Uint8Array },
  deps: { store?: FileStore; now?: Date; today?: ISODate } = {},
): Promise<SaveUploadResult> {
  assertOwnContext(ctx);
  assertRole(ctx, ["rep", "supervisor"]);
  const now = deps.now ?? new Date();
  const today = deps.today ?? todayIn(ctx.timeZone, now);
  const day = dayNumber(input.date);
  const todayN = dayNumber(today);
  if (day === null || todayN === null || day > todayN || todayN - day > MAX_DAYS_BACK) return fail("bad_date");

  if (!(await reserve(ctx.db, `user:${ctx.userId}`, today, UPLOAD_COUNTER, UPLOADS_USER_DAY, ctx.companyId))) return fail("quota");

  const photo = await normalisePhoto(input.bytes);
  if (!photo.ok) return fail(photo.error);

  const id = randomBytes(16).toString("hex");
  const key = storageKey({ companyId: ctx.companyId, userId: ctx.userId, date: input.date, kind: input.kind, id });
  const store = deps.store ?? getFileStore();
  try {
    await store.put(key, photo.jpeg);
  } catch (e) {
    console.error("photo store failed", e instanceof Error ? e.name : "unknown error");
    return fail("storage_failed");
  }
  try {
    await ctx.db.insert(s.files).values({
      id,
      companyId: ctx.companyId,
      userId: ctx.userId,
      kind: input.kind,
      date: input.date,
      storageKey: key,
      bytes: photo.jpeg.byteLength,
      width: photo.width,
      height: photo.height,
      createdAt: now,
    });
  } catch (e) {
    console.error("photo record failed", e instanceof Error ? e.name : "unknown error");
    await store.remove(key).catch(() => undefined);
    return fail("storage_failed");
  }
  return { ok: true, id, width: photo.width, height: photo.height };
}

export type FileViewer = "owner" | "supervisor" | "admin";

/** Who may see a photo of a kind: return photos the rep, his supervisor and the admin; report photos the rep only. */
export function canView(kind: FileKind, viewer: FileViewer): boolean {
  return kind === "return" || viewer === "owner";
}

/**
 * The photo's bytes, or null. Every refusal is the same null: a malformed id (the store is never
 * touched), an id of another company, a soft-deleted photo, a caller who is neither the owner, nor
 * his supervisor, nor an admin of his company, a kind the viewer may not see, an owner role, and a
 * tagged (`actingFor`) context.
 *
 * For a well-formed id the one database lookup always runs, whoever asks, so a refusal takes the
 * same path whether or not the photo exists. The lookup joins the owner's user row, so the
 * supervisor check is the same rule as `repCtx` (the photo's owner is a rep of this company whose
 * supervisor is the caller) without a second query.
 */
export async function readFile(ctx: Ctx, id: string, deps: { store?: FileStore } = {}): Promise<{ bytes: Uint8Array } | null> {
  if (!isFileId(id)) return null;
  const [row] = await ctx.db
    .select({
      kind: s.files.kind,
      key: s.files.storageKey,
      ownerId: s.files.userId,
      ownerRole: s.users.role,
      ownerSupervisor: s.users.supervisorId,
    })
    .from(s.files)
    .innerJoin(s.users, and(eq(s.users.id, s.files.userId), eq(s.users.companyId, s.files.companyId)))
    .where(and(eq(s.files.id, id), eq(s.files.companyId, ctx.companyId), isNull(s.files.deletedAt)));
  if (!row || ctx.actingFor !== undefined) return null;

  let viewer: FileViewer | null = null;
  if (row.ownerId === ctx.userId && (ctx.role === "rep" || ctx.role === "supervisor")) viewer = "owner";
  else if (ctx.role === "supervisor" && row.ownerRole === "rep" && row.ownerSupervisor === ctx.userId) viewer = "supervisor";
  else if (ctx.role === "admin") viewer = "admin";
  if (viewer === null || !canView(row.kind, viewer)) return null;

  const bytes = await (deps.store ?? getFileStore()).get(row.key);
  return bytes ? { bytes } : null;
}

/** The owner removes his own photo, attached or not: it is soft-deleted now and swept later. */
export async function removeOwnFile(ctx: Ctx, id: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertOwnContext(ctx);
  if (!isFileId(id)) return { ok: false, error: "not_found" };
  const done = await ctx.db
    .update(s.files)
    .set({ deletedAt: sql`coalesce(${s.files.deletedAt}, now())` })
    .where(and(eq(s.files.id, id), eq(s.files.companyId, ctx.companyId), eq(s.files.userId, ctx.userId)))
    .returning({ id: s.files.id });
  return done.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

/** `YYYY-MM-DD` (UTC) of `days` before `now`. */
const utcDayBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

/**
 * Deletes at most `limit` photos that are soft-deleted, or unattached for more than 24 hours, or
 * past their kind's retention: the photo's date lies more than 30 (report) or 180 (return) days
 * before today (UTC), so on the 30th day after it the photo is still kept. An attached photo inside
 * its retention matches none of these and is never touched.
 *
 * Each picked row is first claimed (soft-deleted, under the same conditions, so a row that changed
 * since the pick is skipped and a claimed one can no longer be read or attached), then its stored
 * object is removed, then the row is deleted. A storage failure leaves the claimed row for the next
 * sweep. Returns the number of rows deleted (R28). System maintenance: across companies by design.
 */
export async function sweepFiles(db: Db, store: FileStore, now: Date, limit = SWEEP_LIMIT): Promise<number> {
  const due = or(
    sql`${s.files.deletedAt} is not null`,
    and(isNull(s.files.attachedAt), sql`${s.files.createdAt} < ${new Date(now.getTime() - UNATTACHED_HOURS * HOUR_MS).toISOString()}::timestamptz`),
    and(eq(s.files.kind, "report"), sql`${s.files.date} < ${utcDayBefore(now, FILE_RETENTION_DAYS.report)}::date`),
    and(eq(s.files.kind, "return"), sql`${s.files.date} < ${utcDayBefore(now, FILE_RETENTION_DAYS.return)}::date`),
  )!;
  const picked = await db.select({ id: s.files.id }).from(s.files).where(due).orderBy(s.files.createdAt).limit(limit);
  let deleted = 0;
  for (const { id } of picked) {
    const [claimed] = await db
      .update(s.files)
      .set({ deletedAt: sql`coalesce(${s.files.deletedAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(s.files.id, id), due))
      .returning({ key: s.files.storageKey });
    if (!claimed) continue;
    try {
      await store.remove(claimed.key);
    } catch (e) {
      console.error("photo sweep: remove failed", e instanceof Error ? e.name : "unknown error");
      continue;
    }
    const gone = await db.delete(s.files).where(eq(s.files.id, id)).returning({ id: s.files.id });
    deleted += gone.length;
  }
  return deleted;
}
