// How a draft read meets the form's state, and how it is thrown away. Pure: the close form keeps
// this state and calls these functions; they decide what is filled, what must still be checked
// and what an earlier value was.
import type { CloseDraft } from "./draft";
import { fillForm, type FormLine } from "./apply-draft";

/** `cut`: the voice recording ended early (the limit, a hidden page, an ended microphone); its last number may be unfinished (R79). */
export type DraftRead = { draft: CloseDraft; draftId: string; transcript?: string; cut?: "limit" | "hidden" | "ended" };

/** A draft being reviewed: what it filled and what is still to look at. */
export type Review = {
  draft: CloseDraft;
  draftId: string;
  transcript?: string;
  cut?: "limit" | "hidden" | "ended";
  marks: Record<string, "ai" | "low">;
  /** The text the draft put in each field. */
  filled: Record<string, string>;
  /** A field the draft filled over a value that was already there (a saved close): what it held before. */
  replaced: Record<string, string>;
  skippedAdmin: Record<string, string>;
  missing: string[];
};

export type SessionState = {
  values: Record<string, string>;
  review: Review | null;
  /** Low fields the rep marked "صح". */
  acked: ReadonlySet<string>;
};

/**
 * Applies a read to the form's state. A field in `touched` (typed in since the page loaded) is never
 * filled, and neither is a field the rep acknowledged ("صح": he looked at that number and said it is
 * right; a second read must not replace it silently; R79); the rest of the form stays as it is. A
 * value the draft puts over another one always records what was there (`replaced`).
 */
export function applyRead(state: SessionState, read: DraftRead, form: { lines: FormLine[]; touched: ReadonlySet<string> }): SessionState {
  const protectedNames = new Set([...form.touched, ...state.acked]);
  const fill = fillForm(read.draft, { lines: form.lines, current: state.values, touched: protectedNames });
  const before = state.review;
  const replaced: Record<string, string> = {};
  for (const [name, old] of Object.entries(before?.replaced ?? {})) if (!Object.hasOwn(fill.values, name)) replaced[name] = old;
  for (const [name, text] of Object.entries(fill.values)) {
    const old = state.values[name] ?? "";
    if (old.trim() !== "" && old.trim() !== text) replaced[name] = old;
  }
  return {
    values: { ...state.values, ...fill.values },
    // An acknowledged field is never refilled, so every acknowledgement stands.
    acked: state.acked,
    review: {
      draft: read.draft,
      draftId: read.draftId,
      ...(read.transcript ? { transcript: read.transcript } : {}),
      ...(read.cut ? { cut: read.cut } : {}),
      marks: { ...(before?.marks ?? {}), ...fill.marks },
      filled: { ...(before?.filled ?? {}), ...fill.values },
      replaced,
      skippedAdmin: fill.skippedAdmin,
      missing: fill.missing,
    },
  };
}

/** Throws the reading away: a field still as the draft read it goes back to what the page loaded with; a field the rep changed stays. */
export function clearReading(state: SessionState, initial: Readonly<Record<string, string>>): SessionState {
  const values = { ...state.values };
  const filled = state.review?.filled ?? {};
  for (const name of Object.keys(filled)) if (values[name] === filled[name]) values[name] = Object.hasOwn(initial, name) ? initial[name]! : "";
  return { values, review: null, acked: new Set() };
}

/** What is kept in the browser with a draft so a reload brings back the rep's work, not just the draft (R79). */
export type StoredSession = {
  values: Record<string, string>;
  touched: string[];
  acked: string[];
  marks: Record<string, "ai" | "low">;
  filled: Record<string, string>;
  replaced: Record<string, string>;
  skippedAdmin: Record<string, string>;
  missing: string[];
};

/** The part of the state to store; null when no draft is being reviewed. */
export function toStored(state: SessionState, touched: ReadonlySet<string>): StoredSession | null {
  const r = state.review;
  if (!r) return null;
  return { values: state.values, touched: [...touched], acked: [...state.acked], marks: r.marks, filled: r.filled, replaced: r.replaced, skippedAdmin: r.skippedAdmin, missing: r.missing };
}

/**
 * The state after a reload. With the stored session the rep's work comes back exactly as it was
 * (values, what he touched, what he acknowledged) and the draft is NOT applied over it again. An
 * older entry without a session (or none that passed its check) brings back only the draft: its
 * fields are filled again and every one of them is marked low, so nothing misread comes back as
 * confident, and `keptChanges` is false so the screen says the rep's own changes were not kept.
 */
export function restoreSession(
  read: DraftRead,
  initial: Readonly<Record<string, string>>,
  lines: FormLine[],
  saved: StoredSession | null,
): { state: SessionState; touched: Set<string>; keptChanges: boolean } {
  const base = applyRead({ values: { ...initial }, review: null, acked: new Set() }, read, { lines, touched: new Set() });
  const review = base.review!;
  if (!saved) {
    const marks: Record<string, "ai" | "low"> = {};
    for (const name of Object.keys(review.marks)) marks[name] = "low";
    return { state: { values: base.values, review: { ...review, marks }, acked: new Set() }, touched: new Set(), keptChanges: false };
  }
  return {
    state: {
      values: { ...saved.values },
      acked: new Set(saved.acked),
      review: { ...review, marks: saved.marks, filled: saved.filled, replaced: saved.replaced, skippedAdmin: saved.skippedAdmin, missing: saved.missing },
    },
    touched: new Set(saved.touched),
    keptChanges: true,
  };
}
