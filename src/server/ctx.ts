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
  /**
   * Set by `repCtx` to the caller's real role: this context reads one rep's figures on behalf of an
   * admin or supervisor. Reads accept it; every write on behalf of `userId` refuses it (`assertOwnContext`).
   */
  actingFor?: Role;
};
