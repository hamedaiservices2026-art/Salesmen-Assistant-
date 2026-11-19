import type { Locale } from "@/i18n/config";

/** The focus item's name in the locale; the Arabic name when the chosen one is missing or blank. */
export function focusName(f: { name: string; nameEn: string | null; nameUr: string | null }, locale: Locale): string {
  const chosen = locale === "en" ? f.nameEn : locale === "ur" ? f.nameUr : f.name;
  return chosen === null || chosen.trim() === "" ? f.name : chosen;
}
