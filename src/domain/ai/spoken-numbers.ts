// Numbers as a rep says them in a voice note: digit tokens and Arabic (Egyptian, Gulf, MSA) or
// English number words. Pure, integer arithmetic only, one linear pass over the tokens. A run of
// number words that is not a clean number gives no token (never a guess).
import { stripInvisible } from "./aliases";
import { normaliseArabic } from "./normalise";

/** One number read from the tokens; `start`..`end` are token indexes, `end` exclusive. */
export type NumberToken = { start: number; end: number; value: number; half: boolean; digits: boolean };
/** A run that looked like a number but is not a clean one (token indexes, `end` exclusive). */
export type BadRun = { start: number; end: number };

/** Words for a unit between a number and a label (normalised). */
export const UNIT_WORDS: ReadonlySet<string> = new Set(
  ["كرتونة", "كراتين", "كرتون", "كرتونات", "ريال", "ريالات", "جنيه", "جنيهات", "case", "cases", "sar", "riyal", "riyals"].map(
    (w) => normaliseArabic(w),
  ),
);

const INVISIBLE_OR_JOINER = /\p{C}/u;
const ZW_JOINERS = /[\u200C\u200D]/g;
const WHITESPACE = /[\s\u0085]+/gu;

function isLatin(c: string | undefined): boolean {
  return c !== undefined && c >= "a" && c <= "z";
}

/**
 * The transcript (or a label) as tokens: whitespace made spaces, invisible characters removed
 * (`stripInvisible`, then the joiners too, so a word matches its plain spelling), `normaliseArabic`,
 * split on spaces; a hyphen between two Latin letters splits (`twenty-five`); a minus sign before
 * digits stays.
 */
export function spokenTokens(text: string): string[] {
  if (typeof text !== "string" || text === "") return [];
  let clean = text.toWellFormed();
  // Whitespace (a newline or tab included) becomes a space before control characters are removed,
  // so removing them never glues two words together. `normaliseArabic` applies NFKC.
  if (INVISIBLE_OR_JOINER.test(clean)) clean = stripInvisible(clean.replace(WHITESPACE, " ")).replace(ZW_JOINERS, "");
  let norm = normaliseArabic(clean);
  if (norm.includes("-")) {
    let out = "";
    for (let i = 0; i < norm.length; i++) {
      const c = norm[i]!;
      out += c === "-" && isLatin(norm[i - 1]) && isLatin(norm[i + 1]) ? " " : c;
    }
    norm = out;
  }
  if (norm === "") return [];
  const tokens = norm.split(" ");
  return tokens.includes("") ? tokens.filter((t) => t !== "") : tokens;
}

// ---------------------------------------------------------------------------------------------
// Words

type Kind = "unit" | "ten" | "teen" | "tens" | "hundreds" | "hundredWord" | "teenSuffix" | "scale";
type Lang = "ar" | "en";
type Form = "one" | "dual" | "plural" | "en";
/**
 * `short`: a short unit (`خمس`, `تلات`) counts only before what it counts (plural scale, `مية`,
 * `عشر`, a unit word); `preTeen` (`احد`, `اثنا`) only before `عشر`; `ashar` is `عشر`, `ashara` is `عشرة`;
 * `article` is English `a` before hundred, thousand or million.
 */
type Cond = "short" | "preTeen" | "ashar" | "ashara" | "article";
type Word = { kind: Kind; value: number; lang: Lang; form?: Form; cond?: Cond };

const WORDS = new Map<string, Word>();
function add(spellings: string[], word: Word): void {
  for (const s of spellings) WORDS.set(normaliseArabic(s), word);
}

