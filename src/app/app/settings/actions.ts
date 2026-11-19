"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { changePin } from "@/server/auth/change-pin";
import { normalizePin } from "@/server/auth/pin";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { requireCtx } from "@/server/auth/guard";
import { setLocale } from "./locale";

export async function setLocaleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const value = form.get("locale");
  const result = await setLocale(ctx, typeof value === "string" ? value : "");
  if (result.ok) revalidatePath("/", "layout");
}

export type ChangePinState = { status?: "done"; error?: "invalid" | "locked" | "weak_pin" | "same" | "mismatch" };

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/**
 * Changes the signed-in rep's PIN. The session to keep is read from the request's cookie here;
 * nothing in the form can name it. The state returned never carries a PIN back to the page.
 */
export async function changePinAction(_prev: ChangePinState, form: FormData): Promise<ChangePinState> {
  const ctx = await requireCtx();
  const keepToken = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const newPin = text(form, "newPin");
  if (normalizePin(newPin) !== normalizePin(text(form, "confirm"))) return { error: "mismatch" };
  const result = await changePin(ctx, { currentPin: text(form, "currentPin"), newPin, keepToken });
  return result.ok ? { status: "done" } : { error: result.error };
}
