import type { Ctx } from "@/server/ctx";

export const ROLES = ["rep", "supervisor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that sign in with a PIN and use the rep app; the others sign in with a password and use the admin. */
export const PIN_ROLES = ["rep", "supervisor"] as const satisfies readonly Role[];
export const PASSWORD_ROLES = ["admin", "owner"] as const satisfies readonly Role[];

export class Forbidden extends Error {
  constructor() {
    super("Forbidden");
    this.name = "Forbidden";
  }
}

/** Throws `Forbidden` unless the caller holds one of `roles`. Every admin server function starts with it. */
export function assertRole(ctx: Pick<Ctx, "role">, roles: readonly Role[]): void {
  if (!roles.includes(ctx.role)) throw new Forbidden();
}

export function homeFor(role: Role): "/app" | "/admin" {
  return (PIN_ROLES as readonly Role[]).includes(role) ? "/app" : "/admin";
}

/** Where a visitor without a session goes for a page that admits `roles`. */
export function signInPathFor(roles: readonly Role[]): "/signin" | "/admin/signin" {
  return roles.includes("rep") ? "/signin" : "/admin/signin";
}