const AR_UNITS: [string[], number][] = [
  [["واحد", "واحدة"], 1],
  [["اتنين", "اثنين", "اثنان", "تنين", "ثنين"], 2],
  [["تلاتة", "ثلاثة"], 3],
  [["أربعة"], 4],
  [["خمسة"], 5],
  [["ستة"], 6],
  [["سبعة"], 7],
  [["تمانية", "ثمانية", "تمنية", "ثمنية"], 8],
  [["تسعة"], 9],
];
for (const [s, v] of AR_UNITS) add(s, { kind: "unit", value: v, lang: "ar" });
const AR_SHORT: [string[], number][] = [
  [["ثلاث", "تلات", "تلت"], 3],
  [["أربع"], 4],
  [["خمس"], 5],
  [["ست"], 6],
  [["سبع"], 7],
  [["ثمان", "تمان", "تمن", "ثمن"], 8],
  [["تسع"], 9],
];
for (const [s, v] of AR_SHORT) add(s, { kind: "unit", value: v, lang: "ar", cond: "short" });
add(["أحد"], { kind: "unit", value: 1, lang: "ar", cond: "preTeen" });
add(["اثنا", "اثني"], { kind: "unit", value: 2, lang: "ar", cond: "preTeen" });
add(["عشر"], { kind: "ten", value: 10, lang: "ar", cond: "ashar" });
add(["عشرة"], { kind: "ten", value: 10, lang: "ar", cond: "ashara" });
const AR_TEENS: [string[], number][] = [
  [["حداشر", "احداشر", "احدعشر", "إحدعشر", "حدعش", "احدعش"], 11],
  [["اتناشر", "اطناشر", "اثناعشر", "اثنعش", "ثنعش"], 12],
  [["تلاتاشر", "تلتاشر", "ثلاثطعش", "ثلطعش", "ثلاثتعش"], 13],
  [["أربعتاشر", "اربعطعش", "اربعتعش"], 14],
  [["خمستاشر", "خمسطعش", "خمستعش"], 15],
  [["ستاشر", "سطاشر", "ستطعش", "سطعش"], 16],
  [["سبعتاشر", "سبعطعش", "سبعتعش"], 17],
  [["تمنتاشر", "تمانتاشر", "ثمنطعش", "ثمانطعش", "ثمنتعش"], 18],
  [["تسعتاشر", "تسعطعش", "تسعتعش"], 19],
];
for (const [s, v] of AR_TEENS) add(s, { kind: "teen", value: v, lang: "ar" });
const AR_TENS: [string[], number][] = [
  [["عشرين", "عشرون"], 20],
  [["تلاتين", "ثلاثين", "ثلاثون"], 30],
  [["أربعين", "أربعون"], 40],
  [["خمسين", "خمسون"], 50],
  [["ستين", "ستون"], 60],
  [["سبعين", "سبعون"], 70],
  [["تمانين", "ثمانين", "ثمانون"], 80],
  [["تسعين", "تسعون"], 90],
];
for (const [s, v] of AR_TENS) add(s, { kind: "tens", value: v, lang: "ar" });
const HUNDRED_SUFFIXES = ["مية", "مائة", "مئة", "ماية"];
add(HUNDRED_SUFFIXES, { kind: "hundredWord", value: 100, lang: "ar" });
add(["ميتين", "مائتين", "مئتين", "مايتين", "متين", "مائتان", "مئتان"], { kind: "hundreds", value: 200, lang: "ar" });
const HUNDRED_PREFIXES: [string[], number][] = [
  [["تلت", "تلات", "ثلاث", "ثلث"], 3],
  [["ربع", "أربع"], 4],
  [["خمس"], 5],
  [["ست"], 6],
  [["سبع"], 7],
  [["تمن", "تمان", "ثمان", "ثمن"], 8],
  [["تسع"], 9],
];
for (const [prefixes, v] of HUNDRED_PREFIXES) {
  add(prefixes.flatMap((p) => HUNDRED_SUFFIXES.map((s) => p + s)), { kind: "hundreds", value: v * 100, lang: "ar" });
}
add(["ألف"], { kind: "scale", value: 1000, lang: "ar", form: "one" });
add(["ألفين", "ألفان"], { kind: "scale", value: 1000, lang: "ar", form: "dual" });
add(["آلاف", "تلاف", "ألاف"], { kind: "scale", value: 1000, lang: "ar", form: "plural" });
add(["مليون"], { kind: "scale", value: 1_000_000, lang: "ar", form: "one" });
add(["مليونين", "مليونان"], { kind: "scale", value: 1_000_000, lang: "ar", form: "dual" });
add(["ملايين"], { kind: "scale", value: 1_000_000, lang: "ar", form: "plural" });

