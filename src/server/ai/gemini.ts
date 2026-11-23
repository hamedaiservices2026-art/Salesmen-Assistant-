import type { Locale } from "@/i18n/config";
import type { AiConfig, AiKind } from "./config";
import { postJson } from "./http";
import { asCount, pathModel, toBase64 } from "./models";
import {
  AiError,
  type AiProvider,
  type AudioMime,
  type ChatRequest,
  type SttRequest,
  type TextResult,
  type VisionRequest,
} from "./types";

// Everything the owner's smoke run may need to correct lives in this block (docs/ai-providers.md
// marks the request shape UNVERIFIED). Provider model ids are configuration in config.ts.
const BASE = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const GENERATE_SUFFIX = ":generateContent";
const KEY_HEADER = "x-goog-api-key";
const JSON_MIME = "application/json";
const IMAGE_MIME = "image/jpeg";
/** Audio types the audio page lists (R48); `audio/mp4` is not among them. */
const ACCEPTED_AUDIO: ReadonlySet<AudioMime> = new Set<AudioMime>(["audio/webm", "audio/ogg"]);
const LANGUAGE_NAME: Record<Locale, string> = { ar: "Arabic", en: "English", ur: "Urdu" };
const TEMPERATURE = { vision: 0, stt: 0, chat: 0.2 } as const;

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Content = { role: "user" | "model"; parts: Part[] };

function textOf(json: unknown, provider: "gemini"): TextResult {
  const root = json as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  } | null;
  const parts = root?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
  if (text === "") throw new AiError("invalid_output", provider);
  return { text, usage: { tokensIn: asCount(root?.usageMetadata?.promptTokenCount), tokensOut: asCount(root?.usageMetadata?.candidatesTokenCount) } };
}

export function geminiProvider(cfg: AiConfig["gemini"], fetchImpl: typeof fetch = fetch): AiProvider {
  const modelOf = (kind: AiKind): string | null =>
    cfg.key === null ? null : kind === "vision" ? cfg.visionModel : kind === "chat" ? cfg.chatModel : cfg.audioModel;

  async function generate(
    kind: AiKind,
    system: string | null,
    contents: Content[],
    generationConfig: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<TextResult> {
    const model = modelOf(kind);
    if (model === null || cfg.key === null) throw new AiError("bad_request", "gemini");
    const url = `${BASE}/${API_VERSION}/models/${pathModel(model, "gemini")}${GENERATE_SUFFIX}`;
    const body: Record<string, unknown> = { contents, generationConfig };
    if (system !== null) body.systemInstruction = { parts: [{ text: system }] };
    // The key is revealed here, once, to build the header; it is never in the URL or the body.
    const json = await postJson(url, { [KEY_HEADER]: cfg.key.reveal() }, body, signal, "gemini", fetchImpl);
    return textOf(json, "gemini");
  }

  return {
    name: "gemini",
    modelFor: modelOf,
    acceptsAudio: (mime) => ACCEPTED_AUDIO.has(mime),
    vision(req: VisionRequest, signal) {
      return generate(
        "vision",
        req.system,
        [{ role: "user", parts: [{ inlineData: { mimeType: IMAGE_MIME, data: toBase64(req.image) } }, { text: req.prompt }] }],
        { temperature: TEMPERATURE.vision, maxOutputTokens: req.maxOutputTokens, responseMimeType: JSON_MIME },
        signal,
      );
    },
    async stt(req: SttRequest, signal) {
      if (!ACCEPTED_AUDIO.has(req.mime)) throw new AiError("bad_request", "gemini");
      return generate(
        "stt",
        null,
        [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: req.mime, data: toBase64(req.audio) } },
              { text: `Transcribe this recording verbatim in ${LANGUAGE_NAME[req.language]}. Reply with the transcript only.` },
            ],
          },
        ],
        { temperature: TEMPERATURE.stt, maxOutputTokens: 2048 },
        signal,
      );
    },
    chat(req: ChatRequest, signal) {
      return generate(
        "chat",
        req.system,
        req.messages.map((m): Content => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
        { temperature: TEMPERATURE.chat, maxOutputTokens: req.maxOutputTokens, responseMimeType: JSON_MIME },
        signal,
      );
    },
  };
}
