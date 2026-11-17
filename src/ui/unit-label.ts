import type { Currency, Unit } from "@/domain/money";

/** The word shown beside a figure: the unit name for cases and outlets, the company's currency for value. */
export function unitLabel(t: (key: string) => string, unit: Unit, currency: Currency): string {
  return unit === "value" ? t(`currency.${currency}`) : t(`home.unit.${unit}`);
}
