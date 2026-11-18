export type Unit = "cases" | "value" | "outlets";

/** Two-decimal currencies only, matching the 100-minor-unit rule. */
export const CURRENCIES = ["SAR", "AED", "QAR", "EGP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cases: grouped integer. Value: halalas shown as SAR; two decimals when the fraction is non-zero. */
export function formatAmount(amount: number, unit: Unit): string {
  if (unit !== "value") return group(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracText = frac === 0 ? "" : "." + String(frac).padStart(2, "0");
  return `${sign}${group(whole)}${fracText}`;
}

/** Plain text for pre-filling an input: no grouping, two decimals only when the fraction is non-zero. */
export function inputValue(amount: number, unit: Unit): string {
  return formatAmount(amount, unit).replace(/,/g, "");
}

/** Whole percent, floored. Denominator 0 gives an em dash. */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.floor((numerator * 100) / denominator)}%`;
}

function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const SEPARATORS = ",٬\\s\u00A0\u202F";
const GROUPED = new RegExp(`^[1-9]\\d{0,2}(?:[${SEPARATORS}]\\d{3})+$`);
const HAS_SEPARATOR = new RegExp(`[${SEPARATORS}]`);

/**
 * Parses typed input to an integer (minor units for value). Null when invalid.
 * A comma, `٬` or space is a thousands separator only: the first group has 1 to 3 digits and every
 * later group exactly 3 (`1,140`, `82٬800`). Anything else with one (`0,5`, `8250,50`, `1,14`) is
 * null, never silently read as a bigger number; `٫` is the Arabic decimal point.
 */
export function parseAmount(input: string, unit: Unit): number | null {
  const typed = toWesternDigits(input).trim().replace(/٫/g, ".");
  const dot = typed.indexOf(".");
  const whole = dot < 0 ? typed : typed.slice(0, dot);
  const rest = dot < 0 ? "" : typed.slice(dot);
  if (HAS_SEPARATOR.test(whole) && !GROUPED.test(whole)) return null;
  const cleaned = whole.replace(new RegExp(`[${SEPARATORS}]`, "g"), "") + rest;
  const pattern = unit !== "value" ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(cleaned)) return null;
  let result: number;
  if (unit !== "value") {
    result = Number(cleaned);
  } else {
    const [w, frac = ""] = cleaned.split(".");
    result = Number(w) * 100 + Number(frac.padEnd(2, "0"));
  }
  return Number.isSafeInteger(result) ? result : null;
}
