// The assistant screen's state machine (pure): what is shown, whether a request is pending, what
// the input holds. Client-safe: no server imports (R43). The reply types are the shapes the server
// action returns, restated here.

export const QUESTION_MAX = 500;
/** The character counter appears from here. */
export const QUESTION_COUNTER_FROM = 400;

export type ChatFact = { id: string; label: string; value: string };
export type ChatCitation = { title: string; label: string };
export type VerdictKind = "not_in_documents" | "unverified_numbers" | "no_answer";
export type FailReason = "disabled" | "company_off" | "no_notice" | "no_provider" | "rate_limited" | "quota" | "failed" | "unreadable" | "empty" | "too_long";

/** What `askAction` returns. */
export type ChatReply =
  | { ok: true; verdict: "answer"; text: string; citations: ChatCitation[] }
  | { ok: true; verdict: VerdictKind; facts: ChatFact[] }
  | { ok: false; reason: FailReason };

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "answer"; text: string; citations: ChatCitation[] }
  /** `facts` null: a verdict loaded from the stored conversation, which keeps no figures. */
  | { id: string; kind: "verdict"; verdict: VerdictKind; facts: ChatFact[] | null };

/** A stored row as the page hands it over. */
export type StoredMessage = { id: string; role: "user" | "assistant"; text: string; verdict: string | null; citations: ChatCitation[] };

/** The reasons after which asking again cannot work until something changes outside the screen. */
export type BlockReason = "disabled" | "company_off" | "no_notice" | "no_provider" | "quota";
const BLOCKING: ReadonlySet<string> = new Set<BlockReason>(["disabled", "company_off", "no_notice", "no_provider", "quota"]);

export type ChatState = {
  items: ChatItem[];
  pending: boolean;
  input: string;
  fieldError: "empty" | "too_long" | null;
  /** Why the last question was refused or failed: a transient card (never stored), gone when the rep types or asks again. */
  notice: Exclude<FailReason, "empty" | "too_long"> | null;
  blocked: BlockReason | null;
  /** The question of the request in flight, so a refusal of its shape can put it back in the field. */
  asking: string | null;
  seq: number;
};

export type ChatAction =
  | { type: "input"; text: string }
  | { type: "send"; question: string }
  | { type: "result"; result: ChatReply }
  | { type: "transcript"; text: string }
  | { type: "clear" }
  /** The rep dealt with what blocked him (accepted the notice), so asking is tried again. */
  | { type: "unblock" };

const VERDICTS: readonly string[] = ["not_in_documents", "unverified_numbers", "no_answer"];

export function initialChat(stored: readonly StoredMessage[], blocked: BlockReason | null = null): ChatState {
  const items: ChatItem[] = [];
  for (const m of stored) {
    if (m.role === "user") items.push({ id: `s-${m.id}`, kind: "user", text: m.text });
    else if (m.verdict === "answer") items.push({ id: `s-${m.id}`, kind: "answer", text: m.text, citations: m.citations });
    else if (m.verdict !== null && VERDICTS.includes(m.verdict)) items.push({ id: `s-${m.id}`, kind: "verdict", verdict: m.verdict as VerdictKind, facts: null });
  }
  return { items, pending: false, input: "", fieldError: null, notice: null, blocked, asking: null, seq: 0 };
}

export const isBlocked = (s: ChatState): boolean => s.blocked !== null;

const codePoints = (s: string): number => Array.from(s).length;
export const counterVisible = (input: string): boolean => codePoints(input) >= QUESTION_COUNTER_FROM;
export const counterText = (input: string): string => `${codePoints(input)}/${QUESTION_MAX}`;

/** Whether `raw` may be sent now, and the trimmed question when it may. */
export function submitCheck(
  s: Pick<ChatState, "pending" | "blocked">,
  raw: string,
): { ok: true; question: string } | { ok: false; reason: "pending" | "blocked" | "empty" | "too_long" } {
  if (s.pending) return { ok: false, reason: "pending" };
  if (s.blocked !== null) return { ok: false, reason: "blocked" };
  const question = raw.trim();
  if (question === "") return { ok: false, reason: "empty" };
  if (codePoints(question) > QUESTION_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, question };
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case "input":
      return { ...s, input: a.text, fieldError: null, notice: null };
    case "transcript": {
      const text = a.text.trim();
      if (text === "") return s;
      // the rep reads it, edits it and sends it himself
      const joined = s.input.trim() === "" ? text : `${s.input.trim()} ${text}`;
      // never longer than a question may be, so the counter and the limit stay true
      const input = Array.from(joined).slice(0, QUESTION_MAX).join("");
      return { ...s, input, fieldError: null, notice: null };
    }
    case "send": {
      const c = submitCheck(s, a.question);
      if (!c.ok) {
        if (c.reason === "empty" || c.reason === "too_long") return { ...s, fieldError: c.reason };
        return s;
      }
      const id = `u${s.seq + 1}`;
      return { ...s, items: [...s.items, { id, kind: "user", text: c.question }], pending: true, input: "", fieldError: null, notice: null, asking: c.question, seq: s.seq + 1 };
    }
    case "result": {
      if (!s.pending) return s;
      const r = a.result;
      const base = { ...s, pending: false, asking: null };
      if (!r.ok) {
        // The question is the rep's: its bubble goes, the field gets it back (unless he already typed something new).
        const items = s.items.at(-1)?.kind === "user" ? s.items.slice(0, -1) : s.items;
        const input = s.input === "" ? (s.asking ?? "") : s.input;
        if (r.reason === "empty" || r.reason === "too_long") return { ...base, items, input, fieldError: r.reason };
        return { ...base, items, input, notice: r.reason, blocked: BLOCKING.has(r.reason) ? (r.reason as BlockReason) : s.blocked };
      }
      const id = `a${s.seq + 1}`;
      const item: ChatItem = r.verdict === "answer" ? { id, kind: "answer", text: r.text, citations: r.citations } : { id, kind: "verdict", verdict: r.verdict, facts: r.facts };
      return { ...base, items: [...s.items, item], seq: s.seq + 1 };
    }
    case "unblock":
      return { ...s, blocked: null };
    case "clear":
      return { ...s, items: [], fieldError: null, notice: null, asking: null, pending: false };
  }
}
