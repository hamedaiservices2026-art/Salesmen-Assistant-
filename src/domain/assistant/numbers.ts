// The assistant may state only numbers it was given ("no model-computed money"). This module reads
// every number in a text, written in digits of any script or spoken in words, and checks an answer's
// numbers against the allowed set. When in doubt it fails closed: a number-like thing it cannot read
// counts as an unknown number. Pure, linear in the length of the text.
import { stripInvisible } from "@/domain/ai/aliases";
import { normaliseArabic } from "@/domain/ai/normalise";
import { isNumberToken, scanNumbers, spokenTokens } from "@/domain/ai/spoken-numbers";

export type Strictness = "strict" | "loose";
export type NumberCheck = { ok: true } | { ok: false; unknown: string[] };

const N = (s: string) => normaliseArabic(s);
const set = (words: string[]) => new Set(words.map(N));

// ---------------------------------------------------------------------------------------------
// Vocabulary (all normalised with `normaliseArabic`)

/** Money words and currency codes. */
const MONEY = set([
  "ريال", "ريالات", "ريالا", "ريالين", "رس", "هلله", "هللات", "هلل", "جنيه", "جنيهات", "جنيها", "درهم", "دراهم", "دولار", "دولارات",
  "sar", "sr", "riyal", "riyals", "rial", "rials", "halala", "halalas", "aed", "egp", "usd", "qar", "dollar", "dollars", "dirham", "dirhams", "pound", "pounds",
  "روپے", "روپیہ", "روپیے", "روپئے", "rupee", "rupees", "rs", "pkr", "inr",
]);
/** Count units (cases, cartons, cans, boxes). */
const UNITS = set([
  "كرتونه", "كراتين", "كرتون", "كرتونات", "كرتونتين", "صندوق", "صناديق", "علبه", "علب", "حبه", "حبات",
  "case", "cases", "carton", "cartons", "ctn", "ctns", "box", "boxes", "pack", "packs", "unit", "units",
  "کارٹن", "ڈبہ", "ڈبے", "پیٹی",
]);
/** Percent words (`%` signs are found as characters). */
const PERCENT_WORDS = set(["percent", "pct", "percentage", "نسبه", "بالميه", "بالمائه", "بالمئه", "فیصد", "%"]);
/** Two words that together mean a percent or a money unit (`في المية`, `per cent`, `ر.س`, `S.R.`). */
const COMPOUNDS = new Set(["فيالميه", "فيالمائه", "فيالمئه", "percent", "رس", "sr"].map(N));
/** Scale words the spoken-number reader reads (`ألف`, `مليون`, …). */
const READ_SCALES = set(["الف", "الفا", "الاف", "الفين", "تلاف", "مليون", "مليونين", "ملايين", "thousand", "million"]);
/** Scale and count words the reader does not read; any of them in a strict answer fails it. */
const UNREAD_SCALES = set([
  "مليار", "مليارات", "مليارين", "بليون", "بلايين", "ترليون", "تريليون", "عشرات", "مئات", "ميات", "الوف",
  "billion", "billions", "trillion", "trillions", "dozen", "dozens", "hundreds", "thousands", "millions", "lakh", "lakhs", "crore", "crores",
  "ہزار", "لاکھ", "کروڑ", "ارب", "کھرب",
]);
/** Scale abbreviations glued to or right after digits (`5k`, `3 bn`). */
const SCALE_ABBREVIATIONS = new Set(["k", "m", "mn", "bn", "b"]);
/**
 * Urdu number words the reader does not read (the answer may be in Urdu). `ایک` and `دو` are left out:
 * they are also everyday words ("a", "give"), as `اسی` ("eighty", also "the same") is.
 */
const URDU_NUMBERS = set([
  "تین", "چار", "پانچ", "چھ", "سات", "آٹھ", "نو", "دس", "گیارہ", "بارہ", "تیرہ", "چودہ", "پندرہ", "سولہ", "سترہ", "اٹھارہ", "انیس",
  "بیس", "تیس", "چالیس", "پچاس", "ساٹھ", "ستر", "نوے", "سو",
]);
/** Fraction words: alone they are ordinary words too (`نص` is also "text"), so they count only near a number or a unit. */
const FRACTIONS = set(["نص", "نصف", "ربع", "ربعين", "ارباع", "ثلث", "ثلثين", "تلتين", "half", "quarter", "quarters", "third", "thirds"]);

