import type { ISODate } from "@/domain/calendar";
import { AI_REQUESTED_WITH, type CloseDraft, type DraftLine } from "@/domain/ai/draft";
import { toDraft } from "@/domain/ai/extraction";
import { PHOTO_MAX_BYTES } from "@/domain/files";
import { isDailyLine } from "@/domain/lines";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { removeOwnFile, saveUpload } from "@/server/files/files";
import type { FileStore } from "@/server/files/store";
import { takeUploadSlot, UPLOAD_BUSY_RETRY_AFTER_SECONDS } from "@/server/files/in-flight";
import { checkPostHeaders, readCappedBody } from "@/server/http/guarded-post";
import { closeDateError } from "@/server/repos/closes";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { aiAvailability } from "./availability";
import { aiCall, logRejection, type AiCallFail } from "./call";
import { peekAi, peekUpload } from "./quota";
import { readAiConfig, type AiConfig } from "./config";
import { createDraftReceipt } from "./drafts";
import { loadVocabulary } from "./field-map";
import { parseJsonReply } from "./json";
import { extractionPrompt } from "./prompts/extract";
import type { RunDeps } from "./run";
import type { AiProvider } from "./types";

/** The photo limit plus room for the multipart framing and the date field (as `/app/files`). */
export const CLOSE_PHOTO_MAX_BODY = PHOTO_MAX_BYTES + 65_536;
/**
 * The whole request must finish inside the route's `maxDuration` (60 s; R33). The provider gets
 * what is left of this budget after the body, the decode and the storage write.
 */
export const CLOSE_PHOTO_BUDGET_MS = 50_000;
/** Below this much time left, no provider is called (the photo is refused as `failed`). */
const MIN_PROVIDER_MS = 5_000;
const MAX_OUTPUT_TOKENS = 1_500;

export type ClosePhotoFail = {
  ok: false;
  reason:
    | AiCallFail["reason"]
    | "bad_date"
    | "not_selling_day"
    | "too_large"
    | "unsupported_type"
    | "too_many_pixels"
    | "corrupt"
    | "busy"
    | "storage_failed";
};
export type ClosePhotoResult = { ok: true; draft: CloseDraft; draftId: string; fileId: string; fallback: boolean } | ClosePhotoFail;

export type ClosePhotoOpts = {
  today?: ISODate;
  now?: Date;
  store?: FileStore;
  config?: AiConfig;
  /** Tests only (R27). */
  providers?: AiProvider[];
  /** Tests only. */
  deps?: Partial<RunDeps>;
  /** Absolute time (`Date.now()` clock) by which the provider must have answered (R33). */
  deadlineAt?: number;
};

const fail = (reason: ClosePhotoFail["reason"]): ClosePhotoFail => ({ ok: false, reason });

/** The company's daily lines in use, as a draft knows them. */
export async function draftLines(ctx: Ctx): Promise<DraftLine[]> {
  return (await loadLines(ctx)).filter(isDailyLine).map((l) => ({ lineId: l.lineId, code: l.code, unit: l.unit, kind: l.kind }));
}

/**
 * Reads the rep's day-end report photo into a close draft for `date`. In order: his own context;
 * the date is a real selling day of his company and not in the future (the checks of `saveClose`);
 * `aiAvailability` (so nothing is stored when AI is off or the notice is not accepted); the photo
 * is stored as a `report` file (`saveUpload` checks, decodes and re-encodes it: the provider is
 * shown only that JPEG); one `aiCall` of kind vision whose reply must pass `toDraft`; then a
 * receipt without values. A request the AI counters would refuse is refused before the upload (a
 * read-only peek, as `ask` does; final review A-L4), so it costs no upload slot, decode or storage;
 * a refusal that races past the peek, and every other failure after the upload, soft-deletes the
 * photo (R54). No close is written: the draft goes back
 * to the rep's screen, and only his confirm saves a close.
 */
export async function draftFromPhoto(ctx: Ctx, input: { date: ISODate; bytes: Uint8Array }, opts: ClosePhotoOpts = {}): Promise<ClosePhotoResult> {
  assertOwnContext(ctx);
  assertRole(ctx, ["rep", "supervisor"]);
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? (opts.deadlineAt as number) : Date.now() + CLOSE_PHOTO_BUDGET_MS;
  const now = opts.now ?? new Date();
  const today = opts.today ?? currentDay(ctx.timeZone);
  const config = opts.config ?? readAiConfig(process.env);

  const dateError = await closeDateError(ctx, input.date, today);
  if (dateError === "not_selling_day") return fail("not_selling_day");
  if (dateError) return fail("bad_date");

  const available = await aiAvailability(ctx, "vision", config, opts.providers);
  if (!available.ok) return fail(available.reason);
  const peek = await peekAi(ctx, "vision", now, { day: config.globalDay.vision, minute: config.globalMinute.vision });
  if (peek === "rate_limited") return fail("rate_limited");
  if (peek !== "ok") {
    await logRejection(ctx, "vision", "close_photo", null, peek, now);
    return fail("quota");
  }

  const upload = await saveUpload(ctx, { kind: "report", date: input.date, bytes: input.bytes }, { store: opts.store, now, today });
  if (!upload.ok) return fail(upload.error);
  const fileId = upload.id;
  const discard = async (reason: ClosePhotoFail["reason"]): Promise<ClosePhotoFail> => {
    await removeOwnFile(ctx, fileId).catch(() => undefined);
    return fail(reason);
  };

  try {
    if (deadlineAt - Date.now() < MIN_PROVIDER_MS) return await discard("failed");
    const [lines, vocab] = await Promise.all([draftLines(ctx), loadVocabulary(ctx)]);
    const { system, prompt } = extractionPrompt(vocab, "photo");
    const image = upload.jpeg;
    const r = await aiCall(
      ctx,
      {
        kind: "vision",
        feature: "close_photo",
        call: (p, signal) => p.vision({ image, system, prompt, maxOutputTokens: MAX_OUTPUT_TOKENS }, signal),
        // A draft with no usable field is not an answer: `invalid_output`, so the next provider
        // is tried and the usage row does not record a success (R74).
        parse: (text) => {
          const draft = toDraft(parseJsonReply(text), { source: "photo", date: input.date, lines });
          return draft !== null && Object.keys(draft.fields).length > 0 ? draft : null;
        },
      },
      { now, config, providers: opts.providers, deps: opts.deps, deadlineAt },
    );
    if (!r.ok) return await discard(r.reason);

    const draftId = await createDraftReceipt(ctx, { date: input.date, source: "photo", fileId }, now);
    return { ok: true, draft: r.value, draftId, fileId, fallback: r.fallback };
  } catch (e) {
    await removeOwnFile(ctx, fileId).catch(() => undefined);
    throw e;
  }
}

