import { readAiConfig, type AiConfig, type AiKind } from "./config";
import { fakeProvider } from "./fake";
import type { AiProvider } from "./types";

/**
 * The providers for a job, in fallback order. `mode "off"` → none; `"fake"` → the offline fake
 * (production gets "fake" only with ALLOW_AI_FAKE=1, see `readAiConfig`); `"live"` → the adapters
 * of `providerOrder(kind)` that have a key and a model. The live adapters arrive in Task 4; until
 * then `"live"` returns none.
 */
export function getProviders(kind: AiKind, config: AiConfig = readAiConfig(process.env)): AiProvider[] {
  if (config.mode === "fake") return [fakeProvider()];
  // "live": the adapters for providerOrder(kind) are added in Task 4. "off": none.
  return [];
}
