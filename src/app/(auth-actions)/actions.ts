"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { currentCtx } from "@/server/auth/guard";
import { acceptInvite } from "@/server/auth/invites";
import { normalizePin } from "@/server/auth/pin";
import { PIN_ROLES, homeFor, type Role } from "@/server/auth/roles";
import { clearSessionCookie, startSessionCookies } from "@/server/auth/session-cookie";
import { SESSION_COOKIE, destroySession, getSessionUser, signIn } from "@/server/auth/sessions";

export type AuthFormState = {
  error?: "weak_pin" | "mismatch" | "invite_invalid" | "invalid" | "locked";
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function startSession(sessionToken: string, login: string): Promise<void> {
  const ctx = await getSessionUser(await getDb(), sessionToken);
  if (!ctx) return;
  await startSessionCookies(sessionToken, { locale: ctx.locale, role: ctx.role, lastLogin: login });
}

export async function acceptInviteAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const pin = text(form, "pin");
  if (normalizePin(pin) !== normalizePin(text(form, "confirm"))) return { error: "mismatch" };
  const result = await acceptInvite(await getDb(), text(form, "token"), pin);
  if (!result.ok) return { error: result.error === "weak_pin" ? "weak_pin" : "invite_invalid" };
  await startSession(result.sessionToken, result.login);
  redirect("/app");
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const result = await signIn(await getDb(), text(form, "login"), text(form, "pin"));
  if (!result.ok) return { error: result.error };
  await startSession(result.sessionToken, text(form, "login").trim().toLowerCase());
  redirect("/app");
}

/** Rep-app sign-out. An admin or owner session posted here is left alone and sent home. */
export async function signOutAction(): Promise<void> {
  const ctx = await currentCtx();
  if (ctx && !(PIN_ROLES as readonly Role[]).includes(ctx.role)) redirect(homeFor(ctx.role));
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(await getDb(), token);
  await clearSessionCookie();
  redirect("/signin");
}
