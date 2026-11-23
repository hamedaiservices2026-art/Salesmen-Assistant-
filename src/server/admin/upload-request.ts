import { revalidatePath } from "next/cache";
import type { Ctx } from "@/server/ctx";
import { checkPostHeaders, readCappedBody as readCappedPostBody, type PostHeaderError } from "@/server/http/guarded-post";
import { REQUESTED_WITH, isKind, type UploadResponse } from "./upload-request-shared";
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
 * The shared header checks (`checkPostHeaders`) with this endpoint's header value and body cap:
 * same-origin, the custom header, and a declared length within the limit. Nothing of the body is read.
 */
export function checkUploadHeaders(headers: Headers, requestUrl?: string): PostHeaderError | null {
  return checkPostHeaders(headers, { requestedWith: REQUESTED_WITH, maxBody: BODY_LIMIT, requestUrl });
}

/** The request body read with this endpoint's cap (`readCappedBody`); null when it is over the cap. */
export function readCappedBody(request: Request): Promise<Uint8Array | null> {
  return readCappedPostBody(request, BODY_LIMIT);
}

const json = (status: number, body: UploadResponse): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

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
