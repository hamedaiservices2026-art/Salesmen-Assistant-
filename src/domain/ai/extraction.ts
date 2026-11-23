// A model's extraction reply turned into a close draft. The reply is untrusted: it is checked by a
// strict schema, mapped to an allow-list of keys, and every value is read by `parseAmount` and the
// magnitude caps. Nothing is defaulted to 0, summed or derived. Pure.
import { z } from "zod";
import type { ISODate } from "@/domain/calendar";
import { maxAmountFor, parseAmount, type Unit } from "@/domain/money";
import { draftKeys, lineKey, LOW_CONFIDENCE, type CloseDraft, type DraftField, type DraftKey, type DraftLine, type DraftProblem } from "./draft";

export const ExtractionSchema = z
  .object({
    reportDate: z.string().max(10).nullable().optional(),
    fields: z
      .array(z.object({ key: z.string().max(80), value: z.string().max(40), confidence: z.number().optional() }).strict())
      .max(40),
  })
  .strict();

export type ValueReading = { ok: true; value: number } | { ok: false; problem: "negative" | "too_large" | "unreadable" };

const MINUS = /^[-−]/;
const NOT_DIGIT = /[^0-9]/g;
const LEADING_ZEROS = /^0+/;
// Whitespace other than U+0020, U+00A0 and U+202F (tab, newline, other Unicode spaces; R72).
const OTHER_WHITESPACE = /[^\S \u00A0\u202F]/;
const SEPARATOR = /[,٬ \u00A0\u202F]/g;
// Above this many significant digits a value is beyond every cap; BigInt is not needed to know it.
const LONGEST_COMPARED = 20;

function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Reads one value text in `unit`, in the order of R31: (1) sign, (2) magnitude of the integer part
 * against `maxAmountFor(unit)` as a BigInt (so a value beyond the safe integers is `too_large`, not
 * unreadable), (3) `parseAmount`. A text without digits skips (2) and is unreadable at (3).
 * Before (3), whitespace other than space, NBSP and NNBSP, and an integer part mixing separator
 * types (`1,140 500`), are unreadable (R72); `parseAmount` itself is unchanged.
 */
export function readValue(text: string, unit: Unit): ValueReading {
  if (MINUS.test(text.trim())) return { ok: false, problem: "negative" };

  const cap = maxAmountFor(unit);
  const western = westernDigits(text).replace(/٫/g, ".");
  const dot = western.indexOf(".");
  const integerPart = dot < 0 ? western : western.slice(0, dot);
  const digits = integerPart.replace(NOT_DIGIT, "").replace(LEADING_ZEROS, "");
  const hasDigits = /[0-9]/.test(western);
  if (hasDigits && digits !== "") {
    if (digits.length > LONGEST_COMPARED) return { ok: false, problem: "too_large" };
    const magnitude = BigInt(digits) * (unit === "value" ? BigInt(100) : BigInt(1));
    if (magnitude > BigInt(cap)) return { ok: false, problem: "too_large" };
  }

  // R72: stricter than typed input, before parseAmount: no other whitespace, one separator type.
  if (OTHER_WHITESPACE.test(text)) return { ok: false, problem: "unreadable" };
  const trimmed = western.trim();
  const trimmedDot = trimmed.indexOf(".");
  const separators = new Set((trimmedDot < 0 ? trimmed : trimmed.slice(0, trimmedDot)).match(SEPARATOR) ?? []);
  if (separators.size > 1) return { ok: false, problem: "unreadable" };

  const value = parseAmount(text, unit);
  if (value === null) return { ok: false, problem: "unreadable" };
  // The fraction can still push a value line over the cap (integer part at the cap, then `.01`).
  if (value > cap) return { ok: false, problem: "too_large" };
  if (!Number.isSafeInteger(value) || value < 0) return { ok: false, problem: "unreadable" };
  return { ok: true, value };
}

function cutKey(key: string): string {
  return Array.from(key).slice(0, 40).join("");
}

function confidenceOf(c: number | undefined): number {
  if (typeof c !== "number" || !Number.isFinite(c)) return 0;
  return Math.min(1, Math.max(0, c));
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written `YYYY-MM-DD` (Western digits only) in the years 2000-2100 (R72), else null. */
function realDate(s: string | null | undefined): ISODate | null {
  if (typeof s !== "string") return null;
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d <= daysInMonth ? s : null;
}

/**
 * The extraction reply as a draft, or null when the reply does not match `ExtractionSchema`.
 * A key outside `draftKeys(lines)` is dropped as `unknown_key`; `collections` names the company's
 * only collection line when it has exactly one. A key read twice keeps its first valid reading,
 * marked low, and reports each later different reading as `duplicate`.
 */
export function toDraft(raw: unknown, ctx: { source: "photo" | "voice"; date: ISODate; lines: DraftLine[] }): CloseDraft | null {
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) return null;

  const allowed = new Map<string, Unit>(draftKeys(ctx.lines).map((k) => [k.key, k.unit]));
  const collectionLines = ctx.lines.filter((l) => l.kind === "collection");
  const resolve = (key: string): DraftKey | null => {
    if (key === "collections" && collectionLines.length === 1) {
      const k = lineKey(collectionLines[0]!.code);
      return allowed.has(k) ? k : null;
    }
    return allowed.has(key) ? (key as DraftKey) : null;
  };

  const fields = new Map<DraftKey, DraftField>();
  const readings = new Map<DraftKey, number>(); // how many entries named the key
  const disagreed = new Set<DraftKey>();
  const problems: { key: string; problem: DraftProblem }[] = [];

  for (const entry of parsed.data.fields) {
    const key = resolve(entry.key);
    if (key === null) {
      problems.push({ key: cutKey(entry.key), problem: "unknown_key" });
      continue;
    }
    readings.set(key, (readings.get(key) ?? 0) + 1);
    const reading = readValue(entry.value, allowed.get(key)!);
    if (!reading.ok) {
      problems.push({ key: cutKey(key), problem: reading.problem });
      if ((readings.get(key) ?? 0) > 1 || fields.has(key)) disagreed.add(key);
      continue;
    }
    const kept = fields.get(key);
    if (kept === undefined) {
      if ((readings.get(key) ?? 0) > 1) disagreed.add(key); // an earlier reading was invalid
      const confidence = confidenceOf(entry.confidence);
      fields.set(key, { value: reading.value, confidence, low: confidence < LOW_CONFIDENCE, seenAs: entry.value });
    } else if (kept.value !== reading.value) {
      disagreed.add(key);
      problems.push({ key: cutKey(key), problem: "duplicate" });
    }
  }

  const out: CloseDraft["fields"] = {};
  for (const [key, f] of fields) out[key] = disagreed.has(key) ? { ...f, low: true } : f;

  const reportDate = realDate(parsed.data.reportDate);
  return {
    source: ctx.source,
    date: ctx.date,
    fields: out,
    problems,
    reportDate,
    dateMismatch: reportDate !== null && reportDate !== ctx.date,
  };
}