export type ClosePhotoResponse = { draft: CloseDraft; draftId: string } | { reason: ClosePhotoFail["reason"] | "unauthorized" | "forbidden" | "bad_request" | "no_file" };

const STATUS: Record<ClosePhotoFail["reason"], number> = {
  disabled: 503,
  no_provider: 503,
  company_off: 403,
  no_notice: 403,
  rate_limited: 429,
  quota: 429,
  failed: 502,
  unreadable: 422,
  bad_date: 400,
  not_selling_day: 400,
  too_large: 413,
  unsupported_type: 400,
  too_many_pixels: 400,
  corrupt: 400,
  busy: 503,
  storage_failed: 500,
};
const BUSY_RETRY_AFTER_SECONDS = 5;

const json = (status: number, body: ClosePhotoResponse, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * POST /app/ai/close-photo (multipart `date`, `file`): a rep or supervisor acting as himself gets
 * `{ draft, draftId }` or `{ reason }`, never cached. No session → 401; another role or a `repCtx`
 * context → 403; then the headers (same origin, `X-Requested-With: ai`, a declared length within the
 * cap) before any of the body is read, and the body with a hard cap. The time spent here counts
 * against the provider's deadline (R33). The route file only wraps this (R64).
 */
export async function handleClosePhotoPost(request: Request, ctx: Ctx | null, deps: ClosePhotoOpts = {}): Promise<Response> {
  try {
    return await handle(request, ctx, deps);
  } catch (e) {
    // Nothing of the error reaches the reply or the log beyond its class name.
    console.error("close photo failed", e instanceof Error ? e.name : "unknown error");
    return json(500, { reason: "failed" });
  }
}

async function handle(request: Request, ctx: Ctx | null, deps: ClosePhotoOpts): Promise<Response> {
  const deadlineAt = deps.deadlineAt ?? Date.now() + CLOSE_PHOTO_BUDGET_MS;
  if (!ctx) return json(401, { reason: "unauthorized" });
  if ((ctx.role !== "rep" && ctx.role !== "supervisor") || ctx.actingFor !== undefined) return json(403, { reason: "forbidden" });
  const bad = checkPostHeaders(request.headers, { requestedWith: AI_REQUESTED_WITH, maxBody: CLOSE_PHOTO_MAX_BODY, requestUrl: request.url });
  if (bad === "too_large") return json(413, { reason: "too_large" });
  if (bad) return json(403, { reason: "bad_request" });
  // Before the body (final review A-L3): two uploads of one rep in flight at most, and a rep at his
  // daily upload limit is refused with a read-only peek.
  const giveBack = takeUploadSlot(ctx);
  if (!giveBack) return json(429, { reason: "busy" }, { "Retry-After": String(UPLOAD_BUSY_RETRY_AFTER_SECONDS) });
  try {
    if (!(await peekUpload(ctx, deps.today ?? currentDay(ctx.timeZone)))) return json(429, { reason: "quota" });

    let date: FormDataEntryValue | null;
    let file: FormDataEntryValue | null;
    try {
      const body = await readCappedBody(request, CLOSE_PHOTO_MAX_BODY);
      if (body === null) return json(413, { reason: "too_large" });
      const form = await new Response(body as BodyInit, { headers: request.headers }).formData();
      date = form.get("date");
      file = form.get("file");
    } catch {
      return json(400, { reason: "bad_request" });
    }
    if (!(file instanceof File) || file.size === 0) return json(400, { reason: "no_file" });
    if (typeof date !== "string") return json(400, { reason: "bad_date" });
    if (file.size > PHOTO_MAX_BYTES) return json(413, { reason: "too_large" });

    const r = await draftFromPhoto(ctx, { date, bytes: new Uint8Array(await file.arrayBuffer()) }, { ...deps, deadlineAt });
    if (r.ok) return json(200, { draft: r.draft, draftId: r.draftId });
    return json(STATUS[r.reason], { reason: r.reason }, r.reason === "busy" ? { "Retry-After": String(BUSY_RETRY_AFTER_SECONDS) } : {});
  } finally {
    giveBack();
  }
}
