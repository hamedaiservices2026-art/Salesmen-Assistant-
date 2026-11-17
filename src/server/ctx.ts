import type { Db } from "@/db/client";
import type { Locale } from "@/i18n/config";
import type { Role } from "@/server/auth/roles";

export type Ctx = {
  db: Db;
  companyId: string;
  userId: string;
  role: Role;
  locale: Locale;
  timeZone: string;
};
