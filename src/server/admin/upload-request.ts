import { revalidatePath } from "next/cache";
import type { Ctx } from "@/server/ctx";
import type { SheetKind } from "@/server/import/xlsx";
import { REQUESTED_WITH, type UploadResponse } from "./upload-request-shared";
import {
  STORED_ERRORS,
  UPLOAD_MAX_BYTES,
  processUpload,
  readUploadFile,
  rejectUpload,
  singleFlight,
  type UploadResult,
} from "./uploads";

export { REQUESTED_WITH, type UploadResponse } from "./upload-request-shared";

/** Room for the multipart framing and the other form fields around the file. */
const BODY_OVERHEAD = 64 * 1024;

const BODY_LIMIT = UPLOAD_MAX_BYTES + BODY_OVERHEAD;

/**
 * Route handlers have no automatic cross-site protection for cookie sessions, so the request must
 * name its own origin (same scheme and host as the request it was sent to), carry the custom header,
 * and declare a body length within the limit. All of this is read from headers: nothing of the body
 * is touched.
 */
export function checkUploadHeaders(headers: Headers, requestUrl?: string): "bad_origin" | "bad_header" | "too_large" | null {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = (headers.get("x-forwarded-proto") ?? (requestUrl ? new URL(requestUrl).protocol : "")).replace(/:$/, "");
  let ok = false;
  try {
    const o = origin ? new URL(origin) : null;
    ok = !!o && !!host && o.host === host && (proto === "" || o.protocol.replace(/:$/, "") === proto);
  } catch {
    ok = false;
  }
  if (!ok) return "bad_origin";
  if (headers.get("x-requested-with") !== REQUESTED_WITH) return "bad_header";
  const length = Number(headers.get("content-length"));
  if (!Number.isFinite(length) || headers.get("content-length") === null || length > BODY_LIMIT) {
    return "too_large";
  }
  return null;
}

/**
 * The request body, read chunk by chunk and abandoned as soon as it passes the cap, whatever the
 * headers claimed. Returns null when it is over the cap.
 */
export async function readCappedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
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

const json = (status: number, body: UploadResponse): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const isKind = (k: unknown): k is SheetKind => k === "targets" || k === "daily";

/**
 * The upload endpoint's logic. `ctx` is the signed-in context (the route passes it from the
 * session); only an admin proceeds, and the headers are checked before the body is read.
 */
export async function handleUpload(request: Request, ctx: Ctx | null): Promise<Response> {
  if (!ctx || ctx.role !== "admin") return json(403, { failure: "forbidden" });
  const bad = checkUploadHeaders(request.headers, request.url);
  if (bad === "too_large") {
    // The file name sits inside the body, which is not read: the record carries a placeholder.
    await rejectUpload(ctx, { kind: "daily", filename: "(too large)" }, "too_large");
    return json(413, { failure: "too_large" });
  }
  if (bad) return json(403, { failure: "bad_request" });

  let form: FormData;
  try {
    const body = await readCappedBody(request);
    if (body === null) {
      await rejectUpload(ctx, { kind: "daily", filename: "(too large)" }, "too_large");
      return json(413, { failure: "too_large" });
    }
    form = await new Response(body as BodyInit, { headers: request.headers }).formData();
  } catch {
    return json(400, { failure: "no_file" });
  }
  const kind = form.get("kind");
  if (!isKind(kind)) return json(400, { failure: "bad_kind" });
  const file = form.get("file");
  if (!(file instanceof File) || file.name === "") return json(400, { kind, failure: "no_file" });

  let outcome;
  try {
    outcome = await singleFlight(`${ctx.companyId}|${ctx.userId}`, async (): Promise<UploadResult> => {
      // The multipart body is already parsed above (bounded by the content-length check); the file's
      // own size is checked against the limit before its bytes are copied out.
      const read = await readUploadFile(file);
      if (!read.ok) return rejectUpload(ctx, { kind, filename: file.name }, read.error);
      return processUpload(ctx, { kind, filename: file.name, data: read.data });
    });
  } catch (e) {
    console.error("upload request failed", e instanceof Error ? e.message : "unknown error");
    return json(500, { kind, filename: file.name, failure: "failed" });
  }
  if (outcome.busy) return json(409, { kind, filename: file.name, failure: "busy" });
  const r = outcome.value;
  revalidatePath("/admin/uploads");
  if (r.applied) {
    revalidatePath("/admin/targets");
    revalidatePath("/admin");
  }
  return json(200, {
    kind,
    filename: file.name,
    result: {
      applied: r.applied,
      rows: r.rows,
      errorCount: r.errors.length,
      errors: r.errors.slice(0, STORED_ERRORS),
      ...(r.readError ? { readError: r.readError } : {}),
      ...(r.missing ? { missing: r.missing } : {}),
      ...(r.duplicates ? { duplicates: r.duplicates } : {}),
    },
  });
}