/** Every word that makes a number next to it a money, unit, percent or scale figure. */
const UNIT_LIKE: ReadonlySet<string> = new Set([...MONEY, ...UNITS, ...PERCENT_WORDS, ...READ_SCALES, ...UNREAD_SCALES, ...SCALE_ABBREVIATIONS, "$"]);
const SCALES: ReadonlySet<string> = new Set([...READ_SCALES, ...UNREAD_SCALES]);

/** Arabic prefixes a unit or number word may carry (`بريال`, `والكراتين`, `بخمسة`); longest first. */
const PREFIXES = ["وبال", "وال", "بال", "لل", "ال", "وب", "ول", "و", "ب", "ل"].map(N);
const WAW = N("و");

function withoutPrefixes(word: string): string[] {
  const out = [word];
  for (const p of PREFIXES) if (word.length > p.length && word.startsWith(p)) out.push(word.slice(p.length));
  return out;
}

function isUnitLike(word: string | undefined): boolean {
  return word !== undefined && word !== "" && withoutPrefixes(word).some((w) => UNIT_LIKE.has(w));
}

function isCompound(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && COMPOUNDS.has(a + b);
}

// ---------------------------------------------------------------------------------------------
// Preparing the text

const WHITESPACE = /[\s\u0085]/gu;
const JOINERS = /[\u200C\u200D]/g;
const ANY_DIGIT = /\p{Nd}/gu;
const ND = /^\p{Nd}$/u;
const PERCENT_CHARS = /[%٪‰‱؉؊]/;
const PERCENT_OR_CURRENCY = /[%٪‰‱؉؊\p{Sc}]/gu;
const CURRENCY = /\p{Sc}/u;
const LETTER = /[\p{L}\p{M}]/u;

const digitCache = new Map<number, string>();
/** The value of any Unicode decimal digit: digits come in runs of ten starting at zero. */
function asciiDigit(c: string): string {
  const cp = c.codePointAt(0)!;
  if (cp >= 0x30 && cp <= 0x39) return c;
  const cached = digitCache.get(cp);
  if (cached !== undefined) return cached;
  let k = 0;
  while (k < 64 && ND.test(String.fromCodePoint(cp - k - 1))) k++;
  const d = String(k % 10);
  digitCache.set(cp, d);
  return d;
}

/**
 * NFKC (full-width and circled digits, `﹪`, `％`), whitespace made spaces, invisible characters
 * removed (zero-width, bidi marks and overrides, soft hyphen, joiners: a digit split by one reads as
 * one number, as a person sees it), every decimal digit made Western, `٫` and `٬` made `.` and `,`.
 */
