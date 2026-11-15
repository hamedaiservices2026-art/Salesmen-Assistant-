import type { ISODate } from "@/domain/calendar";
import type { Ctx } from "@/server/ctx";
import { loadCalendar } from "@/server/repos/month-data";

async function isSellingDay(ctx: Ctx, date: ISODate): Promise<boolean> {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return (await loadCalendar(ctx, year, month)).selling.includes(date);
}

export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * The day the screen records. A requested date counts only when it is a real, past selling day;
 * anything else falls back to today, which may itself not be a selling day.
 */
export async function resolveCloseDate(
  ctx: Ctx,
  today: ISODate,
  requested: string | undefined,
): Promise<{ date: ISODate; selling: boolean }> {
  if (requested && isRealDate(requested) && requested < today && (await isSellingDay(ctx, requested))) {
    return { date: requested, selling: true };
  }
  return { date: today, selling: await isSellingDay(ctx, today) };
}

/** Year and month of the day being recorded; today's month when the date is not a real date. */
export function closeMonth(date: string | null | undefined, today: ISODate): { year: number; month: number } {
  const [year, month] = (date && isRealDate(date) ? date : today).split("-").map(Number) as [number, number];
  return { year, month };
}

/** Focus items whose window contains the date. */
export function focusOn<T extends { startsOn: string; endsOn: string }>(items: T[], date: string): T[] {
  return items.filter((f) => f.startsOn <= date && date <= f.endsOn);
}
