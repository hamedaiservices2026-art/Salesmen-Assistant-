// A close draft read back from the browser's storage (or from a reply) is untrusted: it is checked
// again here, field by field, before anything uses it. Pure.
import { z } from "zod";
import { LOW_CONFIDENCE, MONEY_KEYS, STOCK_KEYS, type CloseDraft } from "./draft";

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
