import { todayIn, type ISODate } from "@/domain/calendar";

/** Today's date in the company's time zone. */
export function currentDay(timeZone: string): ISODate {
  return todayIn(timeZone);
}
