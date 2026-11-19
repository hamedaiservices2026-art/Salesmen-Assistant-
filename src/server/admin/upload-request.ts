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

/**
 * Route handlers have no automatic cross-site protection for cookie sessions, so the request must
 * name its own origin (equal to the Host it was sent to), carry the custom header, and declare a
 * body length within the limit. All of this is read from headers: nothing of the body is touched.
 */
export function checkUploadHeaders(headers: Headers): "bad_origin" | "bad_header" | "too_large" | null {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !host || originHost !== host) return "bad_origin";
  if (headers.get("x-requested-with") !== REQUESTED_WITH) return "bad_header";
  const length = Number(headers.get("content-length"));
  if (!Number.isFinite(length) || headers.get("content-length") === null || length > UPLOAD_MAX_BYTES + BODY_OVERHEAD) {
    return "too_large";
  }
  return null;
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
  const bad = checkUploadHeaders(request.headers);
  if (bad === "too_large") return json(413, { failure: "too_large" });
  if (bad) return json(403, { failure: "forbidden" });

  let form: FormData;
  try {
    form = await request.formData();
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
