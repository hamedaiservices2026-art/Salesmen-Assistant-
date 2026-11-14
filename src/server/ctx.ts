import type { Db } from "@/db/client";
import type { Locale } from "@/i18n/config";

export type Ctx = {
  db: Db;
  companyId: string;
  userId: string;
  role: "rep" | "supervisor" | "admin" | "owner";
  locale: Locale;
  timeZone: string;
};
