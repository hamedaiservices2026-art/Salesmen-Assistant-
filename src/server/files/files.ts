import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { todayIn, type ISODate } from "@/domain/calendar";
import { isFileId, storageKey, type FileKind } from "@/domain/files";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { UPLOADS_USER_DAY } from "@/server/ai/limits";
import { release, reserve } from "@/server/ai/quota";
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
/** After this many failed removals the sweep leaves a row alone (it is logged, never retried forever; R70). */
export const SWEEP_MAX_ATTEMPTS = 5;
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
 * role; the date (a real date, not after today, at most `min(62, retention of the kind)` days back,
 * so a photo is never due for deletion at birth; R70); one slot of the daily upload counter (spent
 * even when the photo is then refused, so decoding work is bounded per rep per day, but given back
 * on `busy` and `storage_failed`, which are not the rep's doing); `normalisePhoto` (the stored bytes
 * are always a JPEG the server encoded); the row is inserted first (unattached, its storage key
 * reserved), then the object is written; if the write fails the row is deleted (best effort,
 * otherwise the 24-hour sweep removes it). So every stored object always has a row (R70).
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
  const maxBack = Math.min(MAX_DAYS_BACK, FILE_RETENTION_DAYS[input.kind] ?? 0);
  if (day === null || todayN === null || day > todayN || todayN - day > maxBack) return fail("bad_date");

  const scope = `user:${ctx.userId}`;
  if (!(await reserve(ctx.db, scope, today, UPLOAD_COUNTER, UPLOADS_USER_DAY, ctx.companyId))) return fail("quota");
  const giveBack = (error: SaveUploadError) => release(ctx.db, scope, today, UPLOAD_COUNTER).then(() => fail(error), () => fail(error));

  const photo = await normalisePhoto(input.bytes);
  if (!photo.ok) return photo.error === "busy" ? giveBack("busy") : fail(photo.error);

  const id = randomBytes(16).toString("hex");
  const key = storageKey({ companyId: ctx.companyId, userId: ctx.userId, date: input.date, kind: input.kind, id });
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
    return giveBack("storage_failed");
  }
  try {
    await (deps.store ?? getFileStore()).put(key, photo.jpeg);
  } catch (e) {
    console.error("photo store failed", e instanceof Error ? e.name : "unknown error");
    await ctx.db
      .delete(s.files)
      .where(and(eq(s.files.id, id), eq(s.files.companyId, ctx.companyId)))
      .catch(() => undefined);
    return giveBack("storage_failed");
  }
  return { ok: true, id, width: photo.width, height: photo.height };
}

/** `YYYY-MM-DD` (UTC) of `days` before `now`. */
const utcDayBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);

/**
 * True for a photo still inside its kind's retention at `now`: its date is no earlier than 30
 * (report) or 180 (return) days before today (UTC). On the 30th day after its date a report photo
 * is still kept; on the 31st it is not.
 */
export function inRetention(now: Date): SQL {
  return or(
    and(eq(s.files.kind, "report"), sql`${s.files.date} >= ${utcDayBefore(now, FILE_RETENTION_DAYS.report)}::date`),
    and(eq(s.files.kind, "return"), sql`${s.files.date} >= ${utcDayBefore(now, FILE_RETENTION_DAYS.return)}::date`),
  )!;
}

export type FileViewer = "owner" | "supervisor" | "admin";

/** Who may see a photo of a kind: return photos the rep, his supervisor and the admin; report photos the rep only. */
export function canView(kind: FileKind, viewer: FileViewer): boolean {
  return kind === "return" || viewer === "owner";
}

/**
 * The photo's bytes, or null. Every refusal is the same null: a malformed id (the store is never
 * touched), an id of another company, a soft-deleted photo, a photo past its retention (even
 * before the sweep has removed it; R70), a caller who is neither the owner, nor
 * his supervisor, nor an admin of his company, a kind the viewer may not see, an owner role, and a
 * tagged (`actingFor`) context.
 *
 * For a well-formed id the one database lookup always runs, whoever asks, so a refusal takes the
 * same path whether or not the photo exists. The lookup joins the owner's user row, so the
 * supervisor check is the same rule as `repCtx` (the photo's owner is a rep of this company whose
 * supervisor is the caller) without a second query.
 */
