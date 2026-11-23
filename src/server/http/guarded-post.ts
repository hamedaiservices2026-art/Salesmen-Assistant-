/**
 * Checks shared by the POST endpoints that take a cookie session and a body (the admin's Excel
 * upload, the rep's photos). Route handlers have no automatic cross-site protection, so a request
 * must name its own origin, carry a custom header that a plain cross-site form cannot send, and
 * declare a body length within the endpoint's cap. Then the body is read with a hard cap, whatever
 * the headers claimed.
 */

export type PostHeaderError = "bad_origin" | "bad_header" | "too_large";

/**
 * Reads headers only; nothing of the body is touched. The origin must have the same host as the
 * request (`x-forwarded-host`, else `host`) and the same scheme (`x-forwarded-proto`, else the
 * request URL's); `x-requested-with` must equal `requestedWith`; `content-length` must be present,
 * a number and at most `maxBody`.
 */
export function checkPostHeaders(
  headers: Headers,
  opts: { requestedWith: string; maxBody: number; requestUrl?: string },
): PostHeaderError | null {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = (headers.get("x-forwarded-proto") ?? (opts.requestUrl ? new URL(opts.requestUrl).protocol : "")).replace(/:$/, "");
  let ok = false;
  try {
    const o = origin ? new URL(origin) : null;
    ok = !!o && !!host && o.host === host && (proto === "" || o.protocol.replace(/:$/, "") === proto);
  } catch {
    ok = false;
  }
  if (!ok) return "bad_origin";
  if (headers.get("x-requested-with") !== opts.requestedWith) return "bad_header";
  const length = Number(headers.get("content-length"));
  if (!Number.isFinite(length) || headers.get("content-length") === null || length > opts.maxBody) {
    return "too_large";
  }
  return null;
}

/**
 * The request body, read chunk by chunk and abandoned as soon as it passes `maxBody`, whatever the
 * headers claimed. Returns null when it is over the cap.
 */
export async function readCappedBody(request: Request, maxBody: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBody) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
