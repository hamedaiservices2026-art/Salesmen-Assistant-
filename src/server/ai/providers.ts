import { providerOrder, readAiConfig, type AiConfig, type AiKind, type ProviderName } from "./config";
import { fakeProvider } from "./fake";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { openrouterProvider } from "./openrouter";
import type { AiProvider } from "./types";

/**
 * The providers for a job, in fallback order. `mode "off"` → none; `"fake"` → the offline fake
 * (production gets "fake" only with ALLOW_AI_FAKE=1, see `readAiConfig`); `"live"` → the adapters
 * of `providerOrder(kind)` that have a key and a model for the kind. `fetchImpl` is for tests.
 */
export function getProviders(
  kind: AiKind,
  config: AiConfig = readAiConfig(process.env),
  fetchImpl: typeof fetch = fetch,
): AiProvider[] {
  if (config.mode === "fake") return [fakeProvider()];
  if (config.mode !== "live") return [];
  const make: Partial<Record<ProviderName, () => AiProvider>> = {
    gemini: () => geminiProvider(config.gemini, fetchImpl),
    groq: () => groqProvider(config.groq, fetchImpl),
    openrouter: () => openrouterProvider(config.openrouter, fetchImpl),
  };
  return providerOrder(kind)
    .map((name) => make[name]?.())
    .filter((p): p is AiProvider => p !== undefined && p.modelFor(kind) !== null);
}