function prepare(text: string): string {
  return stripInvisible(text.toWellFormed().normalize("NFKC").replace(WHITESPACE, " "))
    .replace(JOINERS, "")
    .replace(ANY_DIGIT, asciiDigit)
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

// ---------------------------------------------------------------------------------------------
// Digits

/** One number written in digits; `start`..`end` is the whole written sequence it came from. */
type Occurrence = { canon: string; start: number; end: number };

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function canonical(whole: string, fraction: string, negative: boolean): string {
  let i = 0;
  while (i < whole.length - 1 && whole[i] === "0") i++;
  const w = whole.slice(i) || "0";
  let j = fraction.length;
  while (j > 0 && fraction[j - 1] === "0") j--;
  const f = fraction.slice(0, j);
  const text = f === "" ? w : `${w}.${f}`;
  return negative && text !== "0" ? `-${text}` : text;
}

function readDigitsAt(s: string, i: number): number {
  while (isDigit(s[i])) i++;
  return i;
}

/** A comma group: digits joined by `,` between two digits. Returns its chunks and where it ends. */
function readCommaGroup(s: string, i: number): { chunks: string[]; end: number } {
  const chunks: string[] = [];
  for (;;) {
    const e = readDigitsAt(s, i);
    chunks.push(s.slice(i, e));
    if (s[e] === "," && isDigit(s[e + 1])) i = e + 1;
    else return { chunks, end: e };
  }
}

/** `parseAmount`'s rule: one chunk, or a first chunk of 1 to 3 digits (no leading 0) then chunks of exactly 3. */
function validGrouping(chunks: string[]): boolean {
  if (chunks.length === 1) return true;
  const head = chunks[0]!;
  if (head.length < 1 || head.length > 3 || head[0] === "0") return false;
  for (let g = 1; g < chunks.length; g++) if (chunks[g]!.length !== 3) return false;
  return true;
}

/** True when the `-` at `k` is a minus sign: not between two numbers (`10-20`, `10 - 20`) and not inside a word (`Item-5`). */
function isMinusAt(s: string, k: number): boolean {
  if (s[k] !== "-" && s[k] !== "−") return false;
  const before = s[k - 1];
  if (before !== undefined && (LETTER.test(before) || isDigit(before))) return false;
  let b = k - 1;
  while (b >= 0 && s[b] === " ") b--;
  return !isDigit(s[b]);
}

/**
 * Every number written in digits. A thousands separator (`,`, or one space before exactly three
 * digits) follows `parseAmount`'s grouping rule; a grouping that breaks it gives each chunk on its own
 * (`1,86` → 1 and 86), never a guess. `.` then digits is a decimal part; a second one (`14.11.2026`,
 * `1.2.3.4`) makes every chunk its own number. `.5` with no digit before is 0.5. A minus sign in front
 * is kept. Ranges, fractions, times and dates give their parts (`10-20`, `1/2`, `10:30`).
 */
function digitNumbers(s: string): Occurrence[] {
  const out: Occurrence[] = [];
  let i = 0;
  while (i < s.length) {
    if (!isDigit(s[i])) {
      i++;
      continue;
    }
    const start = i;
    if (s[i - 1] === "." && !isDigit(s[i - 2])) {
      const e = readDigitsAt(s, i);
      out.push({ canon: canonical("0", s.slice(i, e), false), start: i - 1, end: e });
      i = e;
      continue;
    }
    // Comma groups, joined by a single space only when the next group is exactly three digits.
    const first = readCommaGroup(s, i);
    const chunks = [...first.chunks];
    let end = first.end;
    while (s[end] === " " && isDigit(s[end + 1])) {
      const next = readCommaGroup(s, end + 1);
      if (next.chunks.length !== 1 || next.chunks[0]!.length !== 3) break;
      chunks.push(next.chunks[0]!);
      end = next.end;
    }
    const fractions: string[] = [];
    while (s[end] === "." && isDigit(s[end + 1])) {
      const e = readDigitsAt(s, end + 1);
      fractions.push(s.slice(end + 1, e));
      end = e;
    }
    const negative = start > 0 && isMinusAt(s, start - 1);
    const at = (canon: string) => out.push({ canon, start: negative ? start - 1 : start, end });
    const grouped = validGrouping(chunks);
    if (fractions.length <= 1 && grouped) {
      at(canonical(chunks.join(""), fractions[0] ?? "", negative));
    } else if (fractions.length <= 1) {
      chunks.forEach((c, n) => at(canonical(c, n === chunks.length - 1 ? (fractions[0] ?? "") : "", negative && n === 0)));
    } else {
      if (grouped) at(canonical(chunks.join(""), "", negative));
      else chunks.forEach((c, n) => at(canonical(c, "", negative && n === 0)));
      for (const f of fractions) at(canonical(f, "", false));
    }
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Neighbours of a run of digit numbers

type Side = { unit: boolean; glued: boolean; words: string[] };

/** The words next to `[from, to)` on one side: up to two words, skipping spaces and punctuation; a percent or currency sign is a unit. */
function side(s: string, pos: number, dir: 1 | -1): Side {
  const words: string[] = [];
  let p = pos;
  const glued = dir === 1 ? LETTER.test(s[p] ?? "") : LETTER.test(s[p - 1] ?? "");
  const charAt = (q: number) => (dir === 1 ? s[q] : s[q - 1]);
  while (words.length < 2) {
    let c = charAt(p);
    while (c !== undefined && !LETTER.test(c)) {
      if (PERCENT_CHARS.test(c) || CURRENCY.test(c)) return { unit: true, glued, words };
      if (isDigit(c)) return { unit: false, glued, words };
      p += dir;
      c = charAt(p);
    }
    if (c === undefined) break;
    const begin = p;
    while (charAt(p) !== undefined && LETTER.test(charAt(p)!)) p += dir;
    words.push(N(dir === 1 ? s.slice(begin, p) : s.slice(p, begin)));
  }
  return { unit: false, glued, words };
}

/** Digit numbers side by side with only spaces or punctuation between them share their neighbours (`5-7 ريال`, `1/2 ريال`). */
function chains(s: string, occ: Occurrence[]): Occurrence[][] {
  const out: Occurrence[][] = [];
  for (const o of occ) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev !== undefined && (o.start <= prev.end || onlyGap(s, prev.end, o.start))) last!.push(o);
    else out.push([o]);
  }
  return out;
}

function onlyGap(s: string, from: number, to: number): boolean {
  for (let k = from; k < to; k++) {
    const c = s[k]!;
    if (LETTER.test(c) || PERCENT_CHARS.test(c) || CURRENCY.test(c)) return false;
  }
  return true;
}

type ChainInfo = { members: Occurrence[]; unitNear: boolean; scaleAfter: string | null };

function chainInfo(s: string, members: Occurrence[]): ChainInfo {
  const right = side(s, members[members.length - 1]!.end, 1);
  const left = side(s, members[0]!.start, -1);
  const [r1, r2] = right.words;
  const [l1, l2] = left.words;
  const unitNear =
    right.unit || left.unit || right.glued || isUnitLike(r1) || isUnitLike(l1) || isCompound(r1, r2) || isCompound(l2, l1);
  const scaleAfter = r1 !== undefined && (SCALE_ABBREVIATIONS.has(r1) || withoutPrefixes(r1).some((w) => UNREAD_SCALES.has(w))) ? r1 : null;
  return { members, unitNear, scaleAfter };
}

// ---------------------------------------------------------------------------------------------
// Words

type WordNumber = { canon: string; value: number };
type Suspect = { text: string; unitNear: boolean };
type WordScan = { big: WordNumber[]; smallNearUnit: WordNumber[]; suspects: Suspect[] };

const PERCENT_TAILS = set(["الميه", "المائه", "المئه"]);
const IN = N("في");
const JOIN_WORDS = new Set([WAW, "and"]);

function hasDigit(t: string): boolean {
  for (let i = 0; i < t.length; i++) if (isDigit(t[i])) return true;
  return false;
}

/**
 * The text's tokens for the spoken-number reader: a percent or currency sign is its own token (`%`,
 * `$`), `في المية` and `بالمية` become `%` (so `المية` is not read as 100), and a prefixed number word
 * loses its prefix (`بخمسة` → `خمسه`, `وبخمسة` → `وخمسه`).
 */
function wordTokens(prepared: string): string[] {
  const spaced = prepared.replace(PERCENT_OR_CURRENCY, (c) => (CURRENCY.test(c) ? " $ " : " % "));
  const tokens = spokenTokens(spaced);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t === IN && PERCENT_TAILS.has(tokens[k + 1] ?? "")) {
      tokens[k] = "%";
      tokens[k + 1] = "%";
      continue;
    }
    if (withoutPrefixes(t).some((w) => PERCENT_WORDS.has(w))) {
      tokens[k] = "%";
      continue;
    }
    if (isNumberToken(t)) continue;
    for (const p of PREFIXES) {
      if (p === WAW || t.length <= p.length || !t.startsWith(p)) continue;
      const rest = t.slice(p.length);
      if (rest !== WAW && isNumberToken(rest)) {
        tokens[k] = p.startsWith(WAW) ? WAW + rest : rest;
        break;
      }
    }
  }
  return tokens;
}

