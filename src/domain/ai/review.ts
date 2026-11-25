// Which filled fields the rep still has to look at before the close can be confirmed. Pure.
//
// A field the draft filled with low confidence ("low") must be checked: the rep either changes the
// number or says it is right. Until then the confirm button stays disabled. The server never trusts
// the draft; this only keeps a doubtful number from being confirmed unseen.

export type ReviewInput = {
  /** Fields the draft filled: confident ("ai") or doubtful ("low"). */
  marks: Readonly<Record<string, "ai" | "low">>;
  /** The text the draft put in each field. */
  filled: Readonly<Record<string, string>>;
  /** What the fields hold now. */
  current: Readonly<Record<string, string>>;
  /** Fields the rep marked "صح". */
  acknowledged: ReadonlySet<string>;
  /** The form's display order, so the first pending field is the first one on screen. */
  order: readonly string[];
  /** The report is dated another day than the close being filled (R79): confirm waits for "التاريخ صح". */
  dateMismatch?: boolean;
  /** The rep said the date is right. */
  dateAcknowledged?: boolean;
};

const own = (o: Readonly<Record<string, string>>, k: string): string => (Object.hasOwn(o, k) && typeof o[k] === "string" ? o[k] : "");

/** What a field looks like now: "ai" (filled from the draft, still as read), "low" (still to check) or null (not from the draft, or changed by the rep). */
export function fieldReview(name: string, input: ReviewInput): "ai" | "low" | null {
  if (!Object.hasOwn(input.marks, name)) return null;
  const mark = input.marks[name];
  if (own(input.current, name).trim() !== own(input.filled, name).trim()) return null;
  if (mark === "low" && !input.acknowledged.has(name)) return "low";
  return "ai";
}

/** The low fields still to check, in display order (unlisted names last), and whether the form can be confirmed (low fields checked, and a report dated another day acknowledged). */
export function reviewState(input: ReviewInput): { pending: string[]; dateBlocks: boolean; canConfirm: boolean } {
  const index = new Map(input.order.map((n, i) => [n, i] as const));
  const rank = (n: string) => index.get(n) ?? Number.MAX_SAFE_INTEGER;
  const pending = Object.keys(input.marks)
    .filter((n) => fieldReview(n, input) === "low")
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const dateBlocks = input.dateMismatch === true && input.dateAcknowledged !== true;
  return { pending, dateBlocks, canConfirm: pending.length === 0 && !dateBlocks };
}
