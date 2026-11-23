import { after } from "next/server";
import { currentCtx } from "@/server/auth/guard";
import { handleFilePost } from "@/server/files/http";
import { sweepFiles } from "@/server/files/files";
import { getFileStore } from "@/server/files/store";

export const maxDuration = 30;

/** POST /app/files: a rep stores one return photo (see `handleFilePost` for the checks). */
export async function POST(request: Request): Promise<Response> {
  const ctx = await currentCtx();
  const response = await handleFilePost(request, ctx);
  if (ctx) {
    // Old and removed photos are cleared after the reply is sent, in a small batch (R38).
    after(async () => {
      try {
        await sweepFiles(ctx.db, getFileStore(), new Date());
      } catch (e) {
        console.error("photo sweep failed", e instanceof Error ? e.name : "unknown error");
      }
    });
  }
  return response;
}
