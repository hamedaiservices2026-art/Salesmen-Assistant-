// Judging the assistant's reply: its shape, its citations and every number it states, all checked by
// code against what the model was given. The model's claims (answerable, citations) are only ever
// narrowed, never trusted to widen what may be shown. Pure.
import { z } from "zod";
import { checkNumbers, numbersIn } from "./numbers";
import { plainText } from "./plain";
import { strictnessFor, type Topic } from "./topics";

export const ANSWER_MAX = 1500;

export const AnswerSchema = z
  .object({
    answer: z.string().max(4000),
    citations: z
      .array(z.object({ doc: z.string().regex(/^D\d{1,2}$/), section: z.string().regex(/^S\d{1,4}$/) }).strict())
      .max(5),
    answerable: z.boolean(),
  })
  .strict();

export type Citation = { doc: string; section: string };
export type Verdict =
  | { kind: "answer"; text: string; citations: Citation[] }
  | { kind: "not_in_documents" }
  | { kind: "unverified_numbers" }
  | { kind: "no_answer" };

export type JudgeInput = {
  topic: Topic;
  question: string;
  /** Numbers of every fact (value and label) and, for the caller's incentives, every incentive title and body. */
  factNumbers: ReadonlySet<string>;
  /** Numbers of each policy section given to the model, by `D1/S2`. */
  sectionNumbers: ReadonlyMap<string, ReadonlySet<string>>;
  /** The `D1/S2` keys of the sections given to the model. */
  knownSections: ReadonlySet<string>;
};

function parse(raw: unknown): z.infer<typeof AnswerSchema> | null {
  try {
    const r = AnswerSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * The verdict on a reply. Not `AnswerSchema` → `no_answer`. `answerable: false`, or an answer empty
 * after `plainText` → `not_in_documents` for `policy`, else `no_answer`. Citations of sections that were
 * not given are dropped (and repeats); a `policy` answer with none left → `not_in_documents`. The text
 * is `plainText(answer, 1500)` (tags removed first, R57), and its numbers must be in: the facts; the
 * question's numbers only for the loose topic `tips`; for `policy` the numbers of the cited sections
 * (R57 as amended by R80: no question numbers for any strict topic, policy and `other` included). Incentive texts reach `factNumbers` through the
 * caller. A number outside that set, under `strictnessFor(topic)` → `unverified_numbers`.
 */
export function judgeReply(raw: unknown, input: JudgeInput): Verdict {
  const reply = parse(raw);
  if (reply === null) return { kind: "no_answer" };
  const policy = input.topic === "policy";
  const unanswerable: Verdict = policy ? { kind: "not_in_documents" } : { kind: "no_answer" };
  if (!reply.answerable) return unanswerable;

  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const c of reply.citations) {
    const key = `${c.doc}/${c.section}`;
    if (!input.knownSections.has(key) || seen.has(key)) continue;
    seen.add(key);
    citations.push({ doc: c.doc, section: c.section });
  }
  if (policy && citations.length === 0) return { kind: "not_in_documents" };

  const text = plainText(reply.answer, ANSWER_MAX);
  if (text === "") return unanswerable;

  const mode = strictnessFor(input.topic);
  const allowed = new Set(input.factNumbers);
  // R80: only the loose topic (`tips`) may repeat the question's numbers; policy has its cited sections.
  if (mode === "loose") for (const n of numbersIn(input.question)) allowed.add(n);
  if (policy) {
    for (const key of seen) for (const n of input.sectionNumbers.get(key) ?? []) allowed.add(n);
  }
  if (!checkNumbers(text, allowed, mode).ok) return { kind: "unverified_numbers" };
  return { kind: "answer", text, citations };
}
