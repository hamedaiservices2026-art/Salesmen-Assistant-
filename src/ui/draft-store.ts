// The draft being reviewed, kept in sessionStorage so a reload does not lose it (24 hours, one per
// rep and day). It is validated with zod when read back and must belong to the same day, the same
// rep and the same set of lines; anything else is removed. Values never reach the server from here:
// the form's own fields are what is posted. Browser-only; every storage call is guarded.
import { z } from "zod";
import type { CloseDraft } from "@/domain/ai/draft";
import { parseStoredDraft, parseStoredSession } from "@/domain/ai/draft-schema";
import type { StoredSession } from "@/domain/ai/draft-session";
import { isFileId } from "@/domain/files";

export const DRAFT_LIFETIME_MS = 24 * 3_600_000;
/** A save time this far ahead of the clock is a wrong clock or a forged entry. */
const SKEW_MS = 5 * 60_000;
/** v1 entries (a draft only) are still read; v2 also carries the rep's work with it (R79). */
const VERSION = 2;

export type StoredDraft = {
  draft: CloseDraft;
  draftId: string;
  savedAt: number;
  /** `draftContextKey(lines, date)`: what the draft was read against. */
  contextKey: string;
  /** What was heard, for a voice draft. */
  transcript?: string;
  /** Why the recording ended early, for a voice draft. */
  cut?: "limit" | "hidden" | "ended";
  /** What the rep did with it: his values, what he touched and acknowledged. */
  session?: StoredSession | null;
};

const Entry = z
  .object({
    v: z.union([z.literal(1), z.literal(2)]),
    draft: z.unknown(),
    draftId: z.string().refine(isFileId),
    savedAt: z.number().finite(),
    contextKey: z.string().max(4000),
    transcript: z.string().max(2000).optional(),
    cut: z.enum(["limit", "hidden", "ended"]).optional(),
    session: z.unknown().optional(),
  })
  .strict();

const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function storageKey(userKey: string, date: string): string | null {
  return TOKEN.test(userKey) && DATE.test(date) ? `close-draft:${userKey}:${date}` : null;
}

function remove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // storage may be blocked
  }
}

export function saveDraft(storage: Storage, userKey: string, d: StoredDraft): void {
  const key = storageKey(userKey, d.draft.date);
  if (!key) return;
  try {
    const entry = { v: VERSION, draft: d.draft, draftId: d.draftId, savedAt: d.savedAt, contextKey: d.contextKey, ...(d.transcript ? { transcript: d.transcript } : {}), ...(d.cut ? { cut: d.cut } : {}), ...(d.session ? { session: d.session } : {}) };
    storage.setItem(key, JSON.stringify(entry));
  } catch {
    // a full or blocked storage only means a reload loses the draft
  }
}

/**
 * The stored draft for this rep and day, or null. The entry is removed when it is expired, belongs
 * to another day or another set of lines, or is not exactly what `saveDraft` writes.
 */
export function loadDraft(storage: Storage, userKey: string, date: string, now: number, contextKey: string): { draft: CloseDraft; draftId: string; transcript?: string; cut?: "limit" | "hidden" | "ended"; session: StoredSession | null } | null {
  const key = storageKey(userKey, date);
  if (!key) return null;
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const entry = Entry.safeParse(JSON.parse(text));
    if (entry.success) {
      const e = entry.data;
      const draft = parseStoredDraft(e.draft);
      const fresh = now - e.savedAt <= DRAFT_LIFETIME_MS && e.savedAt - now <= SKEW_MS;
      // A session that is present but not valid spoils the entry; one that is absent (v1) is a draft without the rep's work.
      const session = e.session === undefined ? null : parseStoredSession(e.session);
      if (draft && draft.date === date && e.contextKey === contextKey && fresh && (e.session === undefined || session !== null)) {
        return { draft, draftId: e.draftId, ...(e.transcript ? { transcript: e.transcript } : {}), ...(e.cut ? { cut: e.cut } : {}), session };
      }
    }
  } catch {
    // broken JSON falls through to the removal below
  }
  remove(storage, key);
  return null;
}

export function clearDraft(storage: Storage, userKey: string, date: string): void {
  const key = storageKey(userKey, date);
  if (key) remove(storage, key);
}

/** Removes every stored draft (sign-in and sign-out: no draft outlives the session it was read in). */
export function clearAllDrafts(storage: Storage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith("close-draft:")) keys.push(k);
    }
    for (const k of keys) remove(storage, k);
  } catch {
    // storage may be blocked
  }
}
