import type { Locale } from "@/i18n/config";
import type { AiKind, ProviderName } from "./config";

export type { AiKind, ProviderName };

export type AudioMime = "audio/mp4" | "audio/webm" | "audio/ogg";
export type AiErrorCode = "timeout" | "rate_limited" | "provider_error" | "bad_request" | "invalid_output";

/**
 * The only error a provider adapter throws. Its message is always `${provider}:${code}`: nothing
 * from the provider's response (body, headers, status text) is ever kept on it.
 */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly provider: ProviderName,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider}:${code}`);
    this.name = "AiError";
  }
}

export type Usage = { tokensIn: number | null; tokensOut: number | null };
export type TextResult = { text: string; usage: Usage };
/** `image` is always a JPEG the server encoded. */
export type VisionRequest = { image: Uint8Array; system: string; prompt: string; maxOutputTokens: number };
export type SttRequest = { audio: Uint8Array; mime: AudioMime; language: Locale };
export type ChatRequest = {
  system: string;
  messages: { role: "user" | "assistant"; text: string }[];
  maxOutputTokens: number;
};

export interface AiProvider {
  readonly name: ProviderName;
  /** null: this provider does not do that job. */
  modelFor(kind: AiKind): string | null;
  /** From docs/ai-providers.md (R48). */
  acceptsAudio(mime: AudioMime): boolean;
  vision(req: VisionRequest, signal: AbortSignal): Promise<TextResult>;
  stt(req: SttRequest, signal: AbortSignal): Promise<TextResult>;
  chat(req: ChatRequest, signal: AbortSignal): Promise<TextResult>;
}
