import { currentCtx } from "@/server/auth/guard";
import { handleUpload } from "@/server/admin/upload-request";

/** POST /admin/uploads/upload: the Excel upload (see `handleUpload` for the checks made before the body is read). */
export async function POST(request: Request): Promise<Response> {
  return handleUpload(request, await currentCtx());
}
