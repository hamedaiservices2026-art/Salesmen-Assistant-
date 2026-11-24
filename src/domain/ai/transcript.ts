// A voice-note transcript turned into extraction fields (the same shape a model's extraction reply
// has, so it goes through `toDraft`, which applies units and caps). A number goes to a label only
// when nothing else could claim it; ambiguous speech gives no field rather than a guess. Pure.
import type { Unit } from "@/domain/money";
import type { DraftKey } from "./draft";
import { isNumberToken, scanNumbers, spokenTokens, UNIT_WORDS } from "./spoken-numbers";
import { normaliseArabic } from "./normalise";

export const BEFORE_CONFIDENCE = 0.9;
export const AFTER_CONFIDENCE = 0.6;
/** Below LOW_CONFIDENCE (0.8), so the rep must check it: a half on money, or a second number after it (R76). */
export const SHAKY_CONFIDENCE = 0.5;

/** A correction or a decimal word after a label makes what follows it unreliable (R76). */
const CORRECTIONS = new Set([..."لا لأ قصدي اقصد أقصد بدل مش فاصلة فاصله".split(" ").map(normaliseArabic), "no", "point"]);

type Label = { tokens: string[]; keys: DraftKey[] };
type Item =
  | { t: "mention"; start: number; end: number; keys: DraftKey[] }
  | { t: "number"; start: number; end: number; value: number; half: boolean }
  | { t: "bad"; start: number; end: number };

/** Prefixes a spoken label may carry on its first word: `و` (and), `ال` (the), `وال`. */
const PREFIXES = ["و", "ال", "وال"];