const EN_UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
EN_UNITS.forEach((w, i) => add([w], { kind: "unit", value: i + 1, lang: "en" }));
add(["ten"], { kind: "ten", value: 10, lang: "en" });
const EN_TEENS = ["eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
EN_TEENS.forEach((w, i) => add([w], { kind: "teen", value: i + 11, lang: "en" }));
const EN_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
EN_TENS.forEach((w, i) => add([w], { kind: "tens", value: (i + 2) * 10, lang: "en" }));
add(["hundred"], { kind: "hundredWord", value: 100, lang: "en" });
add(["thousand"], { kind: "scale", value: 1000, lang: "en", form: "en" });
add(["million"], { kind: "scale", value: 1_000_000, lang: "en", form: "en" });
add(["a"], { kind: "unit", value: 1, lang: "en", cond: "article" });

const W = (s: string) => normaliseArabic(s);
const WAW = W("و");
const HALF_WORDS = new Set([W("نص"), W("نصف")]);
const AND = "and";
const SHORT_NEXT = new Set([...["آلاف", "تلاف", "ألاف", "ملايين", "عشر", "عشرة", ...HUNDRED_SUFFIXES].map(W), ...UNIT_WORDS]);
const TEEN_NEXT = new Set([W("عشر"), W("عشرة")]);
const ASHAR_TEN_NEXT = new Set([...["آلاف", "تلاف", "ألاف", "ملايين"].map(W), ...UNIT_WORDS]);
const ARTICLE_NEXT = new Set(["hundred", "thousand", "million"]);

// ---------------------------------------------------------------------------------------------
// Atoms: one number word or digit token, or a half, with whether a `و`/`and` joins it to the one before.

type Atom =
  | { kind: Kind; value: number; lang: Lang; form?: Form; joined: boolean; start: number; end: number }
  | { kind: "digits"; value: number; fraction: "none" | "half"; lang: "d"; joined: boolean; start: number; end: number }
  | { kind: "half" | "bad"; value: 0; lang: "x"; joined: boolean; start: number; end: number };

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}
function allDigits(s: string): boolean {
  if (s === "") return false;
  for (let i = 0; i < s.length; i++) if (!isDigit(s[i])) return false;
  return true;
}

/**
 * A digit token: plain digits, or groups of three after a first group of 1 to 3 (the grouping
 * rule of `parseAmount`), then an optional `.` fraction that is zero or a half (`.5`, `.50`).
 * Null when the token holds no digit; `bad` when it holds one but is not such a number, or is
 * beyond `Number.MAX_SAFE_INTEGER`.
 */
function readDigitToken(t: string): { value: number; fraction: "none" | "half" } | "bad" | null {
  let any = false;
  for (let i = 0; i < t.length && !any; i++) any = isDigit(t[i]);
  if (!any) return null;
  const dot = t.indexOf(".");
  if (dot !== t.lastIndexOf(".")) return "bad";
  const whole = dot < 0 ? t : t.slice(0, dot);
  const fraction = dot < 0 ? "" : t.slice(dot + 1);
  if (dot >= 0 && !allDigits(fraction)) return "bad";
  let digits: string;
  if (whole.includes(",")) {
    const groups = whole.split(",");
    const head = groups[0]!;
    if (!allDigits(head) || head.length > 3 || head[0] === "0") return "bad";
    for (let g = 1; g < groups.length; g++) if (groups[g]!.length !== 3 || !allDigits(groups[g]!)) return "bad";
    digits = groups.join("");
  } else {
    if (!allDigits(whole)) return "bad";
    digits = whole;
  }
  let half: boolean;
  if (fraction === "" || /^0+$/.test(fraction)) half = false;
  else if (fraction === "5" || fraction === "50") half = true;
  else return "bad";
  let start = 0;
  while (start < digits.length - 1 && digits[start] === "0") start++;
  const significant = digits.slice(start);
  if (significant.length > 16 || BigInt(significant) > MAX_SAFE) return "bad";
  return { value: Number(significant), fraction: half ? "half" : "none" };
}

