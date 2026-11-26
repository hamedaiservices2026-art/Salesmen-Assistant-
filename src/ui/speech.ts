// Read-aloud helpers (pure). The phone's own voices only (decision 9); the browser parts are in
// ReadAloud. Client-safe.
import type { Locale } from "@/i18n/config";

export type VoiceLike = { lang: string; name: string; default?: boolean; localService?: boolean };

/** The most characters read in one go. */
export const SPEAK_MAX = 600;

const primary = (lang: unknown): string => (typeof lang === "string" ? lang.replace(/_/g, "-").toLowerCase().split("-")[0]! : "");
const region = (lang: unknown): string => (typeof lang === "string" ? lang.replace(/_/g, "-").toLowerCase() : "");

/**
 * The index of the best voice for `locale`: its language must be `ar`, `en` or `ur` as the locale
 * says (tags like `ar_SA` count). For Arabic `ar-SA` comes first, then voices that run on the
 * phone itself, then the phone's default voice, then the first. A voice the browser marks as an
 * online service (`localService === false`) is never chosen: the answer would leave the phone (R86);
 * a browser that does not say is taken as on-device. Null when no on-device voice speaks it.
 */
export function pickVoice(voices: readonly VoiceLike[], locale: Locale): number | null {
  let best: number | null = null;
  let bestScore = -1;
  voices.forEach((v, i) => {
    if (primary(v.lang) !== locale || v.localService === false) return;
    const score = (locale === "ar" && region(v.lang) === "ar-sa" ? 4 : 0) + (v.localService === true ? 2 : 0) + (v.default === true ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** Characters that end a sentence wherever they stand. */
const STRONG_END = /[!?؟۔]/;

/** Whether the text ends a sentence at index `i` (a full stop only before a space or the end, never inside a number or a name). */
function endsSentence(s: string, i: number): boolean {
  const c = s[i]!;
  if (STRONG_END.test(c)) return true;
  if (c !== ".") return false;
  const next = s[i + 1];
  return next === undefined || /\s/.test(next);
}

/** The text to read: at most 600 characters, cut at a sentence end (else a space). */
export function speakable(text: string): string {
  const kept = String(text).trim();
  if (kept.length <= SPEAK_MAX) return kept;
  const head = kept.slice(0, SPEAK_MAX);
  let end = -1;
  // `endsSentence` looks at the character after the stop in the whole text, so a stop at the cut is judged by what really follows.
  for (let i = head.length - 1; i >= 0; i--) {
    if (endsSentence(kept, i)) {
      end = i + 1;
      break;
    }
  }
  if (end > 0) return head.slice(0, end).trim();
  const space = head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : head).trim();
}

/**
 * True the first time it is asked on this device, false after (the no-voice hint). `getStorage`
 * may throw (private mode, blocked storage); then `memory` holds it for the page load.
 */
export function takeHintOnce(getStorage: () => Pick<Storage, "getItem" | "setItem">, memory: { shown: boolean }, key = "assistant.noVoiceHint"): boolean {
  try {
    const s = getStorage();
    if (s.getItem(key) !== null) return false;
    s.setItem(key, "1");
    return true;
  } catch {
    if (memory.shown) return false;
    memory.shown = true;
    return true;
  }
}
