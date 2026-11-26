/** Intl tag per language; Arabic uses ar-EG for Gregorian month names. Digits are always Western. */
export const INTL_TAG = { ar: "ar-EG", en: "en-GB", ur: "ur-PK" } as const;

/** A `YYYY-MM-DD` as the day and month in the rep's language (`12 November`, `12 نوفمبر`), Western digits; anything else as it is. */
export function dayMonth(iso: string, locale: keyof typeof INTL_TAG): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso) return iso;
  return new Intl.DateTimeFormat(`${INTL_TAG[locale] ?? "ar-EG"}-u-nu-latn`, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(t));
}
