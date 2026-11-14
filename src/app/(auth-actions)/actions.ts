"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { LOCALE_COOKIE } from "@/i18n/config";
import { acceptInvite } from "@/server/auth/invites";
import { SESSION_COOKIE, SESSION_TTL_MS, destroySession, getSessionUser, signIn } from "@/server/auth/sessions";

export type AuthFormState = {
  error?: "weak_pin" | "mismatch" | "invite_invalid" | "invalid" | "locked";
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function startSession(sessionToken: string): Promise<void> {
  const jar = await cookies();
  const maxAge = SESSION_TTL_MS / 1000;
  jar.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  const ctx = await getSessionUser(await getDb(), sessionToken);
  if (ctx) {
    jar.set(LOCALE_COOKIE, ctx.locale, { sameSite: "lax", path: "/", maxAge });
  }
}

export async function acceptInviteAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const pin = text(form, "pin");
  if (pin !== text(form, "confirm")) return { error: "mismatch" };
  const result = await acceptInvite(await getDb(), text(form, "token"), pin);
  if (!result.ok) return { error: result.error === "weak_pin" ? "weak_pin" : "invite_invalid" };
  await startSession(result.sessionToken);
  redirect("/app");
}

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const result = await signIn(await getDb(), text(form, "login"), text(form, "pin"));
  if (!result.ok) return { error: result.error };
  await startSession(result.sessionToken);
  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(await getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}
