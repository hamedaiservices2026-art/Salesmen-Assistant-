import { AUDIO_MAX_BYTES, sniffAudio, TRANSCRIPT_MAX } from "@/domain/ai/audio";
import { AI_REQUESTED_WITH } from "@/domain/ai/draft";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { checkPostHeaders, readCappedBody } from "@/server/http/guarded-post";
import { aiCall, type AiCallFail } from "./call";
import type { RunDeps } from "./run";
import { getProviders } from "./providers";
import { readAiConfig, type AiConfig } from "./config";
import type { AiProvider } from "./types";

/** `audio_type`: providers exist but none takes this recording's type. `timeout`: too little time was left to start. */
export type TranscribeFail = { ok: false; reason: AiCallFail["reason"] | "too_large" | "unsupported_type" | "empty" | "audio_type" | "timeout" };
export type TranscribeOpts = {
  now?: Date;
  config?: AiConfig;
  /** Absolute time (`Date.now()` clock) by which the provider must have answered (R33). */
  deadlineAt?: number;
  /** Tests only (R27). */
  providers?: AiProvider[];
  /** Tests only. */
  deps?: Partial<RunDeps>;
};

/** A provider may return more than it was asked for; this much is looked at before the cut. */
const READ_MAX = TRANSCRIPT_MAX * 4;

/**
 * Speech to text for a rep's recording. In order: the size (bytes only; R55), the type from the
 * recording's own first bytes (`sniffAudio`; the client's file name and declared type are never
 * used), then one `aiCall` of kind `stt` in the rep's language, with the sniffed type declared to
 * the provider (R48). The text is trimmed and cut to `TRANSCRIPT_MAX`; an empty text is a
 * successful call reported `empty` and no fallback provider is tried for it (R32). The audio is
 * never written to storage or to a log, and the transcript goes only back to the caller.
 */
export async function transcribe(
  ctx: Ctx,
  input: { bytes: Uint8Array; feature: "close_voice" | "assistant_voice" },
  opts: TranscribeOpts = {},
): Promise<{ ok: true; transcript: string } | TranscribeFail> {
  assertOwnContext(ctx);
  assertRole(ctx, ["rep", "supervisor"]);
  const { bytes, feature } = input;
  if (bytes.byteLength > AUDIO_MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = sniffAudio(bytes.subarray(0, 16));
  if (mime === null) return { ok: false, reason: "unsupported_type" };

  const language = ctx.locale;
  const r = await aiCall(
    ctx,
    {
      kind: "stt",
      feature,
      audioMime: mime,
      call: (p, signal) => p.stt({ audio: bytes, mime, language }, signal),
      // Possibly "": never null for an empty text (null would be `invalid_output` and try the next provider).
      parse: (text) => (typeof text === "string" ? Array.from(text.slice(0, READ_MAX).trim()).slice(0, TRANSCRIPT_MAX).join("").trim() : null),
    },
    { now: opts.now, config: opts.config, providers: opts.providers, deps: opts.deps, deadlineAt: opts.deadlineAt },
  );
  if (!r.ok) {
    if (r.reason === "no_provider") {
      // Some provider exists for speech to text, so the cause is this recording's type.
      const config = opts.config ?? readAiConfig(process.env);
      if ((opts.providers ?? getProviders("stt", config)).some((p) => p.modelFor("stt") !== null)) return { ok: false, reason: "audio_type" };
    }
    return r;
  }
  if (r.value === "") return { ok: false, reason: "empty" };
  return { ok: true, transcript: r.value };
}

/** The recording limit plus room for the multipart framing. */
export const TRANSCRIBE_MAX_BODY = AUDIO_MAX_BYTES + 65_536;
/** Upload plus one speech-to-text call must fit the route's `maxDuration` of 60 s (R33). */
export const TRANSCRIBE_BUDGET_MS = 50_000;

export type TranscribeResponse =
  | { transcript: string }
  | { reason: TranscribeFail["reason"] | "unauthorized" | "forbidden" | "bad_request" | "no_audio" };

const STATUS: Record<TranscribeFail["reason"], number> = {
  disabled: 503,
  no_provider: 503,
  company_off: 403,
  no_notice: 403,
  rate_limited: 429,
  quota: 429,
  failed: 502,
  unreadable: 422,
  too_large: 413,
  unsupported_type: 400,
  empty: 422,
  audio_type: 400,
  timeout: 504,
};

const json = (status: number, body: TranscribeResponse): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /app/ai/transcribe (multipart `audio`): a rep or supervisor acting as himself gets
 * `{ transcript }` or `{ reason }`, never cached. The transcript is for the rep to read, edit and
 * send as a question; nothing here asks the assistant. No session → 401; another role or a `repCtx`
 * context → 403; then the headers (same origin, `X-Requested-With: ai`, a declared length within
 * the cap) before any of the body is read, and the body with a hard cap. Nothing of the audio, the
 * transcript or an error's text is logged. The route file only wraps this (R64).
 */
export async function handleTranscribePost(request: Request, ctx: Ctx | null, opts: TranscribeOpts = {}): Promise<Response> {
  try {
    return await handle(request, ctx, opts);
  } catch (e) {
    console.error("transcribe failed", e instanceof Error ? e.name : "unknown error");
    return json(500, { reason: "failed" });
  }
}

async function handle(request: Request, ctx: Ctx | null, opts: TranscribeOpts): Promise<Response> {
  const deadlineAt = opts.deadlineAt ?? Date.now() + TRANSCRIBE_BUDGET_MS;
  if (!ctx) return json(401, { reason: "unauthorized" });
  if ((ctx.role !== "rep" && ctx.role !== "supervisor") || ctx.actingFor !== undefined) return json(403, { reason: "forbidden" });
  const bad = checkPostHeaders(request.headers, { requestedWith: AI_REQUESTED_WITH, maxBody: TRANSCRIBE_MAX_BODY, requestUrl: request.url });
  if (bad === "too_large") return json(413, { reason: "too_large" });
  if (bad) return json(403, { reason: "bad_request" });

  let form: FormData;
  try {
    const body = await readCappedBody(request, TRANSCRIBE_MAX_BODY);
    if (body === null) return json(413, { reason: "too_large" });
    form = await new Response(body as BodyInit, { headers: request.headers }).formData();
  } catch {
    return json(400, { reason: "bad_request" });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return json(400, { reason: "no_audio" });
  if (audio.size > AUDIO_MAX_BYTES) return json(413, { reason: "too_large" });

  const r = await transcribe(ctx, { bytes: new Uint8Array(await audio.arrayBuffer()), feature: "assistant_voice" }, { ...opts, deadlineAt });
  if (r.ok) return json(200, { transcript: r.transcript });
  return json(STATUS[r.reason], { reason: r.reason });
}
