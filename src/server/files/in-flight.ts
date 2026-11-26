// Uploads in flight per rep on this instance (final review A-L3). Each upload holds a slot from
// before its body is read until its reply, so a burst cannot have many 4 MB bodies being read and
// decoded at once; a refused or failed upload gives its slot back when it ends (counted in flight,
// never by completions). Shared by `/app/files` and `/app/ai/close-photo`.
import type { Ctx } from "@/server/ctx";

/** At most this many uploads of one rep at a time on one instance. */
export const UPLOADS_IN_FLIGHT_MAX = 2;
/** Seconds a client waits before retrying a refused upload. */
export const UPLOAD_BUSY_RETRY_AFTER_SECONDS = 5;

const inFlight = new Map<string, number>();

/** Takes a slot for the caller, or null when he already has the maximum in flight. The returned function gives it back (once). */
export function takeUploadSlot(ctx: Ctx): (() => void) | null {
  const key = `${ctx.companyId}\u0000${ctx.userId}`;
  const n = inFlight.get(key) ?? 0;
  if (n >= UPLOADS_IN_FLIGHT_MAX) return null;
  inFlight.set(key, n + 1);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    const left = (inFlight.get(key) ?? 1) - 1;
    if (left <= 0) inFlight.delete(key);
    else inFlight.set(key, left);
  };
}
