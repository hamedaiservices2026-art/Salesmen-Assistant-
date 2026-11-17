"use server";

import { revalidatePath } from "next/cache";
import { assignSupervisor, createUser, issueInvite, setActive, type NewUser } from "@/server/admin/users";
import { requireRole } from "@/server/auth/guard";
import { invitePath } from "@/server/auth/invites";

export type CreateUserState = {
  errors?: Record<string, string>;
  /** What the admin typed, so a refused form keeps its values. */
  values?: Record<string, string>;
  /** Set once after a successful create: the new user's invite link (shown once). */
  created?: { name: string; invitePath: string };
};

/** The result of a row action. `link` is the new invite link for `userId` (shown once). */
export type RowActionState = {
  error?: "not_found" | "self" | "last_admin";
  link?: { userId: string; invitePath: string };
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// Every action here takes only the form: the caller's company, role and id come from the session
// (`requireRole`), and each id in the form is checked against that company by the admin function.

export async function createUserAction(_prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  const ctx = await requireRole(["admin"]);
  const values = {
    name: text(form, "name"),
    login: text(form, "login"),
    role: text(form, "role"),
    supervisorId: text(form, "supervisorId"),
    locale: text(form, "locale"),
  };
  // createUser validates every field itself: a role or language outside its list comes back as an error.
  const result = await createUser(ctx, {
    name: values.name,
    login: values.login,
    role: values.role as NewUser["role"],
    supervisorId: values.supervisorId || null,
    locale: (values.locale || undefined) as NewUser["locale"],
  });
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/admin/users");
  return { created: { name: values.name.trim(), invitePath: invitePath(values.role as NewUser["role"], result.inviteToken) } };
}

export async function issueInviteAction(_prev: RowActionState, form: FormData): Promise<RowActionState> {
  const ctx = await requireRole(["admin"]);
  const userId = text(form, "userId");
  const result = await issueInvite(ctx, userId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/users");
  return { link: { userId, invitePath: invitePath(result.role, result.token) } };
}

export async function setActiveAction(_prev: RowActionState, form: FormData): Promise<RowActionState> {
  const ctx = await requireRole(["admin"]);
  const result = await setActive(ctx, text(form, "userId"), text(form, "active") === "true");
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/users");
  return {};
}

export async function assignSupervisorAction(_prev: RowActionState, form: FormData): Promise<RowActionState> {
  const ctx = await requireRole(["admin"]);
  const result = await assignSupervisor(ctx, [text(form, "repId")], text(form, "supervisorId") || null);
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/users");
  return {};
}
