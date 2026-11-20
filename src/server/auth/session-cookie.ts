import { cookies } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "@/i18n/config";
import { LAST_LOGIN_COOKIE } from "./last-login";
import type { Role } from "./roles";
import { SESSION_COOKIE, sessionCookieMaxAgeS } from "./sessions";

/** Not a server action: only server code that has just verified a sign-in may call it. */
export async function startSessionCookies(sessionToken: string, opts: { locale: Locale; role: Role; lastLogin?: string }): Promise<void> {
  const jar = await cookies();
  const maxAge = sessionCookieMaxAgeS(opts.role);
  const secure = process.env.NODE_ENV === "production";
  if (opts.lastLogin !== undefined) {
    // The username is not a secret; it only saves typing at the next sign-in.
    jar.set(LAST_LOGIN_COOKIE, opts.lastLogin, { sameSite: "lax", secure, path: "/", maxAge });
  }
  jar.set(SESSION_COOKIE, sessionToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
  jar.set(LOCALE_COOKIE, opts.locale, { sameSite: "lax", secure, path: "/", maxAge });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
