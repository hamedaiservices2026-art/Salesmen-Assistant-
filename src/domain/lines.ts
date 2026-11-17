import type { Locale } from "@/i18n/config";
import type { Unit } from "./money";

export type LineKind = "sales" | "collection" | "coverage";

export type LineShapeError =
  | "collection_needs_value"
  | "coverage_needs_outlets"
  | "outlets_only_for_coverage";

/** A collection line is always in value; a coverage line is always in outlets; outlets is only for coverage. */
export function lineShapeError(i: { unit: Unit; kind: LineKind }): LineShapeError | null {
  if (i.kind === "collection" && i.unit !== "value") return "collection_needs_value";
  if (i.kind === "coverage" && i.unit !== "outlets") return "coverage_needs_outlets";
  if (i.unit === "outlets" && i.kind !== "coverage") return "outlets_only_for_coverage";
  return null;
}

export function isLineCode(code: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(code);
}

/** The line's name in the locale; the Arabic name when the chosen one is empty. */
export function lineName(l: { nameAr: string; nameEn: string; nameUr: string }, locale: Locale): string {
  const chosen = locale === "en" ? l.nameEn : locale === "ur" ? l.nameUr : l.nameAr;
  return chosen.trim() === "" ? l.nameAr : chosen;
}

/** Lines shown on the daily screens; coverage lines are tracked on their own panel. */
export function isDailyLine(l: { kind: LineKind }): boolean {
  return l.kind !== "coverage";
}
