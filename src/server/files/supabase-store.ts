import { isStorageKey } from "@/domain/files";
import type { Secret } from "@/server/ai/secret";
import type { FileStore } from "./store";

// ---------------------------------------------------------------------------------------------
// Supabase Storage REST shape. UNVERIFIED (docs/ai-providers.md): written from the documented
// `POST|GET|DELETE {url}/storage/v1/object/{bucket}/{key}` shape; the owner's first live run must
// confirm it. Every path piece and header name lives in this block so a correction is a few lines.
// ---------------------------------------------------------------------------------------------
/** The project URL: `https://<ref>.supabase.co`, nothing else (no port, path, user or other host). */
const PROJECT_URL = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,62}$/;
const OBJECT_PATH = "/storage/v1/object";
const KEY_HEADER = "apikey";
const AUTH_HEADER = "authorization";
const AUTH_PREFIX = "Bearer ";
/** Upload without overwrite. */
const UPSERT_HEADER = "x-upsert";
const UPSERT_VALUE = "false";
const CONTENT_TYPE = "image/jpeg";
/** Largest download read; anything longer is refused without reading further (R49). */
export const MAX_DOWNLOAD_BYTES = 5_000_000;
/** Longest wait for one storage request. */
const TIMEOUT_MS = 20_000;
/** A legacy service-role key is a JWT (three base64url parts); only that form goes in Authorization (R49). */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** A key must be a plain printable header value; anything else is refused before any request. */
const KEY_SHAPE = /^[\x21-\x7e]{20,4096}$/;
/** Largest error body inspected to tell "not found" from other failures; never logged or kept. */
const MAX_ERROR_PEEK = 4_096;
// ---------------------------------------------------------------------------------------------

/** Errors carry the operation and the HTTP status only: never the URL, key, bucket or body. */
export class SupabaseStoreError extends Error {
  readonly status: number | undefined;
  constructor(what: string, status?: number) {
    super(status === undefined ? `supabase storage: ${what}` : `supabase storage: ${what} (HTTP ${status})`);
    this.name = "SupabaseStoreError";
    this.status = status;
  }
}

/** Reads at most `MAX_ERROR_PEEK` bytes and says whether the body reports a missing object. */
async function saysNotFound(res: Response): Promise<boolean> {
  try {
    if (res.body === null) return false;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ERROR_PEEK) {
        await reader.cancel().catch(() => {});
        return false;
      }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed === null || typeof parsed !== "object") return false;
    const { statusCode, error } = parsed as { statusCode?: unknown; error?: unknown };
    return String(statusCode) === "404" || error === "not_found";
  } catch {
    return false;
  }
}

const discard = async (res: Response) => {
  await res.body?.cancel().catch(() => {});
};

async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    await discard(res);
    throw new SupabaseStoreError("object too large");
  }
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch {
      throw new SupabaseStoreError("download failed");
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel().catch(() => {});
      throw new SupabaseStoreError("object too large");
    }
    chunks.push(step.value);
  }
  const out = Buffer.concat(chunks);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * Private photos in a private Supabase Storage bucket. Reads no environment variable (R40): the
 * caller (`getFileStore`) passes the project URL, the service key as a `Secret` and the bucket.
 * Never creates a bucket, never asks for a public or signed URL, never follows a redirect.
 */
export function supabaseStore(opts: { url: string; key: Secret; bucket: string }, fetchImpl: typeof fetch = fetch): FileStore {
  if (typeof opts.url !== "string" || !PROJECT_URL.test(opts.url)) throw new SupabaseStoreError("SUPABASE_URL must be https://<ref>.supabase.co");
  if (typeof opts.bucket !== "string" || !BUCKET.test(opts.bucket)) throw new SupabaseStoreError("invalid bucket name");
  const origin = opts.url;
  const bucket = opts.bucket;
  const key = opts.key;
  if (!KEY_SHAPE.test(key.reveal())) throw new SupabaseStoreError("invalid service key");

  function objectUrl(storageKey: string): string {
    if (!isStorageKey(storageKey)) throw new SupabaseStoreError("invalid key");
    const path = [bucket, ...storageKey.split("/")].map(encodeURIComponent).join("/");
    const url = new URL(`${origin}${OBJECT_PATH}/${path}`);
    // Defence in depth: the request can only ever go to the configured project.
    if (url.origin !== origin) throw new SupabaseStoreError("invalid key");
    return url.href;
  }

  function headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers(extra);
    const value = key.reveal();
    h.set(KEY_HEADER, value);
    if (JWT_SHAPE.test(value)) h.set(AUTH_HEADER, `${AUTH_PREFIX}${value}`);
    return h;
  }

  async function send(what: string, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // A network error, a refused redirect or a timeout; its message can carry the URL, so it is dropped.
      throw new SupabaseStoreError(`${what} failed`);
    }
    if (res.redirected) {
      await discard(res);
      throw new SupabaseStoreError(`${what} failed`);
    }
    return res;
  }

  return {
    async put(storageKey, jpeg) {
      const url = objectUrl(storageKey);
      const res = await send("upload", url, {
        method: "POST",
        headers: headers({ "content-type": CONTENT_TYPE, [UPSERT_HEADER]: UPSERT_VALUE }),
        body: jpeg as Uint8Array<ArrayBuffer>,
      });
      await discard(res);
      if (res.status === 409) throw new SupabaseStoreError("object exists", res.status);
      if (res.status < 200 || res.status >= 300) throw new SupabaseStoreError("upload failed", res.status);
    },

    async get(storageKey) {
      const url = objectUrl(storageKey);
      const res = await send("download", url, { method: "GET", headers: headers() });
      if (res.status === 404) {
        await discard(res);
        return null;
      }
      if (res.status === 400 && (await saysNotFound(res))) return null;
      if (res.status < 200 || res.status >= 300) {
        await discard(res);
        throw new SupabaseStoreError("download failed", res.status);
      }
      return readCapped(res);
    },

    async remove(storageKey) {
      const url = objectUrl(storageKey);
      const res = await send("delete", url, { method: "DELETE", headers: headers() });
      if (res.status === 404 || (res.status === 400 && (await saysNotFound(res)))) {
        await discard(res);
        return;
      }
      await discard(res);
      if (res.status < 200 || res.status >= 300) throw new SupabaseStoreError("delete failed", res.status);
    },
  };
}
