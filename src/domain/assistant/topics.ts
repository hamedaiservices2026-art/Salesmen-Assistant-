// What a rep's question is about, decided by code from keywords, never by the model. The topic
// decides how strictly the answer's numbers are checked. Pure.
import { stripInvisible } from "@/domain/ai/aliases";
import { normaliseArabic } from "@/domain/ai/normalise";
import type { Strictness } from "./numbers";

export const TOPICS = ["standing", "remaining", "commission", "incentive", "policy", "focus", "collection", "coverage", "tips", "other"] as const;
export type Topic = (typeof TOPICS)[number];

const TOPIC_SET: ReadonlySet<string> = new Set(TOPICS);

/** True for a value of the closed topic list (a stored or sent topic is checked with it). */
export function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && TOPIC_SET.has(value);
}

/**
 * Keywords in ar, en and ur, in the order they are tried (incentive first: an incentive question
 * often names the commission too). Each is matched as a substring of the normalised question (R34),
 * so stems match every suffix (`عمول` → `عمولتي`, `عمولتك`, `العموله`). Added beyond the plan's
 * lists, each checked for false positives: `بونص`, `مكافا` (incentive), `تارقت` (Gulf spelling of
 * target), `متبقي` (remaining), `خصوم` (the plural `خصومات` does not contain `خصم`).
 */
const KEYWORDS: readonly (readonly [Topic, readonly string[]])[] = [
  ["incentive", ["حافز", "حوافز", "بونص", "مكافا", "incentive", "bonus", "ترغیب"]],
  ["commission", ["عمول", "هكسب", "commission", "earn", "کمیشن"]],
  ["remaining", ["باقي", "فاضل", "متبقي", "remaining", "left", "باقی"]],
  ["collection", ["تحصيل", "collection", "وصولی"]],
  ["coverage", ["تغطيه", "coverage"]],
  ["focus", ["فوكس", "تركيز", "focus"]],
  ["policy", ["سياسه", "مسموح", "ينفع", "خصم", "خصوم", "مرتجع", "policy", "allowed", "discount", "return", "پالیسی"]],
  ["standing", ["تارجت", "تارقت", "فين", "وصلت", "target", "standing", "ہدف"]],
  ["tips", ["ازاي ابيع", "نصيحه", "tips", "how do i sell"]],
].map(([topic, words]) => [topic as Topic, (words as string[]).map((w) => normaliseArabic(w))] as const);

/** The question as the keywords see it: invisible characters removed (so `عمو\u200Bلتي` matches), then `normaliseArabic`. */
function normalisedQuestion(question: string): string {
  if (typeof question !== "string") return "";
  return normaliseArabic(stripInvisible(question.toWellFormed().normalize("NFKC")));
}

export function classifyTopic(question: string): Topic {
  const q = normalisedQuestion(question);
  if (q === "") return "other";
  for (const [topic, words] of KEYWORDS) {
    if (words.some((w) => q.includes(w))) return topic;
  }
  return "other";
}

/** `tips` and `other` are loose; every other topic, and any value that is not a topic, is strict. */
export function strictnessFor(topic: Topic): Strictness {
  return topic === "tips" || topic === "other" ? "loose" : "strict";
}