/** The word a token names, with a leading `و` taken as a joiner when the whole token is not a word. */
function lookup(t: string | undefined): { word: Word; joined: boolean } | null {
  if (t === undefined) return null;
  const whole = WORDS.get(t);
  if (whole) return { word: whole, joined: false };
  if (t.length > 1 && t.startsWith(WAW)) {
    const rest = WORDS.get(t.slice(WAW.length));
    if (rest) return { word: rest, joined: true };
  }
  return null;
}

/** The half at token `k` (`ونص`, `و نص`, `and a half`, `and half`) and how many tokens it spans. */
function halfAt(tokens: string[], k: number, to: number): number {
  const t = tokens[k]!;
  if (t.startsWith(WAW) && HALF_WORDS.has(t.slice(WAW.length))) return 1;
  if (t === WAW && k + 1 < to && HALF_WORDS.has(tokens[k + 1]!)) return 2;
  if (t === AND && k + 1 < to && tokens[k + 1] === "half") return 2;
  if (t === AND && k + 2 < to && tokens[k + 1] === "a" && tokens[k + 2] === "half") return 3;
  return 0;
}

function atomAt(tokens: string[], k: number, from: number, to: number): Atom | null {
  const t = tokens[k]!;
  const joinedDigits = t.length > 1 && t.startsWith(WAW) && isDigit(t[WAW.length]);
  const d = readDigitToken(joinedDigits ? t.slice(WAW.length) : t);
  if (d === "bad") return { kind: "bad", value: 0, lang: "x", joined: false, start: k, end: k + 1 };
  if (d !== null) return { kind: "digits", value: d.value, fraction: d.fraction, lang: "d", joined: joinedDigits, start: k, end: k + 1 };

  const found = lookup(t);
  if (!found) return null;
  const { word, joined } = found;
  const next = k + 1 < to ? tokens[k + 1]! : undefined;
  let kind: Kind = word.kind;
  switch (word.cond) {
    case "short":
      if (next === undefined || !SHORT_NEXT.has(next)) return null;
      break;
    case "preTeen":
      if (next === undefined || !TEEN_NEXT.has(next)) return null;
      break;
    case "article":
      if (joined || next === undefined || !ARTICLE_NEXT.has(next)) return null;
      break;
    case "ashar":
    case "ashara": {
      const prev = k - 1 >= from ? lookup(tokens[k - 1]) : null;
      if (!joined && prev !== null && prev.word.kind === "unit" && prev.word.lang === "ar") kind = "teenSuffix";
      else if (word.cond === "ashar" && (next === undefined || !ASHAR_TEN_NEXT.has(next))) return null;
      break;
    }
  }
  return { kind, value: word.value, lang: word.lang, form: word.form, joined, start: k, end: k + 1 };
}

// ---------------------------------------------------------------------------------------------
// Grammar over one run of atoms

type Parsed = { value: number; half: boolean; next: number; pureDigits: boolean; digits: boolean };
type Part = { value: number; next: number };

/** A half after a round hundred or a scale (`ألف ونص` is 1500 in speech, `مية ونص` 150) is ambiguous. */
function ambiguousHalf(value: number): boolean {
  return value >= 100 && value % 100 === 0;
}

function wordAtom(a: Atom | undefined, lang: Lang): (Atom & { kind: Kind }) | null {
  return a !== undefined && a.lang === lang ? (a as Atom & { kind: Kind }) : null;
}

