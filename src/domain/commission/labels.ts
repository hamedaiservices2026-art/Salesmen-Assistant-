import type { Locale } from "@/i18n/config";
import type { Component } from "./types";

/** The component's label in the locale; the Arabic `label` when the chosen one is missing or empty. */
export function componentLabel(c: Component, locale: Locale): string {
  const chosen = locale === "en" ? c.labelEn : locale === "ur" ? c.labelUr : undefined;
  return chosen === undefined || chosen.trim() === "" ? c.label : chosen;
}
