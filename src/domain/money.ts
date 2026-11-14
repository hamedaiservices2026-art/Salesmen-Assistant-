export type Unit = "cases" | "value";

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cases: grouped integer. Value: halalas shown as SAR, decimals only when non-zero. */
export function formatAmount(amount: number, unit: Unit): string {
  if (unit === "cases") return group(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fracText = frac === 0 ? "" : "." + String(frac).padStart(2, "0").replace(/0$/, "");
  return `${sign}${group(whole)}${fracText}`;
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

/** Parses typed input to an integer (minor units for value). Null when invalid. */
export function parseAmount(input: string, unit: Unit): number | null {
  const cleaned = toWesternDigits(input)
    .replace(/[,٬\s ]/g, "")
    .replace(/٫/g, ".");
  const pattern = unit === "cases" ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(cleaned)) return null;
  let result: number;
  if (unit === "cases") {
    result = Number(cleaned);
  } else {
    const [whole, frac = ""] = cleaned.split(".");
    result = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }
  return Number.isSafeInteger(result) ? result : null;
}
