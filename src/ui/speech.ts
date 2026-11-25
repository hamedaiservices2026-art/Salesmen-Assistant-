// Read-aloud helpers (pure). The phone's own voices only (decision 9); the browser parts are in
// ReadAloud. Client-safe.
import type { Locale } from "@/i18n/config";

export type VoiceLike = { lang: string; name: string; default?: boolean; localService?: boolean };

/** A line of the text that starts with this mark is a citation chip, not part of the answer, and is never read out. */
export const CITATION_MARK = "§";
/** The most characters read in one go. */
export const SPEAK_MAX = 600;

const primary = (lang: unknown): string => (typeof lang === "string" ? lang.replace(/_/g, "-").toLowerCase().split("-")[0]! : "");
const region = (lang: unknown): string => (typeof lang === "string" ? lang.replace(/_/g, "-").toLowerCase() : "");

/**
 * The index of the best voice for `locale`: its language must be `ar`, `en` or `ur` as the locale
 * says (tags like `ar_SA` count). For Arabic `ar-SA` comes first, then voices that run on the
 * phone itself, then the phone's default voice, then the first. Null when no voice speaks it.
 */
export function pickVoice(voices: readonly VoiceLike[], locale: Locale): number | null {
  let best: number | null = null;
  let bestScore = -1;
  voices.forEach((v, i) => {
    if (primary(v.lang) !== locale) return;
    const score = (locale === "ar" && region(v.lang) === "ar-sa" ? 4 : 0) + (v.localService === true ? 2 : 0) + (v.default === true ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

const SENTENCE_END = /[.!?؟۔]/;

/** The text to read: citation lines dropped, at most 600 characters, cut at a sentence end (else a space). */
export function speakable(text: string): string {
  const kept = String(text)
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(CITATION_MARK))
    .join("\n")
    .trim();
  if (kept.length <= SPEAK_MAX) return kept;
  const head = kept.slice(0, SPEAK_MAX);
  let end = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (SENTENCE_END.test(head[i]!)) {
      end = i + 1;
      break;
    }
  }
  if (end > 0) return head.slice(0, end).trim();
  const space = head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : head).trim();
}
