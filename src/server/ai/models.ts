import type { ProviderName } from "./types";
import { AiError } from "./types";

/** Same shape `readAiConfig` accepts; checked again here because the id goes into a URL path. */
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/** A model id safe to put in a URL path segment, or a `bad_request` (no request is made). */
export function pathModel(model: string, provider: ProviderName): string {
  if (!SAFE_MODEL.test(model) || model.includes("..")) throw new AiError("bad_request", provider);
  return encodeURIComponent(model);
}

export function asCount(n: unknown): number | null {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
