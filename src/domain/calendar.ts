export type ISODate = string;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month: number, day: number): ISODate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Selling days of a month (month 1-12), ascending. Weekdays use getUTCDay numbering. */
export function sellingDays(
  year: number,
  month: number,
  weekdays: number[],
  holidays: ISODate[],
): ISODate[] {
  const off = new Set(holidays);
  const out: ISODate[] = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = iso(year, month, d);
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (weekdays.includes(wd) && !off.has(date)) out.push(date);
  }
  return out;
}

/** Every day of the month, with leading nulls so the first day lands in its weekday column. */
export function monthGrid(year: number, month: number, weekStartsOn: number): (ISODate | null)[] {
  const firstWd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (firstWd - weekStartsOn + 7) % 7;
  const grid: (ISODate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth(year, month); d++) grid.push(iso(year, month, d));
  return grid;
}

/** elapsed: selling days strictly before today; left: selling days on or after today. */
export function dayCounts(
  days: ISODate[],
  today: ISODate,
): { total: number; elapsed: number; left: number } {
  const elapsed = days.filter((d) => d < today).length;
  return { total: days.length, elapsed, left: days.length - elapsed };
}

/** "Selling day N of T" shown on the home and commission pages: selling days before today, plus one, capped at the total. Always fed the days-before-today counts (`dayCounts`), never the commission view's counts, which count a closed today as elapsed. */
export function sellingDayNumber(counts: { total: number; elapsed: number }): number {
  return Math.min(counts.elapsed + 1, counts.total);
}

/** Calendar date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
