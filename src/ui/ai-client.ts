// The browser side of "read the report photo" and "read the voice note": one POST each, with the
// custom header the server requires, a 55 s limit, and the reply checked again before the page
// uses it. Client-safe: only shared constants and types from src/domain (R43).
import { AI_REQUESTED_WITH, type CloseDraft } from "@/domain/ai/draft";
import { parseStoredDraft } from "@/domain/ai/draft-schema";
import { TRANSCRIPT_MAX } from "@/domain/ai/audio";
import { isFileId } from "@/domain/files";

export type ReadKind = "photo" | "voice";

/** Every `reason` the two routes can return (the reason to copy map covers each of them). */
export const AI_READ_REASONS = [
  "bad_date",
  "not_selling_day",
  "too_large",
  "unsupported_type",
  "too_many_pixels",
  "corrupt",
  "storage_failed",
  "company_off",
  "disabled",
  "no_notice",
  "no_provider",
  "audio_type",
  "rate_limited",
  "quota",
  "failed",
  "unreadable",
  "nothing_heard",
  "empty",
  "timeout",
  "busy",
  "unauthorized",
  "bad_request",
] as const;
export type ReadReason = (typeof AI_READ_REASONS)[number];

export type ReadResult =
  | { ok: true; draft: CloseDraft; draftId: string; transcript?: string }
  /** `cancelled`: the caller aborted; nothing is shown. `transcript`: what was heard when nothing could be read from it. */
  | { ok: false; reason: ReadReason | "cancelled"; transcript?: string };

const ENDPOINT: Record<ReadKind, { url: string; field: string }> = {
  photo: { url: "/app/ai/close-photo", field: "file" },
  voice: { url: "/app/ai/close-voice", field: "audio" },
};
const TIMEOUT_MS = 55_000;

/** Other replies of the routes that mean "the request itself was wrong". */
const BAD_REQUEST: ReadonlySet<unknown> = new Set(["forbidden", "no_file", "no_audio"]);
const isReason = (r: unknown): r is ReadReason => typeof r === "string" && (AI_READ_REASONS as readonly string[]).includes(r);

/** A reply without a usable reason code: what the status alone says (a 413 or 504 may come from the platform in front of the app). */
function byStatus(status: number): ReadReason {
  if (status === 401) return "unauthorized";
  if (status === 413) return "too_large";
  if (status === 422) return "unreadable";
  if (status === 429) return "rate_limited";
  if (status === 504) return "timeout";
  return "failed";
}

/**
 * The catalog key (from the messages root, for example `close.read.errors.busy` or
 * `ai.unavailable.quota`) of the copy for a failed read. Every reason of the two routes has copy;
 * anything unknown is the plain "could not read it". The photo and voice wording differ where the
 * thing to do differs.
 */
export function readErrorKey(kind: ReadKind, reason: string): string {
  switch (reason) {
    case "unauthorized":
    case "bad_request":
    case "bad_date":
    case "not_selling_day":
    case "too_many_pixels":
    case "corrupt":
    case "busy":
      return `close.read.errors.${reason}`;
    case "too_large":
      return kind === "voice" ? "close.read.errors.audio_too_large" : "close.read.errors.too_large";
    case "unsupported_type":
      return kind === "voice" ? "ai.unavailable.audio_type" : "close.read.errors.unsupported_type";
    case "disabled":
    case "company_off":
    case "no_provider":
      return "ai.unavailable.disabled";
    case "no_notice":
    case "quota":
    case "rate_limited":
    case "timeout":
    case "audio_type":
      return `ai.unavailable.${reason}`;
    case "unreadable":
      return kind === "voice" ? "ai.unavailable.unreadable" : "close.draft.unreadable";
    case "nothing_heard":
    case "empty":
      return "close.draft.nothingHeard";
    default:
      return "ai.unavailable.failed";
  }
}

/** The caller's signal and a time limit as one signal; chained by hand so it works where `AbortSignal.any` does not exist. */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!signal) return timeout;
  const both = new AbortController();
  for (const source of [signal, timeout]) {
    if (source.aborted) both.abort(source.reason);
    else source.addEventListener("abort", () => both.abort(source.reason), { once: true });
  }
  return both.signal;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, TRANSCRIPT_MAX) : undefined);

/**
 * Sends one photo or voice note for reading and returns the draft or the reason it failed.
 * The reply is untrusted: the draft must have exactly the shape `toDraft` makes, for the date
 * asked and the source asked, and the receipt id must be an id (shaped like a file id).
 */
export async function readFromAi(kind: ReadKind, date: string, blob: Blob, opts: { signal?: AbortSignal } = {}): Promise<ReadResult> {
  const { url, field } = ENDPOINT[kind];
  const body = new FormData();
  body.set("date", date);
  body.set(field, blob, kind === "photo" ? "report.jpg" : "voice");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { "x-requested-with": AI_REQUESTED_WITH },
      signal: withTimeout(opts.signal),
    });
  } catch (e) {
    if (opts.signal?.aborted) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "failed" };
  }

  type Reply = { draft?: unknown; draftId?: unknown; reason?: unknown; transcript?: unknown };
  let reply = null as Reply | null;
  if ((res.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    try {
      const parsed: unknown = await res.json();
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) reply = parsed as Reply;
    } catch {
      reply = null;
    }
  }

  if (res.ok) {
    const draft = reply ? parseStoredDraft(reply.draft) : null;
    if (!reply || !draft || typeof reply.draftId !== "string" || !isFileId(reply.draftId) || draft.date !== date || draft.source !== kind) {
      return { ok: false, reason: "failed" };
    }
    const transcript = text(reply.transcript);
    return { ok: true, draft, draftId: reply.draftId, ...(transcript ? { transcript } : {}) };
  }
  const reason = reply && isReason(reply.reason) ? reply.reason : reply && BAD_REQUEST.has(reply.reason) ? "bad_request" : byStatus(res.status);
  const transcript = reply ? text(reply.transcript) : undefined;
  return { ok: false, reason, ...(transcript ? { transcript } : {}) };
}
