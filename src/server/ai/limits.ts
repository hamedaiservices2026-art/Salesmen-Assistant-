import type { AiKind } from "./config";

/** Daily AI requests per rep (decision 10). A failed request still counts. */
export const USER_DAY: Readonly<Record<AiKind, number>> = { vision: 20, stt: 30, chat: 50 };
/** AI requests per rep per minute (UTC minute). */
export const USER_MINUTE: Readonly<Record<AiKind, number>> = { vision: 3, stt: 5, chat: 6 };
/** Daily AI requests per company. */
export const COMPANY_DAY: Readonly<Record<AiKind, number>> = { vision: 200, stt: 300, chat: 500 };
/** Photo uploads per rep per day (Task 7). */
export const UPLOADS_USER_DAY = 40;

export type AiLimits = {
  userMinute: Readonly<Record<AiKind, number>>;
  userDay: Readonly<Record<AiKind, number>>;
  companyDay: Readonly<Record<AiKind, number>>;
};

/**
 * The per-rep and per-company limits `reserveAi` applies unless a test passes its own (R41). The
 * deployment-wide day and minute limits come from `AiConfig.globalDay` / `globalMinute` (R65).
 */
export const DEFAULT_LIMITS: AiLimits = { userMinute: USER_MINUTE, userDay: USER_DAY, companyDay: COMPANY_DAY };
