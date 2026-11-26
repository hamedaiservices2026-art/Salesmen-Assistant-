/** Zero-width and bidirectional marks that spreadsheets and chat apps leave inside cells. */
const INVISIBLE = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
/** No-break and other Unicode spaces (and line and paragraph separators) become one plain space. */
const ODD_SPACES = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;

/** Arabic-Indic and Persian digits to `0-9` (one helper for the whole product). */
export { westernDigits } from "@/domain/digits";

/**
 * Text as a person sees it: invisible marks removed, odd spaces made plain, runs of whitespace
 * collapsed, ends trimmed. Used for logins, line codes, dates, amounts and header names.
 */
export function normalizeText(s: string): string {
  return s.replace(INVISIBLE, "").replace(ODD_SPACES, " ").replace(/\s+/g, " ").trim();
}
