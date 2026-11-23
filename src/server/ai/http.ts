import { AiError, type ProviderName } from "./types";

/** Largest provider response body read; anything longer is a `provider_error`. */
export const MAX_RESPONSE_BYTES = 1_000_000;
/** Longest Retry-After honoured as a number (the runner only waits for a couple of seconds anyway). */
const MAX_RETRY_AFTER_MS = 3_600_000;

const BAD_REQUEST = new Set([400, 401, 403, 404, 413, 422]);

/** Seconds → milliseconds; HTTP-dates, negatives and junk are ignored. */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null || !/^\d{1,7}(\.\d{1,3})?$/.test(header.trim())) return undefined;
  const ms = Math.round(Number(header) * 1000);
  return Number.isSafeInteger(ms) ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

/** Reads at most `MAX_RESPONSE_BYTES` of the body; `null` when it is longer. */
async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function send(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  provider: ProviderName,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, method: "POST", redirect: "error", signal });
  } catch {
    // Network failure, refused redirect or abort. Nothing of the error (it can carry the URL) is kept.
    throw new AiError(signal.aborted ? "timeout" : "provider_error", provider);
  }
  const status = res.status;
  if (status < 200 || status >= 300 || res.redirected) {
    const wait = status === 429 ? retryAfterMs(res.headers.get("retry-after")) : undefined;
    // The error body is never read: it may repeat the request, and is of no use to the caller.
    await res.body?.cancel().catch(() => {});
    if (status === 408) throw new AiError("timeout", provider);
    if (status === 429) throw new AiError("rate_limited", provider, wait);
    if (BAD_REQUEST.has(status) && !res.redirected) throw new AiError("bad_request", provider);
    throw new AiError("provider_error", provider);
  }
  let text: string | null;
  try {
    text = await readCapped(res);
  } catch {
    throw new AiError(signal.aborted ? "timeout" : "provider_error", provider);
  }
  if (text === null) throw new AiError("provider_error", provider);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiError("provider_error", provider);
  }
}

/**
 * POSTs a JSON body and returns the parsed JSON reply. Redirects are refused, at most
 * `MAX_RESPONSE_BYTES` are read, and the only thing an error carries is its code: never the URL,
 * the headers, the body or the provider's reply. Nothing is logged.
 */
export function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  provider: ProviderName,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return send(
    url,
    { headers: { ...headers, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) },
    signal,
    provider,
    fetchImpl,
  );
}

/** Like `postJson` for a multipart body (the content type, with its boundary, is set by `fetch`). */
export function postForm(
  url: string,
  headers: Record<string, string>,
  form: FormData,
  signal: AbortSignal,
  provider: ProviderName,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  return send(url, { headers: { ...headers, accept: "application/json" }, body: form }, signal, provider, fetchImpl);
}