/** 1 to 99: Arabic `خمسة وعشرين` (units before tens), `خمس عشر`, a teen, tens, ten; English `twenty five`. */
function below100(run: Atom[], p: number, lang: Lang): Part | null {
  const a = wordAtom(run[p], lang);
  if (a === null) return null;
  const b = wordAtom(run[p + 1], lang);
  if (a.kind === "teen" || a.kind === "ten") return { value: a.value, next: p + 1 };
  if (lang === "ar") {
    if (a.kind === "unit") {
      if (b !== null && b.kind === "teenSuffix" && !b.joined) return { value: 10 + a.value, next: p + 2 };
      if (b !== null && b.kind === "tens" && b.joined) return { value: a.value + b.value, next: p + 2 };
      return { value: a.value, next: p + 1 };
    }
    if (a.kind === "tens") return { value: a.value, next: p + 1 };
    return null;
  }
  if (a.kind === "unit") return { value: a.value, next: p + 1 };
  if (a.kind === "tens") {
    if (b !== null && b.kind === "unit" && !b.joined) return { value: a.value + b.value, next: p + 2 };
    return { value: a.value, next: p + 1 };
  }
  return null;
}

/** 1 to 999: hundreds, then (joined by `و`; in English `and` is optional) the part below 100. */
function small(run: Atom[], p: number, lang: Lang): Part | null {
  const a = wordAtom(run[p], lang);
  if (a === null) return null;
  const b = wordAtom(run[p + 1], lang);
  let hundreds = 0;
  let j = p;
  if (a.kind === "hundreds") {
    hundreds = a.value;
    j = p + 1;
  } else if (a.kind === "unit" && b !== null && b.kind === "hundredWord" && !b.joined && (lang === "en" || a.value >= 3)) {
    hundreds = a.value * 100;
    j = p + 2;
  } else if (a.kind === "hundredWord") {
    hundreds = 100;
    j = p + 1;
  }
  if (hundreds === 0) return below100(run, p, lang);
  const rest = wordAtom(run[j], lang);
  if (rest !== null && (lang === "en" || rest.joined)) {
    const r = below100(run, j, lang);
    if (r !== null) return { value: hundreds + r.value, next: r.next };
  }
  return { value: hundreds, next: j };
}

/**
 * The value of `count` (or no count) of a scale word. Arabic agreement: `ألف`/`مليون` alone or after
 * 11 to 999, `ألفين` alone, `آلاف`/`ملايين` after 3 to 10. English: alone or after 1 to 999.
 */
function scaled(count: number | null, scale: Atom & { kind: Kind }): number | null {
  const s = scale.value;
  switch (scale.form) {
    case "en":
      return count === null ? s : count >= 1 && count <= 999 ? count * s : null;
    case "dual":
      return count === null ? 2 * s : null;
    case "one":
      return count === null ? s : count >= 11 && count <= 999 ? count * s : null;
    case "plural":
      return count !== null && count >= 3 && count <= 10 ? count * s : null;
    default:
      return null;
  }
}

/** One group: `[count] scale` or a small number (scale 1). Its scale must be below `lastScale`. */
function group(run: Atom[], p: number, lang: Lang, lastScale: number): { value: number; scale: number; next: number; digits: boolean } | null {
  const a = run[p];
  if (a === undefined) return null;
  let count: Part | null = null;
  let digits = false;
  if (a.kind === "digits") {
    if (a.fraction !== "none") return null;
    count = { value: a.value, next: p + 1 };
    digits = true;
  } else {
    count = small(run, p, lang);
  }
  const sAt = count === null ? p : count.next;
  const s = wordAtom(run[sAt], lang);
  if (s !== null && s.kind === "scale" && (count === null || !s.joined)) {
    if (s.value >= lastScale) return null;
    const v = scaled(count?.value ?? null, s);
    return v === null ? null : { value: v, scale: s.value, next: sAt + 1, digits };
  }
  if (count === null || lastScale <= 1) return null;
  if (digits && (count.value < 1 || count.value > 999)) return null;
  return { value: count.value, scale: 1, next: count.next, digits };
}

