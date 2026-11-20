"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { revalidatePath } from "next/cache";
import { setLocale } from "@/app/app/settings/locale";
import { currentCtx, requireRole } from "@/server/auth/guard";
import { acceptAdminInvite } from "@/server/auth/invites";
import { PASSWORD_ROLES, homeFor, type Role } from "@/server/auth/roles";
import { clearSessionCookie, startSessionCookies } from "@/server/auth/session-cookie";
import { SESSION_COOKIE, destroySession, getSessionUser, signInWithPassword } from "@/server/auth/sessions";

export type AdminAuthFormState = {
  error?: "weak_password" | "mismatch" | "invite_invalid" | "invalid" | "locked";
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** Sets the session and language cookies and returns the signed-in user's home. */
async function startAdminSession(sessionToken: string): Promise<string> {
  const ctx = await getSessionUser(await getDb(), sessionToken);
  if (!ctx) return "/admin/signin";
  // No last_login cookie: the rep sign-in page reads it, and an email does not belong there.
  await startSessionCookies(sessionToken, { locale: ctx.locale, role: ctx.role });
  return homeFor(ctx.role);
}

export async function adminSignInAction(_prev: AdminAuthFormState, form: FormData): Promise<AdminAuthFormState> {
  const result = await signInWithPassword(await getDb(), text(form, "email"), text(form, "password"));
  if (!result.ok) return { error: result.error };
  redirect(await startAdminSession(result.sessionToken));
}

export async function acceptAdminInviteAction(_prev: AdminAuthFormState, form: FormData): Promise<AdminAuthFormState> {
  const password = text(form, "password");
  if (password !== text(form, "confirm")) return { error: "mismatch" };
  const result = await acceptAdminInvite(await getDb(), text(form, "token"), password);
  if (!result.ok) return { error: result.error === "weak_password" ? "weak_password" : "invite_invalid" };
  redirect(await startAdminSession(result.sessionToken));
}

/** Admin sign-out. A rep or supervisor session posted here is left alone and sent home. */
export async function adminSignOutAction(): Promise<void> {
  const ctx = await currentCtx();
  if (ctx && !(PASSWORD_ROLES as readonly Role[]).includes(ctx.role)) redirect(homeFor(ctx.role));
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(await getDb(), token);
  await clearSessionCookie();
  redirect("/admin/signin");
}

/** The console's language select: saves the language on the signed-in admin's or owner's row and sets the cookie. */
export async function setAdminLocaleAction(form: FormData): Promise<void> {
  const ctx = await requireRole(["admin", "owner"]);
  const value = form.get("locale");
  const result = await setLocale(ctx, typeof value === "string" ? value : "");
  if (result.ok) revalidatePath("/", "layout");
}
