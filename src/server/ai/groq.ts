import type { AiConfig, AiKind } from "./config";
import { postForm } from "./http";
import { AiError, type AiProvider, type AudioMime, type SttRequest, type TextResult } from "./types";

// Request shape UNVERIFIED (docs/ai-providers.md); every id, path and constant is in this block.
const BASE = "https://api.groq.com";
const TRANSCRIPTIONS_PATH = "/openai/v1/audio/transcriptions";
const AUTH_HEADER = "authorization";
const AUTH_PREFIX = "Bearer ";
const RESPONSE_FORMAT = "json";
const FILE_NAME: Record<AudioMime, string> = { "audio/mp4": "audio.m4a", "audio/webm": "audio.webm", "audio/ogg": "audio.ogg" };
const ACCEPTED_AUDIO: ReadonlySet<AudioMime> = new Set<AudioMime>(["audio/mp4", "audio/webm", "audio/ogg"]);

export function groqProvider(cfg: AiConfig["groq"], fetchImpl: typeof fetch = fetch): AiProvider {
  const refuse = (): Promise<never> => Promise.reject(new AiError("bad_request", "groq"));
  return {
    name: "groq",
    modelFor: (kind: AiKind) => (kind === "stt" && cfg.key !== null ? cfg.sttModel : null),
    acceptsAudio: (mime) => ACCEPTED_AUDIO.has(mime),
    vision: refuse,
    chat: refuse,
    async stt(req: SttRequest, signal): Promise<TextResult> {
      if (cfg.key === null || !ACCEPTED_AUDIO.has(req.mime)) return await refuse();
      const form = new FormData();
      form.set("file", new Blob([req.audio as Uint8Array<ArrayBuffer>], { type: req.mime }), FILE_NAME[req.mime]);
      form.set("model", cfg.sttModel);
      form.set("language", req.language);
      form.set("response_format", RESPONSE_FORMAT);
      form.set("temperature", "0");
      const json = (await postForm(
        `${BASE}${TRANSCRIPTIONS_PATH}`,
        { [AUTH_HEADER]: `${AUTH_PREFIX}${cfg.key.reveal()}` },
        form,
        signal,
        "groq",
        fetchImpl,
      )) as { text?: unknown } | null;
      if (typeof json?.text !== "string") throw new AiError("invalid_output", "groq");
      // An empty or blank transcript is a successful (empty) reading, not an invalid reply (R32).
      return { text: json.text.trim() === "" ? "" : json.text, usage: { tokensIn: null, tokensOut: null } };
    },
  };
}
