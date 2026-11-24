import { AUDIO_MAX_BYTES, sniffAudio, TRANSCRIPT_MAX } from "@/domain/ai/audio";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
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
