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
 * often names the commission too). Arabic-script keywords match as substrings of the normalised
 * question (R34), so stems match every suffix (`عمول` → `عمولتي`, `عمولتك`, `العموله`). Latin
 * keywords match whole words (a trailing `s`/`es` allowed), and a phrase matches consecutive words, so
 * `learn` is not `earn` and `in return` is not the policy word `returns` (R80). Beyond the plan's lists
 * (R80): commission spellings and pay words, `ناقص`/`بقي`/`تبقى` for remaining, sales, achievement and
 * rank words for standing.
 */
const KEYWORDS: readonly (readonly [Topic, readonly string[]])[] = (
  [
    ["incentive", ["حافز", "حوافز", "بونص", "مكافا", "incentive", "bonus", "ترغیب"]],
    [
      "commission",
      ["عمول", "هكسب", "كومشن", "كوميشن", "كمشن", "قبض", "مرتب", "راتب", "ربح", "commission", "comission", "commision", "earn", "earning", "earnings", "payout", "paid", "make", "salary", "کمیشن"],
    ],
    ["remaining", ["باقي", "فاضل", "متبقي", "ناقص", "بقي", "تبقى", "remaining", "left", "more do i need", "how much more", "باقی"]],
    ["collection", ["تحصيل", "collection", "وصولی"]],
    ["coverage", ["تغطيه", "coverage"]],
    ["focus", ["فوكس", "تركيز", "focus"]],
    ["policy", ["سياسه", "مسموح", "ينفع", "خصم", "خصوم", "مرتجع", "policy", "allowed", "discount", "returns", "return policy", "پالیسی"]],
    [
      "standing",
      ["تارجت", "تارقت", "فين", "وصلت", "مبيعات", "حقق", "ترتيب", "نسبتي", "target", "standing", "sales", "achieved", "rank", "where am i", "how far", "how many cases", "ہدف"],
    ],
    ["tips", ["ازاي ابيع", "نصيحه", "tips", "tip", "how do i sell"]],
  ] as [Topic, string[]][]
).map(([topic, words]) => [topic, words.map((w) => normaliseArabic(w))] as const);

/**
 * Figure interrogatives (R80): a question asking "how much / how many" is about a figure, so it never
 * becomes loose, and the figure topics are tried before policy. Matched on whole words.
 */
const FIGURE_WORDS = ["كام", "كم", "بكام", "وكام", "وكم", "how much", "how many", "قدر ايه", "what's my", "whats my", "what is my", "کتنا", "کتنی", "کتنے"].map((w) =>
  normaliseArabic(w),
);
const FIGURE_ORDER: readonly Topic[] = ["incentive", "commission", "remaining", "collection", "coverage", "focus", "standing", "policy"];

const LATIN = /[a-z]/;

/** The question's words: letters, digits and the apostrophe, so `what's` stays one word. */
function wordsOf(q: string): string[] {
  return q.split(/[^\p{L}\p{M}\p{N}']+/u).filter((w) => w !== "");
}

function sameWord(word: string, key: string): boolean {
  return word === key || word === key + "s" || word === key + "es";
}

/** True when the keyword is in the question: a Latin keyword (or any phrase) as whole words, an Arabic-script one as a substring. */
function contains(q: string, words: readonly string[], key: string): boolean {
  if (!LATIN.test(key) && !key.includes(" ")) return q.includes(key);
  const parts = key.split(" ");
  if (parts.length === 1) return words.some((w) => sameWord(w, key));
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length && ok; j++) ok = j === parts.length - 1 ? sameWord(words[i + j]!, parts[j]!) : words[i + j] === parts[j];
    if (ok) return true;
  }
  return false;
}

/** The question as the keywords see it: invisible characters removed (so `عمو\u200Bلتي` matches), then `normaliseArabic`. */
function normalisedQuestion(question: string): string {
  if (typeof question !== "string") return "";
  return normaliseArabic(stripInvisible(question.toWellFormed().normalize("NFKC")));
}

/**
 * The plan's order; with a figure interrogative in the question the figure topics come first and
 * `tips` is never chosen (R80), so such a question is a figure topic, `policy`, or strict `other`.
 */
export function classifyTopic(question: string): Topic {
  const q = normalisedQuestion(question);
  if (q === "") return "other";
  const words = wordsOf(q);
  const figure = FIGURE_WORDS.some((w) => isWordOrPhrase(words, w));
  const order = figure ? FIGURE_ORDER : KEYWORDS.map(([t]) => t);
  for (const topic of order) {
    const keys = KEYWORDS.find(([t]) => t === topic)![1];
    if (keys.some((k) => contains(q, words, k))) return topic;
  }
  return "other";
}

/** A figure word matches only as a whole word (Arabic too: `كم` must not hit `كمان`). */
function isWordOrPhrase(words: readonly string[], key: string): boolean {
  const parts = key.split(" ");
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length && ok; j++) ok = words[i + j] === parts[j];
    if (ok) return true;
  }
  return false;
}

/** Only `tips` is loose; every other topic (`other` included, R80) and any value that is not a topic is strict. */
export function strictnessFor(topic: Topic): Strictness {
  return topic === "tips" ? "loose" : "strict";
}
