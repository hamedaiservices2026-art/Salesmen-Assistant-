"use server";

import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { setupFirstOwner } from "@/server/admin/setup";

export type SetupFormState = {
  error?: "refused" | "email" | "name";
  /** What was typed (never the setup token), so a refused form keeps its values. */
  values?: { email: string; name: string };
  /** Set once after success: the owner's `/admin/invite/<token>` path. Never logged. */
  invitePath?: string;
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/**
 * The one-time owner setup. While the feature is off (no `SETUP_TOKEN` of 32+ characters) or once
 * any owner exists it answers the same 404 as an unknown route. Next refuses a cross-origin call
 * (the Origin and Host headers must match) before this runs.
 */
export async function createFirstOwner(_prev: SetupFormState, form: FormData): Promise<SetupFormState> {
  const values = { email: text(form, "email"), name: text(form, "name") };
  const result = await setupFirstOwner(await getDb(), { token: text(form, "token"), ...values }, { env: process.env });
  switch (result.status) {
    case "closed":
      notFound();
    case "created":
      return { invitePath: result.invitePath };
    case "invalid":
      return { error: result.field, values };
    case "refused":
      return { error: "refused", values };
  }
}
