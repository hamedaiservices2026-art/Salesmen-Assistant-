// What a report's labels are called: the built-in names of every draft field and the company's own
// labels for them. The labels reach a model prompt, so an alias is cleaned strictly. Pure.
import { draftKeys, lineKey, MONEY_KEYS, STOCK_KEYS, type DraftKey, type DraftLine } from "./draft";
import type { Unit } from "@/domain/money";

export const ALIASES_PER_FIELD = 8;
export const ALIAS_MAX = 60;

/** Characters that could open a tag, a block, a code fence or a table cell in a prompt. */
const FORBIDDEN = /[<>{}[\]`|]/u;
/** Line and paragraph separators (after NFKC); any of them would start a new line in the prompt. */
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
/** Control, format (bidi marks and overrides, zero-width, tag characters) and private-use code points. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}]/u;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
const JOINERS = new Set(["\u200C", "\u200D"]);

/**
 * Removes control, format, bidi, zero-width, tag and private-use code points. ZWNJ and ZWJ stay only
 * between two letters or marks (they are part of Persian and Urdu spelling). The one normaliser for
 * every label text: aliases here and, in Task 12, the transcript before it is matched against labels.
 */
export function stripInvisible(text: string): string {
  // One regex pass (Task 12: a transcript can be long); the neighbours of a joiner are read in the
  // original text, as code points.
  return text.replace(STRIP, (c: string, offset: number, whole: string) => {
    if (!JOINERS.has(c)) return "";
    const prev = codePointBefore(whole, offset);
    const next = offset + c.length < whole.length ? String.fromCodePoint(whole.codePointAt(offset + c.length)!) : undefined;
    return prev !== undefined && next !== undefined && LETTER_OR_MARK.test(prev) && LETTER_OR_MARK.test(next) ? c : "";
  });
}

const STRIP = new RegExp(INVISIBLE.source, "gu");

function codePointBefore(s: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const low = s.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = s.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1];
}

/** True when the text holds nothing a person could see (empty, spaces, invisible characters). */
export function isBlankAlias(s: string): boolean {
  return typeof s === "string" && s.normalize("NFKC").replace(/[\p{C}\s]/gu, "") === "";
}

/**
 * One label as the admin typed it, made safe for a prompt: NFKC, invisible characters removed, spaces
 * collapsed and trimmed. Null when it is empty, longer than 60 code points, holds a line break, or
 * holds any of `< > { } [ ] \` |` (checked after NFKC, so full-width forms count too).
 */
export function cleanAlias(input: string): string | null {
  if (typeof input !== "string") return null;
  const text = input.toWellFormed().normalize("NFKC");
  if (LINE_BREAK.test(text)) return null;
  const cleaned = stripInvisible(text).replace(/\s+/gu, " ").trim();
  if (cleaned === "") return null;
  if (FORBIDDEN.test(cleaned)) return null;
  if (Array.from(cleaned).length > ALIAS_MAX) return null;
  return cleaned;
}

/**
 * A built-in name or code (from the company's own lines): the unsafe characters become spaces instead
 * of refusing the name, then spaces collapse. Null when nothing is left. Capped at 60 code points.
 */
export function cleanLabelLenient(input: string): string | null {
  if (typeof input !== "string") return null;
  const text = input.toWellFormed().normalize("NFKC").replace(LINE_BREAK, " ");
  const cleaned = stripInvisible(text)
    .replace(new RegExp(FORBIDDEN.source, "gu"), " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") return null;
  return Array.from(cleaned).slice(0, ALIAS_MAX).join("").trim() || null;
}

export const DEFAULT_ALIASES: Record<(typeof MONEY_KEYS)[number] | (typeof STOCK_KEYS)[number], string[]> = {
  // The bare spoken forms are there so a voice note saying "نقدي" is understood; the parser's
  // longest-label-first rule keeps "بيع نقدي" preferred (R29).
  cashSales: ["بيع نقدي", "مبيعات نقدية", "نقدي", "كاش", "Cash Sales", "Cash"],
  creditSales: ["بيع آجل", "مبيعات آجلة", "آجل", "Credit Sales", "Credit"],
  collections: ["تحصيل", "تحصيل مديونيات", "Collections"],
  expenses: ["مصاريف", "مصروفات", "مصروف", "Expenses"],
  loaded: ["محمّل", "تحميل", "Loaded"],
  sold: ["مباع", "كراتين مباعة", "Sold"],
  returned: ["مرتجع", "مرتجعات", "Returned"],
};

export type VocabularyEntry = { key: DraftKey; unit: Unit; labels: string[] };
export type VocabularyLine = DraftLine & { nameAr: string; nameEn: string; nameUr: string };

function addUnique(into: string[], seen: Set<string>, label: string | null): void {
  if (label === null) return;
  const k = label.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  into.push(label);
}

/**
 * For each draft key of the company: the labels the reader may look for. A line has its three names
 * and its code; the money and stock keys have the defaults; then the company's own aliases (cleaned
 * again, at most 8 per field, only for keys the company has), de-duplicated ignoring case.
 */
export function vocabulary(lines: VocabularyLine[], custom: Record<string, string[]>): VocabularyEntry[] {
  const byCode = new Map(lines.map((l) => [lineKey(l.code), l]));
  return draftKeys(lines).map(({ key, unit }) => {
    const labels: string[] = [];
    const seen = new Set<string>();
    const line = byCode.get(key);
    const base: string[] = line ? [line.nameAr, line.nameEn, line.nameUr, line.code] : [...DEFAULT_ALIASES[key as keyof typeof DEFAULT_ALIASES]];
    for (const b of base) addUnique(labels, seen, cleanLabelLenient(b));
    const own = Object.hasOwn(custom, key) ? custom[key] : undefined;
    if (Array.isArray(own)) {
      let taken = 0;
      for (const a of own) {
        if (taken >= ALIASES_PER_FIELD) break;
        const c = typeof a === "string" ? cleanAlias(a) : null;
        if (c === null) continue;
        taken += 1;
        addUnique(labels, seen, c);
      }
    }
    return { key, unit, labels };
  });
}
