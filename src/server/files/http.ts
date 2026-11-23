import type { ISODate } from "@/domain/calendar";
import { PHOTO_MAX_BYTES } from "@/domain/files";
import type { Ctx } from "@/server/ctx";
import { checkPostHeaders, readCappedBody } from "@/server/http/guarded-post";
import { currentDay } from "@/server/today";
import { readFile, saveUpload, type SaveUploadError } from "./files";
import type { FileStore } from "./store";

/** The browser sends this header with every photo upload; a plain cross-site form post cannot. */
export const PHOTO_REQUESTED_WITH = "photo";
/** The photo limit plus room for the multipart framing and the other form fields. */
export const FILE_POST_MAX_BODY = PHOTO_MAX_BYTES + 65_536;
/** Least time between two photo sweeps started by this server instance (R70). */
export const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt: number | null = null;

/**
 * True when this instance may start a photo sweep now (and records that it did): at most one per
 * `SWEEP_INTERVAL_MS`. The route asks this only after a successful upload (R70).
 */
export function claimSweepSlot(nowMs: number): boolean {
  if (lastSweepAt !== null && nowMs - lastSweepAt < SWEEP_INTERVAL_MS) return false;
  lastSweepAt = nowMs;
  return true;
}

/** Seconds a client waits before retrying when the decoder is busy (R69). */
const BUSY_RETRY_AFTER_SECONDS = 5;

export type FilePostError = SaveUploadError | "unauthorized" | "forbidden" | "bad_request" | "bad_kind" | "no_file";
export type FilePostResponse = { id: string; width: number; height: number } | { error: FilePostError };

type Deps = { store?: FileStore; now?: Date; today?: ISODate };

const json = (status: number, body: FilePostResponse, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const STATUS: Record<SaveUploadError, number> = {
  too_large: 413,
  unsupported_type: 400,
  too_many_pixels: 400,
  corrupt: 400,
  bad_date: 400,
  quota: 429,
  busy: 503,
  storage_failed: 500,
};

/**
 * POST /app/files: a rep or supervisor stores one return photo (R51: report photos enter only
 * through the photo-reading flow). No session → 401; another role → 403; then the headers are
 * checked before any of the body is read, and the body is read with a hard cap. Replies
 * `{ id, width, height }` or `{ error }`, never cached. `busy` is a retryable 503 with Retry-After.
 */
export async function handleFilePost(request: Request, ctx: Ctx | null, deps: Deps = {}): Promise<Response> {
  if (!ctx) return json(401, { error: "unauthorized" });
  if ((ctx.role !== "rep" && ctx.role !== "supervisor") || ctx.actingFor !== undefined) return json(403, { error: "forbidden" });
  const bad = checkPostHeaders(request.headers, { requestedWith: PHOTO_REQUESTED_WITH, maxBody: FILE_POST_MAX_BODY, requestUrl: request.url });
  if (bad === "too_large") return json(413, { error: "too_large" });
  if (bad) return json(403, { error: "bad_request" });

  let form: FormData;
  try {
    const body = await readCappedBody(request, FILE_POST_MAX_BODY);
    if (body === null) return json(413, { error: "too_large" });
    form = await new Response(body as BodyInit, { headers: request.headers }).formData();
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (form.get("kind") !== "return") return json(400, { error: "bad_kind" });
  const date = form.get("date");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json(400, { error: "no_file" });
  if (typeof date !== "string") return json(400, { error: "bad_date" });
  if (file.size > PHOTO_MAX_BYTES) return json(413, { error: "too_large" });

  const today = deps.today ?? currentDay(ctx.timeZone);
  const r = await saveUpload(ctx, { kind: "return", date, bytes: new Uint8Array(await file.arrayBuffer()) }, { ...deps, today });
  if (r.ok) return json(200, { id: r.id, width: r.width, height: r.height });
  return json(STATUS[r.error], { error: r.error }, r.error === "busy" ? { "Retry-After": String(BUSY_RETRY_AFTER_SECONDS) } : {});
}

/** Headers of a served photo: an image only, never sniffed, framed, cached by a shared cache or sent as a referrer. */
const PHOTO_HEADERS = {
  "Content-Type": "image/jpeg",
  "Content-Disposition": 'inline; filename="photo.jpg"',
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
} as const;

/** The one answer for every refusal: no body, no type, nothing that tells the cases apart. */
const notFound = (): Response => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * GET /files/<id>: the photo for a caller `readFile` allows. A missing session, a refused viewer,
 * a deleted, unknown or malformed id all get the same empty 404.
 */
export async function handleFileGet(_request: Request, ctx: Ctx | null, id: string, deps: { store?: FileStore } = {}): Promise<Response> {
  if (!ctx) return notFound();
  const file = await readFile(ctx, id, deps);
  if (!file) return notFound();
  return new Response(file.bytes as BodyInit, { status: 200, headers: PHOTO_HEADERS });
}