/** The groups after the first, each of a smaller scale (in Arabic each joined by `و`), then a half. */
function rest(run: Atom[], idx: number, total: number, lastScale: number, lang: Lang, digits: boolean): Parsed | null {
  while (idx < run.length && lastScale > 1) {
    const a = run[idx]!;
    if (a.kind === "half" || a.kind === "bad") break;
    if (lang === "ar" && !a.joined) break;
    const g = group(run, idx, lang, lastScale);
    if (g === null) break;
    total += g.value;
    lastScale = g.scale;
    idx = g.next;
    digits ||= g.digits;
  }
  if (!Number.isSafeInteger(total)) return null;
  if (run[idx]?.kind === "half") {
    if (ambiguousHalf(total)) return null;
    return { value: total, half: true, next: idx + 1, pureDigits: false, digits };
  }
  return { value: total, half: false, next: idx, pureDigits: false, digits };
}

function parseNumber(run: Atom[], i: number): Parsed | null {
  const first = run[i]!;
  if (first.lang === "x") return null; // a half or an unreadable token cannot start a number
  if (first.lang === "d") {
    const s = run[i + 1];
    if (s !== undefined && s.kind === "scale" && !s.joined) {
      if (first.fraction !== "none") return null;
      const v = scaled(first.value, s);
      return v === null ? null : rest(run, i + 2, v, s.value, s.lang, true);
    }
    let half = first.fraction === "half";
    let next = i + 1;
    if (run[next]?.kind === "half") {
      if (half || ambiguousHalf(first.value)) return null;
      half = true;
      next += 1;
    }
    return { value: first.value, half, next, pureDigits: true, digits: true };
  }
  const lang = first.lang;
  const g = group(run, i, lang, Infinity);
  return g === null ? null : rest(run, g.next, g.value, g.scale, lang, g.digits);
}

/**
 * A run becomes numbers left to right. After a complete digit number, or before a digit token, the
 * next number starts (`300 و 500` is two numbers). Anything else left over makes the rest of the run
 * one bad run.
 */
function parseRun(run: Atom[], numbers: NumberToken[], bad: BadRun[]): void {
  let i = 0;
  while (i < run.length) {
    const p = parseNumber(run, i);
    const ok = p !== null && (p.next === run.length || p.pureDigits || run[p.next]!.kind === "digits");
    if (!ok) {
      bad.push({ start: run[i]!.start, end: run[run.length - 1]!.end });
      return;
    }
    numbers.push({ start: run[i]!.start, end: run[p.next - 1]!.end, value: p.value, half: p.half, digits: p.digits });
    i = p.next;
  }
}

/**
 * Numbers and bad runs in `tokens[from..to)`. A run is a sequence of number atoms side by side or
 * joined by a `و`/`and` token, with a half at its end (a unit word just before the half is skipped).
 */
export function scanNumbers(tokens: string[], from = 0, to = tokens.length): { numbers: NumberToken[]; bad: BadRun[] } {
  const numbers: NumberToken[] = [];
  const bad: BadRun[] = [];
  let run: Atom[] = [];
  let pendingJoin = false;
  const flush = () => {
    if (run.length > 0) parseRun(run, numbers, bad);
    run = [];
    pendingJoin = false;
  };
  let k = from;
  while (k < to) {
    const h = halfAt(tokens, k, to);
    if (h > 0) {
      run.push({ kind: "half", value: 0, lang: "x", joined: true, start: k, end: k + h });
      pendingJoin = false;
      k += h;
      continue;
    }
    const a = atomAt(tokens, k, from, to);
    if (a !== null) {
      if (pendingJoin) a.joined = true;
      pendingJoin = false;
      run.push(a);
      k += 1;
      continue;
    }
    const t = tokens[k]!;
    if ((t === WAW || t === AND) && k + 1 < to && atomAt(tokens, k + 1, from, to) !== null) {
      pendingJoin = true;
      k += 1;
      continue;
    }
    if (run.length > 0 && UNIT_WORDS.has(t) && k + 1 < to && halfAt(tokens, k + 1, to) > 0) {
      k += 1;
      continue;
    }
    flush();
    k += 1;
  }
  flush();
  return { numbers, bad };
}

/** Every clean number in `tokens` (from `spokenTokens`). A run that is not a clean number gives none. */
export function readNumbers(tokens: string[]): NumberToken[] {
  return scanNumbers(tokens).numbers;
}
