import { monthGrid, type ISODate } from "@/domain/calendar";
import type { DayMark } from "@/domain/pace";
import type { LineView } from "@/server/repos/month-view";

export type CalendarCell = { date: ISODate; day: number; mark: DayMark; amount: number | null };

/**
 * The screen-reader summary of a line's month: days at or above the daily pace and days below it,
 * or, for a line without a target (nothing to be above or below), the days with a recorded figure.
 */
export function calendarSummary(line: { target: number; days: { mark: DayMark }[] }): {
  key: "calendarSummary" | "calendarSummaryRecorded";
  values: Record<string, number>;
} {
  if (line.target <= 0) {
    return { key: "calendarSummaryRecorded", values: { recorded: line.days.filter((d) => d.mark === "recorded").length } };
  }
  return {
    key: "calendarSummary",
    values: {
      hit: line.days.filter((d) => d.mark === "hit").length,
      below: line.days.filter((d) => d.mark === "below").length,
    },
  };
}

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
