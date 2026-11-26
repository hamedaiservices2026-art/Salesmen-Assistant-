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
  /**
   * A read in this review was dated another day and the rep has not said the date is right: confirm
   * waits for it, even after a later read dated right (R84). `mismatchDate` is that report's date.
   */
  dateMismatch: boolean;
  mismatchDate: string | null;
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
 *
 * A second read never leaves an earlier read's figure confident (R84): a field the earlier read
 * filled, still as it read it, that the new read does not give goes back to what the page loaded
 * with (`initial`), or, without `initial`, stays but is marked low. A report dated another day keeps
 * the date gate across later reads until the rep says the date is right (`dateAcknowledged`: he said
 * so for the review shown before this read).
 */
export function applyRead(
  state: SessionState,
  read: DraftRead,
  form: { lines: FormLine[]; touched: ReadonlySet<string>; initial?: Readonly<Record<string, string>>; dateAcknowledged?: boolean },
): SessionState {
  const protectedNames = new Set([...form.touched, ...state.acked]);
  const before = state.review;
  // Earlier fills still as read and not the rep's: they must not keep standing on the old read's word.
  const stale = Object.keys(before?.filled ?? {}).filter((name) => !protectedNames.has(name) && (state.values[name] ?? "").trim() === (before!.filled[name] ?? "").trim());
  const base = { ...state.values };
  if (form.initial) for (const name of stale) base[name] = Object.hasOwn(form.initial, name) ? form.initial[name]! : "";
  const fill = fillForm(read.draft, { lines: form.lines, current: base, touched: protectedNames });

  const marks: Record<string, "ai" | "low"> = { ...(before?.marks ?? {}) };
  const filled: Record<string, string> = { ...(before?.filled ?? {}) };
  const replaced: Record<string, string> = {};
  for (const [name, old] of Object.entries(before?.replaced ?? {})) if (!Object.hasOwn(fill.values, name)) replaced[name] = old;
  for (const name of stale) {
    if (Object.hasOwn(fill.values, name)) continue;
    if (form.initial) {
      // Back to the loaded value: no longer from a draft, and nothing was replaced.
      delete marks[name];
      delete filled[name];
      delete replaced[name];
    } else marks[name] = "low";
  }
  for (const [name, text] of Object.entries(fill.values)) {
    const old = state.values[name] ?? "";
    if (old.trim() !== "" && old.trim() !== text) replaced[name] = old;
  }
  const earlierGate = before !== null && before.dateMismatch && form.dateAcknowledged !== true;
  const dateMismatch = read.draft.dateMismatch === true || earlierGate;
  return {
    values: { ...base, ...fill.values },
    // An acknowledged field is never refilled, so every acknowledgement stands.
    acked: state.acked,
    review: {
      draft: read.draft,
      draftId: read.draftId,
      ...(read.transcript ? { transcript: read.transcript } : {}),
      ...(read.cut ? { cut: read.cut } : {}),
      marks: { ...marks, ...fill.marks },
      filled: { ...filled, ...fill.values },
      replaced,
      skippedAdmin: fill.skippedAdmin,
      missing: fill.missing,
      dateMismatch,
      mismatchDate: read.draft.dateMismatch === true ? read.draft.reportDate : earlierGate ? before!.mismatchDate : null,
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
  dateMismatch?: boolean;
  mismatchDate?: string | null;
};

/** The part of the state to store; null when no draft is being reviewed. */
export function toStored(state: SessionState, touched: ReadonlySet<string>): StoredSession | null {
  const r = state.review;
  if (!r) return null;
  return { values: state.values, touched: [...touched], acked: [...state.acked], marks: r.marks, filled: r.filled, replaced: r.replaced, skippedAdmin: r.skippedAdmin, missing: r.missing, dateMismatch: r.dateMismatch, mismatchDate: r.mismatchDate };
}

/**
 * The state after a reload. With the stored session the rep's work comes back exactly as it was
 * (values, what he touched, what he acknowledged) and the draft is NOT applied over it again. An
 * older entry without a session (or none that passed its check) brings back only the draft: its
 * fields are filled again and every one of them is marked low, so nothing misread comes back as
 * confident, and `keptChanges` is false so the screen says the rep's own changes were not kept.
 * A line the admin recorded since the session was stored (it now has `adminAmount`) shows the loaded
 * value and is no longer from the draft (R16).
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
  const values = { ...saved.values };
  const marks = { ...saved.marks };
  const filled = { ...saved.filled };
  const replaced = { ...saved.replaced };
  const acked = new Set(saved.acked);
  const adminFields = new Set(lines.filter((l) => l.adminAmount !== undefined).map((l) => l.field));
  for (const name of adminFields) {
    values[name] = Object.hasOwn(initial, name) ? initial[name]! : "";
    delete marks[name];
    delete filled[name];
    delete replaced[name];
    acked.delete(name);
  }
  // A stored gate stands; an entry stored before R84 falls back to the draft's own date check.
  const dateMismatch = saved.dateMismatch ?? review.dateMismatch;
  const mismatchDate = saved.mismatchDate !== undefined ? saved.mismatchDate : review.mismatchDate;
  return {
    state: {
      values,
      acked,
      review: {
        ...review,
        marks,
        filled,
        replaced,
        // What the current lines skip (an admin line recorded since), not what was skipped then.
        skippedAdmin: review.skippedAdmin,
        missing: saved.missing.filter((n) => !adminFields.has(n)),
        dateMismatch,
        mismatchDate: dateMismatch ? mismatchDate : null,
      },
    },
    touched: new Set(saved.touched),
    keptChanges: true,
  };
}
