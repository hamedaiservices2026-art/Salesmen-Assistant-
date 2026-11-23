// The day-close draft read from a photo or a voice note: its keys and its shape. Pure.
import type { ISODate } from "@/domain/calendar";
import { isDailyLine, type LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";

export const MONEY_KEYS = ["cashSales", "creditSales", "collections", "expenses"] as const;
export const STOCK_KEYS = ["loaded", "sold", "returned"] as const;
export type MoneyKey = (typeof MONEY_KEYS)[number];
export type StockKey = (typeof STOCK_KEYS)[number];
export type DraftKey = `line:${string}` | MoneyKey | StockKey;

/** A daily line of the company (coverage lines are never part of a draft). */
export type DraftLine = { lineId: string; code: string; unit: Unit; kind: LineKind };
/** One value read from the photo or voice note: the integer in the stored unit and the text it was read from. */
export type DraftField = { value: number; confidence: number; low: boolean; seenAs: string };
export type DraftProblem = "unknown_key" | "unreadable" | "negative" | "too_large" | "duplicate";

export type CloseDraft = {
  source: "photo" | "voice";
  date: ISODate;
  fields: Partial<Record<DraftKey, DraftField>>;
  /** `key` is cut to 40 characters. */
  problems: { key: string; problem: DraftProblem }[];
  reportDate: ISODate | null;
  dateMismatch: boolean;
};

export const LOW_CONFIDENCE = 0.8;

export function lineKey(code: string): DraftKey {
  return `line:${code}`;
}

/**
 * The keys a draft may hold: `line:<code>` for every daily line in its unit, the money keys in
 * value, the stock keys in cases. `collections` is left out when the company has a collection line
 * (collections is then the sum of those lines; R17).
 */
export function draftKeys(lines: DraftLine[]): { key: DraftKey; unit: Unit }[] {
  const out: { key: DraftKey; unit: Unit }[] = [];
  const seen = new Set<string>();
  const daily = lines.filter((l) => isDailyLine(l) && l.unit !== "outlets");
  for (const l of daily) {
    const key = lineKey(l.code);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, unit: l.unit });
  }
  const hasCollectionLine = daily.some((l) => l.kind === "collection");
  for (const key of MONEY_KEYS) {
    if (key === "collections" && hasCollectionLine) continue;
    out.push({ key, unit: "value" });
  }
  for (const key of STOCK_KEYS) out.push({ key, unit: "cases" });
  return out;
}

/**
 * A stable string naming what a draft was read against: the date and each daily line's code, unit
 * and kind (order and line ids ignored). Task 14 stores it with a draft and refuses a stored draft
 * whose key differs (a line changed unit, another date).
 */
export function draftContextKey(lines: DraftLine[], date: ISODate): string {
  const daily = lines
    .filter((l) => isDailyLine(l) && l.unit !== "outlets")
    .map((l) => [l.code, l.unit, l.kind])
    .sort((a, b) => (a.join("\u0000") < b.join("\u0000") ? -1 : a.join("\u0000") > b.join("\u0000") ? 1 : 0));
  return JSON.stringify([date, daily]);
}
