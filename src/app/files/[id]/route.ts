import { currentCtx } from "@/server/auth/guard";
import { handleFileGet } from "@/server/files/http";

/** GET /files/<id>: a private photo for a caller allowed to see it; every refusal is the same empty 404. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleFileGet(request, await currentCtx(), id);
}
