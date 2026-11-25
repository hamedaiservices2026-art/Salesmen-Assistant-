import { currentCtx } from "@/server/auth/guard";
import { handleTranscribePost } from "@/server/ai/transcribe";

/** Upload and one speech-to-text call must fit (R33). */
export const maxDuration = 60;

/** POST /app/ai/transcribe: the rep's spoken question as text for him to edit and send (see `handleTranscribePost`). */
export async function POST(request: Request): Promise<Response> {
  return handleTranscribePost(request, await currentCtx());
}
