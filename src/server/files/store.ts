import { Secret } from "@/server/ai/secret";
import { localStore } from "./local-store";
import { supabaseStore } from "./supabase-store";

/**
 * Where private photos live. Every method throws on a key that fails `isStorageKey`, before any
 * disk or network access. `put` never overwrites; `get` gives null for a missing object; `remove`
 * of a missing object succeeds.
 */
export interface FileStore {
  put(key: string, jpeg: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

const DEFAULT_FILES_DIR = ".data/files";
const DEFAULT_BUCKET = "private-files";

/** A store whose every call fails with `message` (configuration that must not be used). */
function refusing(message: string): FileStore {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };
  return { put: fail, get: fail, remove: fail };
}

/**
 * The configured file store. `STORAGE_DRIVER` is `local` (default) or `supabase`.
 *
 * This is the only place that reads `SUPABASE_SERVICE_ROLE_KEY` (with `SUPABASE_URL` and
 * `STORAGE_BUCKET`); the key is wrapped in a `Secret` before it goes anywhere (R40). Errors name
 * the missing or malformed variable, never its value.
 */
export function getFileStore(env: Record<string, string | undefined> = process.env): FileStore {
  const driver = env.STORAGE_DRIVER || "local";
  if (driver === "local") {
    if (env.NODE_ENV === "production" && env.ALLOW_LOCAL_FILES !== "1") {
      return refusing(
        "Local file storage is refused in production: a serverless disk does not persist. Set STORAGE_DRIVER=supabase, or ALLOW_LOCAL_FILES=1 on a server with a lasting disk.",
      );
    }
    return localStore(env.FILES_DIR || DEFAULT_FILES_DIR);
  }
  if (driver === "supabase") {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("STORAGE_DRIVER=supabase needs SUPABASE_URL");
    if (!key) throw new Error("STORAGE_DRIVER=supabase needs SUPABASE_SERVICE_ROLE_KEY");
    return supabaseStore({ url, key: new Secret(key), bucket: env.STORAGE_BUCKET || DEFAULT_BUCKET });
  }
  throw new Error("STORAGE_DRIVER must be local or supabase");
}
