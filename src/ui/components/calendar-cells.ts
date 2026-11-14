import { monthGrid, type ISODate } from "@/domain/calendar";
import type { DayMark } from "@/domain/pace";
import type { LineView } from "@/server/repos/month-view";

export type CalendarCell = { date: ISODate; day: number; mark: DayMark; amount: number | null };

/** The month as grid cells for one line: leading nulls pad to the first weekday column. */
export function calendarCells(line: LineView, weekStartsOn: number): (CalendarCell | null)[] {
  const [first] = line.days;
  if (!first) return [];
  const [year, month] = first.date.split("-").map(Number) as [number, number];
  const byDate = new Map(line.days.map((d) => [d.date, d]));
  return monthGrid(year, month, weekStartsOn).map((date) => {
    if (date === null) return null;
    const d = byDate.get(date);
    return d ? { date, day: Number(date.slice(8)), mark: d.mark, amount: d.amount } : null;
  });
}
