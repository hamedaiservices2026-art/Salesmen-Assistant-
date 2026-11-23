import type { AiConfig, AiKind } from "./config";
import { postJson } from "./http";
import { asCount, toBase64 } from "./models";
import { AiError, type AiProvider, type ChatRequest, type TextResult, type VisionRequest } from "./types";

// Request shape UNVERIFIED (docs/ai-providers.md); every constant is in this block. The model ids
// are configuration (null until an operator picks a free model).
// Deliberately NOT sent: `response_format` (free models may not support it; the reply is parsed
// strictly anyway) and `provider.data_collection` (UNVERIFIED how it interacts with free models;
// set the data policy on the account instead, see docs/ai-providers.md).
const BASE = "https://openrouter.ai";
const CHAT_PATH = "/api/v1/chat/completions";
const AUTH_HEADER = "authorization";
const AUTH_PREFIX = "Bearer ";
const IMAGE_URL_PREFIX = "data:image/jpeg;base64,";
const TEMPERATURE = { vision: 0, chat: 0.2 } as const;

type Message = { role: "system" | "user" | "assistant"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] };

function textOf(json: unknown): TextResult {
  const root = json as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  } | null;
  const content = root?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content === "") throw new AiError("invalid_output", "openrouter");
  return { text: content, usage: { tokensIn: asCount(root?.usage?.prompt_tokens), tokensOut: asCount(root?.usage?.completion_tokens) } };
}

export function openrouterProvider(cfg: AiConfig["openrouter"], fetchImpl: typeof fetch = fetch): AiProvider {
  const modelOf = (kind: AiKind): string | null =>
    cfg.key === null ? null : kind === "vision" ? cfg.visionModel : kind === "chat" ? cfg.chatModel : null;

  async function complete(kind: "vision" | "chat", messages: Message[], maxTokens: number, signal: AbortSignal): Promise<TextResult> {
    const model = modelOf(kind);
    if (model === null || cfg.key === null) throw new AiError("bad_request", "openrouter");
    // No `tools`, no `tool_choice`: the model cannot call anything.
    const body = { model, messages, max_tokens: maxTokens, temperature: TEMPERATURE[kind] };
    const json = await postJson(
      `${BASE}${CHAT_PATH}`,
      { [AUTH_HEADER]: `${AUTH_PREFIX}${cfg.key.reveal()}` },
      body,
      signal,
      "openrouter",
      fetchImpl,
    );
    return textOf(json);
  }

  return {
    name: "openrouter",
    modelFor: modelOf,
    acceptsAudio: () => false,
    vision(req: VisionRequest, signal) {
      return complete(
        "vision",
        [
          { role: "system", content: req.system },
          {
            role: "user",
            content: [
              { type: "text", text: req.prompt },
              { type: "image_url", image_url: { url: `${IMAGE_URL_PREFIX}${toBase64(req.image)}` } },
            ],
          },
        ],
        req.maxOutputTokens,
        signal,
      );
    },
    stt() {
      return Promise.reject(new AiError("bad_request", "openrouter"));
    },
    chat(req: ChatRequest, signal) {
      return complete(
        "chat",
        [{ role: "system", content: req.system }, ...req.messages.map((m): Message => ({ role: m.role, content: m.text }))],
        req.maxOutputTokens,
        signal,
      );
    },
  };
}