function tokenNearUnit(tokens: string[], start: number, end: number): boolean {
  return (
    isUnitLike(tokens[start - 1]) ||
    isUnitLike(tokens[end]) ||
    isCompound(tokens[end], tokens[end + 1]) ||
    isCompound(tokens[start - 2], tokens[start - 1])
  );
}

function isNumberish(t: string | undefined): boolean {
  return t !== undefined && !JOIN_WORDS.has(t) && isNumberToken(t);
}

function baseOf(t: string): string {
  return t.length > 1 && t.startsWith(WAW) ? t.slice(WAW.length) : t;
}

function scanWords(prepared: string): WordScan {
  const tokens = wordTokens(prepared);
  const { numbers, bad } = scanNumbers(tokens);
  const big: WordNumber[] = [];
  const smallNearUnit: WordNumber[] = [];
  for (const n of numbers) {
    // A lone digit token is read (better, with its exact decimals) by `digitNumbers`.
    if (n.digits && n.end - n.start === 1) continue;
    const value = n.value + (n.half ? 0.5 : 0);
    const canon = n.half ? `${n.value}.5` : String(n.value);
    if (value >= 11) big.push({ canon, value });
    else if (!n.digits && tokenNearUnit(tokens, n.start, n.end)) smallNearUnit.push({ canon, value });
  }
  const suspects: Suspect[] = [];
  for (const b of bad) {
    const slice = tokens.slice(b.start, b.end);
    // Scale words stay: a bare `آلاف` is an unread number; money, unit and percent words do not.
    const words = slice.filter((t) => !hasDigit(t) && !JOIN_WORDS.has(t) && !(isUnitLike(t) && !withoutPrefixes(t).some((w) => SCALES.has(w))));
    if (words.length === 0) continue; // only digit tokens: read by `digitNumbers`
    const onlyFractions = words.every((t) => FRACTIONS.has(baseOf(t)) || FRACTIONS.has(t));
    const unitNear = slice.some((t) => isUnitLike(t)) || tokenNearUnit(tokens, b.start, b.end);
    const numberNear = isNumberish(tokens[b.start - 1]) || isNumberish(tokens[b.end]);
    if (onlyFractions && !unitNear && !numberNear) continue; // `حسب نص السياسة`: "text", not "half"
    suspects.push({ text: slice.join(" "), unitNear: unitNear || slice.some((t) => withoutPrefixes(t).some((w) => SCALES.has(w))) });
  }
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    const scale = withoutPrefixes(t).some((w) => UNREAD_SCALES.has(w));
    if (scale || URDU_NUMBERS.has(t)) suspects.push({ text: t, unitNear: scale || tokenNearUnit(tokens, k, k + 1) });
  }
  return { big, smallNearUnit, suspects };
}

