import { currentCtx } from "@/server/auth/guard";
import { handleCloseVoicePost } from "@/server/ai/close-voice";

/** Upload, speech to text and at most one model call must fit (R33). */
export const maxDuration = 60;

/** POST /app/ai/close-voice: the rep's voice note read into a close draft (see `handleCloseVoicePost`). */
export async function POST(request: Request): Promise<Response> {
  return handleCloseVoicePost(request, await currentCtx());
}
