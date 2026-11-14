import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { Ctx } from "@/server/ctx";
import { SESSION_COOKIE, getSessionUser } from "./sessions";

/** For server components and actions: the signed-in context, or a redirect to /signin. */
export async function requireCtx(): Promise<Ctx> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const ctx = token ? await getSessionUser(await getDb(), token) : null;
  if (!ctx) redirect("/signin");
  return ctx;
}
