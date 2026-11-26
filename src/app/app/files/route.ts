import { after } from "next/server";
import { currentCtx } from "@/server/auth/guard";
import { handleFilePost } from "@/server/files/http";
import { runMaintenance } from "@/server/maintenance";

/**
 * The time budget of one upload (final review A-L5): the decoder queue waits at most 10 s, the decode
 * at most 10 s, the storage write at most 20 s (the Supabase adapter's timeout); 10 + 10 + 20 = 40 s
 * leaves room for the body and the database under 60 s.
 */
export const maxDuration = 60;

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
