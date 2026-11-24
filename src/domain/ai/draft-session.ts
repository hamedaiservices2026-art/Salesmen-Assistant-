// How a draft read meets the form's state, and how it is thrown away. Pure: the close form keeps
// this state and calls these functions; they decide what is filled, what must still be checked
// and what an earlier value was.
import type { CloseDraft } from "./draft";
import { fillForm, type FormLine } from "./apply-draft";

export type DraftRead = { draft: CloseDraft; draftId: string; transcript?: string };

/** A draft being reviewed: what it filled and what is still to look at. */
export type Review = {
  draft: CloseDraft;
  draftId: string;
  transcript?: string;
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
 * filled; a field the draft fills again is no longer acknowledged (it holds a new number to check);
 * the rest of the form stays as it is.
 */
export function applyRead(state: SessionState, read: DraftRead, form: { lines: FormLine[]; touched: ReadonlySet<string> }): SessionState {
  const fill = fillForm(read.draft, { lines: form.lines, current: state.values, touched: form.touched });
  const before = state.review;
  const replaced: Record<string, string> = {};
  for (const [name, old] of Object.entries(before?.replaced ?? {})) if (!Object.hasOwn(fill.values, name)) replaced[name] = old;
  for (const [name, text] of Object.entries(fill.values)) {
    const old = state.values[name] ?? "";
    if (before && Object.hasOwn(before.filled, name) && before.filled[name] === old) {
      // the old value was an earlier read: keep what was there before that one
      if (Object.hasOwn(before.replaced, name)) replaced[name] = before.replaced[name]!;
    } else if (old.trim() !== "" && old.trim() !== text) replaced[name] = old;
  }
  return {
    values: { ...state.values, ...fill.values },
    acked: new Set([...state.acked].filter((n) => !Object.hasOwn(fill.marks, n))),
    review: {
      draft: read.draft,
      draftId: read.draftId,
      ...(read.transcript ? { transcript: read.transcript } : {}),
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
