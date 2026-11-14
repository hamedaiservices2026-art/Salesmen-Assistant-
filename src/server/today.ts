import { todayIn, type ISODate } from "@/domain/calendar";

/**
 * Today's date in the company's time zone. `APP_TODAY` (YYYY-MM-DD) overrides it for demos and
 * screenshots; in production it is ignored unless `ALLOW_APP_TODAY` is `1`.
 */
export function currentDay(timeZone: string): ISODate {
  const override = process.env.APP_TODAY;
  const allowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_APP_TODAY === "1";
  if (override && allowed && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return todayIn(timeZone);
}
