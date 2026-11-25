import { after } from "next/server";
import { currentCtx } from "@/server/auth/guard";
import { handleFilePost } from "@/server/files/http";
import { runMaintenance } from "@/server/maintenance";

export const maxDuration = 30;

/** POST /app/files: a rep stores one return photo (see `handleFilePost` for the checks). */
export async function POST(request: Request): Promise<Response> {
  const ctx = await currentCtx();
  const response = await handleFilePost(request, ctx);
  if (ctx && response.status === 200) {
    // Retention is applied after the reply is sent (R38). `runMaintenance` lets one instance run
    // it at most once per 10 minutes, so an upload cannot make it run more often (R59).
    after(async () => {
      try {
        await runMaintenance(ctx.db, new Date());
      } catch (e) {
        console.error("maintenance failed", e instanceof Error ? e.name : "unknown error");
      }
    });
  }
  return response;
}