export async function readFile(
  ctx: Ctx,
  id: string,
  deps: { store?: FileStore; now?: Date } = {},
): Promise<{ bytes: Uint8Array } | null> {
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
    .where(and(eq(s.files.id, id), eq(s.files.companyId, ctx.companyId), isNull(s.files.deletedAt), inRetention(deps.now ?? new Date())));
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

export type AttachItem = { id: string; kind: FileKind; returnPos: number | null };

/**
 * Attaches the caller's photos to his close `closeId`, inside the caller's transaction `tx`. Each
 * photo is one UPDATE that matches only a row of the caller's company and user, of the stated kind,
 * not deleted, inside its retention, and unattached or already on this close; it sets `close_id`,
 * `return_pos` and `attached_at`. A photo whose UPDATE matched no row (expired, removed by the
 * sweep, another rep's, attached elsewhere, unknown or malformed) is returned in `missing`, so the
 * caller can tell the rep to add it again; nothing is ever dropped silently (R70). Shared by the
 * day close (return photos, Task 8) and the photo draft receipt (report photo, Task 11).
 */
export async function attachFiles(tx: Db, ctx: Ctx, closeId: string, items: readonly AttachItem[], now: Date): Promise<{ missing: string[] }> {
  assertOwnContext(ctx);
  const missing: string[] = [];
  for (const item of items) {
    if (!isFileId(item.id)) {
      missing.push(item.id);
      continue;
    }
    const done = await tx
      .update(s.files)
      .set({ closeId, returnPos: item.returnPos, attachedAt: now })
      .where(
        and(
          eq(s.files.id, item.id),
          eq(s.files.companyId, ctx.companyId),
          eq(s.files.userId, ctx.userId),
          eq(s.files.kind, item.kind),
          isNull(s.files.deletedAt),
          or(isNull(s.files.closeId), eq(s.files.closeId, closeId)),
          inRetention(now),
        ),
      )
      .returning({ id: s.files.id });
    if (done.length !== 1) missing.push(item.id);
  }
  return { missing };
}

/**
 * Deletes at most `limit` photos that are soft-deleted, or unattached for more than 24 hours, or
 * past their kind's retention (see `inRetention`). An attached photo inside its retention matches
 * none of these and is never touched.
 *
 * Each photo is handled in its own transaction: the row is picked and locked with
 * `FOR UPDATE SKIP LOCKED` (soft-deleted rows first, then the oldest), so two sweeps at once never
 * take the same row and a concurrent attach either waits for the delete (and then finds nothing,
 * which it reports) or keeps the row out of this sweep. The stored object is removed, then the row
 * is deleted. When the removal fails the row is soft-deleted (so it can no longer be read or
 * attached) and its `sweep_attempts` goes up; after 5 failures the sweep leaves it alone, and a row
 * that failed in this run is not picked again in the same run, so a failing row never starves the
 * others. Returns the number of rows deleted (R28). System maintenance: across companies by design.
 */
export async function sweepFiles(db: Db, store: FileStore, now: Date, limit = SWEEP_LIMIT): Promise<number> {
  const due = and(
    lt(s.files.sweepAttempts, SWEEP_MAX_ATTEMPTS),
    or(
      sql`${s.files.deletedAt} is not null`,
      and(isNull(s.files.attachedAt), sql`${s.files.createdAt} < ${new Date(now.getTime() - UNATTACHED_HOURS * HOUR_MS).toISOString()}::timestamptz`),
      sql`not (${inRetention(now)})`,
    ),
  )!;
  const tried: string[] = [];
  let deleted = 0;
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: s.files.id, key: s.files.storageKey })
        .from(s.files)
        .where(tried.length > 0 ? and(due, notInArray(s.files.id, tried)) : due)
        .orderBy(sql`(${s.files.deletedAt} is null)`, s.files.createdAt, s.files.id)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return "none" as const;
      tried.push(row.id);
      try {
        await store.remove(row.key);
      } catch (e) {
        console.error("photo sweep: remove failed", e instanceof Error ? e.name : "unknown error");
        await tx
          .update(s.files)
          .set({ sweepAttempts: sql`${s.files.sweepAttempts} + 1`, deletedAt: sql`coalesce(${s.files.deletedAt}, ${now.toISOString()}::timestamptz)` })
          .where(eq(s.files.id, row.id));
        return "failed" as const;
      }
      const gone = await tx.delete(s.files).where(eq(s.files.id, row.id)).returning({ id: s.files.id });
      return gone.length > 0 ? ("deleted" as const) : ("failed" as const);
    });
    if (outcome === "none") break;
    if (outcome === "deleted") deleted += 1;
  }
  return deleted;
}
