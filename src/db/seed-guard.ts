/** Why the demo seed must not run against this environment, or null when it may. */
export function seedRefusal(env: Record<string, string | undefined>): string | null {
  if (!env.DATABASE_URL || env.ALLOW_DEMO_SEED === "1") return null;
  return (
    "Refusing to seed: DATABASE_URL is set, so this may be a real database. " +
    "Seeding resets used invites and adds demo rows, including demo owner and admin accounts with published passwords. " +
    "Set ALLOW_DEMO_SEED=1 to seed it anyway."
  );
}
