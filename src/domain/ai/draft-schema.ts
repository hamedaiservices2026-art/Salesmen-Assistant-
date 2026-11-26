// A close draft read back from the browser's storage (or from a reply) is untrusted: it is checked
// again here, field by field, before anything uses it. Pure.
import { z } from "zod";
import { LOW_CONFIDENCE, MONEY_KEYS, STOCK_KEYS, type CloseDraft } from "./draft";
import type { StoredSession } from "./draft-session";

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isoDate = z.string().refine(isRealDate);
const FIXED_KEYS: ReadonlySet<string> = new Set([...MONEY_KEYS, ...STOCK_KEYS]);
const LINE_KEY = /^line:[^\u0000-\u001f]{1,64}$/;
const isDraftKey = (k: string): boolean => FIXED_KEYS.has(k) || LINE_KEY.test(k);

const FieldSchema = z
  .object({
    value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    confidence: z.number().min(0).max(1),
    low: z.boolean(),
    seenAs: z.string().max(80),
  })
  .strict()
  // A field cannot claim to be confident when the confidence says otherwise.
  .refine((f) => f.low || f.confidence >= LOW_CONFIDENCE);

const DraftSchema = z
  .object({
    source: z.enum(["photo", "voice"]),
    date: isoDate,
    fields: z.record(z.string(), FieldSchema).refine((f) => Object.keys(f).length <= 60 && Object.keys(f).every(isDraftKey)),
    problems: z
      .array(z.object({ key: z.string().max(40), problem: z.enum(["unknown_key", "unreadable", "negative", "too_large", "duplicate"]) }).strict())
      .max(60),
    reportDate: isoDate.nullable(),
    dateMismatch: z.boolean(),
  })
  .strict();

/** The draft when it has exactly the shape `toDraft` produces, else null. Never throws. */
export function parseStoredDraft(raw: unknown): CloseDraft | null {
  try {
    // zod's record drops a "__proto__" key silently, so the raw keys are checked first.
    const fields = typeof raw === "object" && raw !== null ? (raw as { fields?: unknown }).fields : undefined;
    if (typeof fields === "object" && fields !== null && !Object.keys(fields).every(isDraftKey)) return null;
    const r = DraftSchema.safeParse(raw);
    return r.success ? (r.data as CloseDraft) : null;
  } catch {
    return null;
  }
}

const FIELD_NAME = /^[A-Za-z0-9._:-]{1,64}$/;
const BLOCKED_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const isFieldName = (k: string): boolean => FIELD_NAME.test(k) && !BLOCKED_NAMES.has(k);
const names = z.array(z.string().refine(isFieldName)).max(80);
const textMap = (max: number) => z.record(z.string(), z.string().max(max));

const SessionSchema = z
  .object({
    values: textMap(64),
    touched: names,
    acked: names,
    marks: z.record(z.string(), z.enum(["ai", "low"])),
    filled: textMap(64),
    replaced: textMap(64),
    skippedAdmin: textMap(64),
    missing: names,
    // A report dated another day seen earlier in this review (R84); absent in entries stored before it.
    dateMismatch: z.boolean().optional(),
    mismatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

/** Field-name keyed maps: every key a plain field name, at most 80, none a prototype key (zod's record drops `__proto__` silently, so raw keys are checked first). */
const mapKeysOk = (o: unknown): boolean => typeof o === "object" && o !== null && Object.keys(o).length <= 80 && Object.keys(o).every(isFieldName);

/** A stored review session (the rep's work with a draft), or null when it is not exactly what `toStored` makes. Never throws. */
export function parseStoredSession(raw: unknown): StoredSession | null {
  try {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!["values", "marks", "filled", "replaced", "skippedAdmin"].every((k) => mapKeysOk(o[k]))) return null;
    const r = SessionSchema.safeParse(raw);
    return r.success ? (r.data as StoredSession) : null;
  } catch {
    return null;
  }
}