// ---------------------------------------------------------------------------------------------
// Public

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * Every number in the text in canonical form: Western digits, no thousands separators, no trailing
 * zeros in the decimal part, a leading `-` for a minus sign (`"7,900.00"` → `"7900"`, `"38%"` →
 * `"38"`); then the value of every spoken number (Arabic or English words, via `readNumbers`) of 11 or
 * more (`"عشرين ألف"` → `"20000"`, `"5 ألف"` → `"5"` and `"5000"`). Each number once, digits first.
 */
export function numbersIn(text: string): string[] {
  if (typeof text !== "string" || text === "") return [];
  const s = prepare(text);
  return unique([...digitNumbers(s).map((o) => o.canon), ...scanWords(s).big.map((w) => w.canon)]);
}

const TOLERATED = /^(?:\d|10)$/;

/**
 * Strict: every number of the answer must be in `allowed`, and any number-like word the reader cannot
 * read (`نص مليون`, `ألف ونص`, `مليار`, an Urdu number word, digits before `k` or `مليار`) fails the
 * check. A small number word (below 11) next to a money, unit or percent word must be allowed too.
 * Loose: a number may be outside `allowed` only when it is a whole number from 0 to 10 that is not
 * next to (either side, across spaces and punctuation, through the prefixes `ب`, `ل`, `و`, `ال`) a
 * percent sign, a currency sign, a money, unit, percent or scale word, and has no letter glued after
 * it; unread number words fail only when they carry or touch such a word.
 */
export function checkNumbers(answer: string, allowed: ReadonlySet<string>, mode: Strictness): NumberCheck {
  if (typeof answer !== "string" || answer === "") return { ok: true };
  const strict = mode !== "loose";
  const s = prepare(answer);
  const unknown: string[] = [];
  for (const members of chains(s, digitNumbers(s))) {
    const info = chainInfo(s, members);
    for (const o of info.members) {
      if (allowed.has(o.canon)) continue;
      if (strict || info.unitNear || !TOLERATED.test(o.canon)) unknown.push(o.canon);
    }
    if (strict && info.scaleAfter !== null) unknown.push(`${info.members[info.members.length - 1]!.canon} ${info.scaleAfter}`);
  }
  const words = scanWords(s);
  for (const w of [...words.big, ...words.smallNearUnit]) if (!allowed.has(w.canon)) unknown.push(w.canon);
  for (const sus of words.suspects) if (strict || sus.unitNear) unknown.push(sus.text);
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown: unique(unknown) };
}
