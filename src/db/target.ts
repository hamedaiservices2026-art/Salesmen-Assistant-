export type DbTarget = { kind: "postgres"; url: string } | { kind: "pglite"; dir: string };

export const DEFAULT_PGLITE_DIR = ".data/pglite";

/**
 * Which database this process opens. `DATABASE_URL` selects Postgres. Without it the local
 * PGlite directory is used, except in production, where that would silently keep every rep's
 * data in a folder of the server: there it is an error unless `ALLOW_LOCAL_DB=1` says it is meant
 * (local production builds, `pnpm e2e`).
 */
export function resolveDbTarget(env: Record<string, string | undefined>): DbTarget {
  const url = env.DATABASE_URL;
  if (url) return { kind: "postgres", url };
  if (env.NODE_ENV === "production" && env.ALLOW_LOCAL_DB !== "1") {
    throw new Error(
      "DATABASE_URL is not set. A production server needs a Postgres connection string; " +
        "set ALLOW_LOCAL_DB=1 only to run a production build against the local PGlite database.",
    );
  }
  return { kind: "pglite", dir: env.PGLITE_DIR || DEFAULT_PGLITE_DIR };
}
