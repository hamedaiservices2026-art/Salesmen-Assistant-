import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { Ctx } from "@/server/ctx";
import { homeFor, signInPathFor, type Role } from "./roles";
import { SESSION_COOKIE, getSessionUser } from "./sessions";

/** The signed-in context from the session cookie, or null. Never redirects. */
export async function currentCtx(): Promise<Ctx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getSessionUser(await getDb(), token) : null;
}

/**
 * For server components and actions: the signed-in context when its role is one of `roles`.
 * No session → the sign-in page for those roles; another role → that role's home.
 */
export async function requireRole(roles: readonly Role[]): Promise<Ctx> {
  const ctx = await currentCtx();
  if (!ctx) redirect(signInPathFor(roles));
  if (!roles.includes(ctx.role)) redirect(homeFor(ctx.role));
  return ctx;
}

/** Every rep-app page and action: reps and supervisors only, so an admin or owner session is refused. */
export function requireCtx(): Promise<Ctx> {
  return requireRole(["rep", "supervisor"]);
}
