import type { ISODate } from "@/domain/calendar";

/** `YYYY-MM` to numbers; null when malformed or later than `today`'s month. */
export function parseYm(
  ym: string,
  today: ISODate,
): { year: number; month: number } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) return null;
  if (ym > today.slice(0, 7)) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Whether the month is still running, so its commission is the figure so far and not final. */
export function isCurrentMonth(m: { year: number; month: number }, today: ISODate): boolean {
  return `${m.year}-${String(m.month).padStart(2, "0")}` === today.slice(0, 7);
}

export type DayRow<D extends { date: ISODate }> =
  | { kind: "day"; day: D }
  | { kind: "gap"; date: ISODate };

/**
 * Closed days plus past selling days with no close, newest first. A gap is a selling day strictly
 * before today and not before the rep's first confirmed close (`firstClose`); a rep with no
 * confirmed close has no gaps at all, so a new rep is not shown a month of missing days. Today
 * itself appears only when it has a close, and no future date appears.
 */
export function mergeDayRows<D extends { date: ISODate }>(
  closed: D[],
  selling: ISODate[],
  today: ISODate,
  firstClose: ISODate | null,
): DayRow<D>[] {
  const have = new Set(closed.map((d) => d.date));
  const rows: DayRow<D>[] = closed
    .filter((d) => d.date <= today)
    .map((day) => ({ kind: "day", day }));
  if (firstClose !== null)
    for (const date of selling)
      if (date < today && date >= firstClose && !have.has(date)) rows.push({ kind: "gap", date });
  return rows.sort((a, b) =>
    rowDate(b) < rowDate(a) ? -1 : rowDate(b) > rowDate(a) ? 1 : 0,
  );
}

function rowDate(r: DayRow<{ date: ISODate }>): ISODate {
  return r.kind === "day" ? r.day.date : r.date;
}
