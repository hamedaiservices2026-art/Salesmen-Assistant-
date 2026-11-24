import { currentCtx } from "@/server/auth/guard";
import { handleClosePhotoPost } from "@/server/ai/close-photo";

/** Upload, decode and one provider call must fit (R33). */
export const maxDuration = 60;

/** POST /app/ai/close-photo: the rep's report photo read into a close draft (see `handleClosePhotoPost`). */
export async function POST(request: Request): Promise<Response> {
  return handleClosePhotoPost(request, await currentCtx());
}
