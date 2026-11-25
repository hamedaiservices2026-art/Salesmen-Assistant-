import { Secret } from "./secret";

export type AiKind = "vision" | "stt" | "chat";
export type ProviderName = "gemini" | "groq" | "openrouter" | "fake";

export type AiConfig = {
  mode: "live" | "fake" | "off";
  gemini: { key: Secret | null; visionModel: string; chatModel: string; audioModel: string; thinking: string };
  groq: { key: Secret | null; sttModel: string };
  openrouter: { key: Secret | null; visionModel: string | null; chatModel: string | null };
  globalDay: Record<AiKind, number>;
  globalMinute: Record<AiKind, number | null>;
  /** Characters of context the assistant may send in one request (`AI_CONTEXT_MAX`, 5 000–60 000; R81). */
  contextMax: number;
};

type Env = Record<string, string | undefined>;

// Defaults follow docs/ai-providers.md ("Differences from the design"). The design's
// `gemini-4-hydrogen` was not found in the providers' current documentation.
// Provider model ids are configuration, not coding-agent identifiers (R46).
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3";

const DEFAULT_GLOBAL_DAY: Record<AiKind, number> = { vision: 400, stt: 600, chat: 800 };

/** The plan's context limit; an operator may lower it for a provider with a small tokens-per-minute limit. */
export const CONTEXT_MAX_DEFAULT = 60_000;
const CONTEXT_MAX_MIN = 5_000;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

function modelId(raw: string | undefined, fallback: string): string;
function modelId(raw: string | undefined, fallback: null): string | null;
function modelId(raw: string | undefined, fallback: string | null): string | null {
  if (raw !== undefined && MODEL_ID.test(raw) && !raw.includes("..")) return raw;
  return fallback;
}

function intIn(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** `AI_GEMINI_THINKING`: "off" | "low" | "default" | a whole token budget; anything else is "off". */
function thinking(raw: string | undefined): string {
  return raw !== undefined && /^(off|low|default|\d{1,6})$/.test(raw) ? raw : "off";
}

function key(raw: string | undefined): Secret | null {
  return raw ? new Secret(raw) : null;
}

export function readAiConfig(env: Env): AiConfig {
  let mode: AiConfig["mode"] = "live";
  if (env.AI_DISABLED === "1") mode = "off";
  else if (env.AI_PROVIDER === "fake") {
    mode = env.NODE_ENV === "production" && env.ALLOW_AI_FAKE !== "1" ? "off" : "fake";
  }

  const kinds: [AiKind, string][] = [
    ["vision", "VISION"],
    ["stt", "STT"],
    ["chat", "CHAT"],
  ];
  const globalDay = { ...DEFAULT_GLOBAL_DAY };
  // No verified per-minute limit yet (UNVERIFIED in docs/ai-providers.md): no deployment-wide
  // minute counter unless the operator sets one (R65).
  const globalMinute: Record<AiKind, number | null> = { vision: null, stt: null, chat: null };
  for (const [kind, suffix] of kinds) {
    globalDay[kind] = intIn(env[`AI_GLOBAL_DAY_${suffix}`], 0, 100_000) ?? globalDay[kind];
    globalMinute[kind] = intIn(env[`AI_GLOBAL_MINUTE_${suffix}`], 1, 100_000);
  }

  return {
    mode,
    gemini: {
      key: key(env.GEMINI_API_KEY),
      visionModel: modelId(env.AI_GEMINI_VISION_MODEL, DEFAULT_GEMINI_MODEL),
      chatModel: modelId(env.AI_GEMINI_CHAT_MODEL, DEFAULT_GEMINI_MODEL),
      audioModel: modelId(env.AI_GEMINI_AUDIO_MODEL, DEFAULT_GEMINI_MODEL),
      thinking: thinking(env.AI_GEMINI_THINKING),
    },
    groq: {
      key: key(env.GROQ_API_KEY),
      sttModel: modelId(env.AI_GROQ_STT_MODEL, DEFAULT_GROQ_STT_MODEL),
    },
    openrouter: {
      key: key(env.OPENROUTER_API_KEY),
      visionModel: modelId(env.AI_OPENROUTER_VISION_MODEL, null),
      chatModel: modelId(env.AI_OPENROUTER_CHAT_MODEL, null),
    },
    globalDay,
    globalMinute,
    contextMax: intIn(env.AI_CONTEXT_MAX, CONTEXT_MAX_MIN, CONTEXT_MAX_DEFAULT) ?? CONTEXT_MAX_DEFAULT,
  };
}

export function providerOrder(kind: AiKind): ProviderName[] {
  if (kind === "stt") return ["groq", "gemini"];
  return ["gemini", "openrouter"];
}