function labelIndex(vocab: { key: DraftKey; labels: string[] }[]): Map<string, Label[]> {
  const byText = new Map<string, Label>();
  for (const entry of vocab) {
    for (const label of entry.labels) {
      const tokens = spokenTokens(label);
      // A label that reads as a number (a line named `مية`, a code `330`) cannot be told apart from
      // a number, so it is not used (R76).
      if (tokens.length === 0 || tokens.every(isNumberToken)) continue;
      const text = tokens.join(" ");
      const known = byText.get(text);
      if (known === undefined) byText.set(text, { tokens, keys: [entry.key] });
      else if (!known.keys.includes(entry.key)) known.keys.push(entry.key);
    }
  }
  const byFirst = new Map<string, Label[]>();
  for (const label of byText.values()) {
    const list = byFirst.get(label.tokens[0]!) ?? [];
    list.push(label);
    byFirst.set(label.tokens[0]!, list);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return byFirst;
}

/** The longest label starting at token `k` (its first word may carry a prefix), or null. */
function mentionAt(tokens: string[], k: number, byFirst: Map<string, Label[]>): Label | null {
  const t = tokens[k]!;
  let best = longestFrom(tokens, k, byFirst.get(t), null);
  for (const p of PREFIXES) {
    if (t.length > p.length && t.startsWith(p)) best = longestFrom(tokens, k, byFirst.get(t.slice(p.length)), best);
  }
  return best;
}

/** The longest label of `list` (sorted longest first) matching at `k`, when longer than `best`. */
function longestFrom(tokens: string[], k: number, list: Label[] | undefined, best: Label | null): Label | null {
  if (list === undefined) return best;
  for (const label of list) {
    const n = label.tokens.length;
    if (best !== null && n <= best.tokens.length) return best;
    if (k + n > tokens.length) continue;
    let same = true;
    for (let i = 1; i < n && same; i++) same = tokens[k + i] === label.tokens[i];
    if (same) return label;
  }
  return best;
}

/**
 * Reads a transcript against the company's vocabulary. Labels are found first (longest first, whole
 * tokens), then numbers between them (`scanNumbers`). A number goes to the label right before it
 * (only words that are neither a label nor a number between; confidence 0.9); the first thing said,
 * when it is a number followed by a label with only unit words between, goes to that label (0.6). A
 * label claimed by two numbers keeps neither; a run that is not a clean number claims like a number
 * but gives nothing. A label naming two keys gives nothing. A key given different numbers, or with
 * any mention claimed ambiguously, gives nothing. A half gives `.50` on a value key and drops a cases key. `unassigned` counts the numbers
 * and the unreadable runs that gave no field.
 */
export function parseSpokenClose(
  transcript: string,
  vocab: { key: DraftKey; unit: Unit; labels: string[] }[],
): { fields: { key: DraftKey; value: string; confidence: number }[]; unassigned: number } {
  const tokens = spokenTokens(transcript);
  const byFirst = labelIndex(vocab);
  const units = new Map<DraftKey, Unit>(vocab.map((e) => [e.key, e.unit]));

  const items: Item[] = [];
  const addNumbers = (from: number, to: number) => {
    if (from >= to) return;
    const { numbers, bad } = scanNumbers(tokens, from, to);
    const found: Item[] = [
      ...numbers.map((n) => ({ t: "number" as const, start: n.start, end: n.end, value: n.value, half: n.half })),
      ...bad.map((b) => ({ t: "bad" as const, start: b.start, end: b.end })),
    ];
    found.sort((a, b) => a.start - b.start);
    for (const it of found) items.push(it); // no spread: a hostile transcript can hold 100 000s of numbers
  };
  let gapStart = 0;
  for (let k = 0; k < tokens.length; ) {
    const m = mentionAt(tokens, k, byFirst);
    if (m === null) {
      k += 1;
      continue;
    }
    addNumbers(gapStart, k);
    items.push({ t: "mention", start: k, end: k + m.tokens.length, keys: m.keys });
    k += m.tokens.length;
    gapStart = k;
  }
  addNumbers(gapStart, tokens.length);

  // Candidates per mention: the number (or bad run) right after it, and the first item when it is a
  // number or bad run directly before a mention (unit words only between).
  const claims = new Map<number, { item: number; confidence: number }[]>();
  const claim = (mention: number, item: number, confidence: number) => {
    const list = claims.get(mention) ?? [];
    list.push({ item, confidence });
    claims.set(mention, list);
  };
  items.forEach((it, i) => {
    if (it.t === "mention") return;
    const prev = items[i - 1];
    if (prev?.t === "mention") {
      // Another number (or unreadable run) later in the same gap: the speaker may have corrected it.
      const after = items[i + 1];
      claim(i - 1, i, after !== undefined && after.t !== "mention" ? SHAKY_CONFIDENCE : BEFORE_CONFIDENCE);
      return;
    }
    const next = items[i + 1];
    if (i === 0 && next?.t === "mention") {
      let onlyUnits = true;
      for (let k = it.end; k < next.start && onlyUnits; k++) onlyUnits = UNIT_WORDS.has(tokens[k]!);
      if (onlyUnits) claim(i + 1, i, AFTER_CONFIDENCE);
    }
  });

  // A key is spoiled when any of its mentions was claimed ambiguously (two claims, an unreadable run,
  // or a label naming several keys): then it gives no field at all, even from another mention.
  const byKey = new Map<DraftKey, { at: number; value: number; half: boolean; confidence: number }[]>();
  const spoiled = new Set<DraftKey>();
  for (const [mi, list] of claims) {
    const mention = items[mi] as Extract<Item, { t: "mention" }>;
    const it = items[list[0]!.item]!;
    if (list.length !== 1 || mention.keys.length !== 1 || it.t !== "number" || corrected(tokens, mention.end, nextMentionStart(items, mi, tokens.length))) {
      for (const key of mention.keys) spoiled.add(key);
      continue;
    }
    const key = mention.keys[0]!;
    const got = byKey.get(key) ?? [];
    got.push({ at: mention.start, value: it.value, half: it.half, confidence: list[0]!.confidence });
    byKey.set(key, got);
  }

  const fields: { key: DraftKey; value: string; confidence: number; at: number }[] = [];
  let used = 0;
  for (const [key, got] of byKey) {
    if (spoiled.has(key)) continue;
    const first = got[0]!;
    if (!got.every((g) => g.value === first.value && g.half === first.half)) continue;
    const unit = units.get(key);
    if (unit === undefined) continue;
    if (first.half && unit !== "value") continue;
    used += got.length;
    const confidence = got.reduce((low, g) => Math.min(low, g.confidence), 1);
    fields.push({
      key,
      value: String(first.value) + (first.half ? ".50" : ""),
      // A half on money is easy to mishear (`ونص` after a small number); the rep confirms it (R76).
      confidence: first.half ? Math.min(confidence, SHAKY_CONFIDENCE) : confidence,
      at: first.at,
    });
  }
  fields.sort((a, b) => a.at - b.at);
  const spoken = items.filter((it) => it.t !== "mention").length;
  return { fields: fields.map(({ key, value, confidence }) => ({ key, value, confidence })), unassigned: spoken - used };
}

function nextMentionStart(items: Item[], mi: number, end: number): number {
  for (let i = mi + 1; i < items.length; i++) if (items[i]!.t === "mention") return items[i]!.start;
  return end;
}

/** True when `tokens[from..to)` (a label's gap) holds a correction or decimal word, or "I mean". */
function corrected(tokens: string[], from: number, to: number): boolean {
  for (let k = from; k < to; k++) {
    const t = tokens[k]!;
    if (CORRECTIONS.has(t) || (t === "mean" && tokens[k - 1] === "i")) return true;
  }
  return false;
}
