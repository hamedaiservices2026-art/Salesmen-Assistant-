import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { isStorageKey } from "@/domain/files";
import type { FileStore } from "./store";

/** Read cap for one stored photo (the stored JPEG is far smaller; matches the Supabase adapter). */
const MAX_READ_BYTES = 5_000_000;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Errors name the operation only: never the key, the path or the root. */
class LocalStoreError extends Error {
  constructor(what: string) {
    super(`local file store: ${what}`);
    this.name = "LocalStoreError";
  }
}

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

/**
 * Private photos on the local disk, under `root` (development, tests, a single-server deployment).
 * Keys are checked with `isStorageKey` before any disk access; the resolved path must stay inside
 * the resolved root; no symlink is followed below the root and no hard-linked file is read;
 * files are written 0600 in 0700 directories and never overwritten.
 *
 * Accepted limit (dev, tests, e2e): the directory checks happen before the open, so someone who
 * can already write inside the root could swap a checked directory for a link in between. The
 * last path component is covered by O_NOFOLLOW/O_EXCL. Production uses the Supabase adapter.
 */
export function localStore(root: string): FileStore {
  const rootAbs = path.resolve(root);
  let realRoot: string | null = null;

  /** Creates the root (0700) once and remembers its real path; the root itself may be a symlink. */
  async function ensureRoot(): Promise<string> {
    if (realRoot === null) {
      const first = await mkdir(rootAbs, { recursive: true, mode: DIR_MODE });
      // The umask can strip bits from mkdir's mode: set 0700 exactly on every directory created
      // here (from the root up to the first one that did not exist). Existing ones are left alone.
      if (first !== undefined) {
        for (let at = rootAbs; ; at = path.dirname(at)) {
          await chmod(at, DIR_MODE);
          if (at === first || path.dirname(at) === at) break;
        }
      }
      realRoot = await realpath(rootAbs);
    }
    return realRoot;
  }

  /** The key's path pieces, refusing anything but the exact storage-key shape. */
  function pieces(key: string): string[] {
    if (!isStorageKey(key)) throw new LocalStoreError("invalid key");
    return key.split("/");
  }

  /** Absolute path of `parts` under `base`, verified to stay strictly inside it. */
  function inside(base: string, parts: string[]): string {
    const full = path.resolve(base, ...parts);
    const rel = path.relative(base, full);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new LocalStoreError("path outside the root");
    return full;
  }

  /** Every existing directory between the root and the file must be a real directory, not a link. */
  async function checkDirs(base: string, dirs: string[]): Promise<"ok" | "missing"> {
    let at = base;
    for (const d of dirs) {
      at = path.join(at, d);
      let st;
      try {
        st = await lstat(at);
      } catch (e) {
        if (errCode(e) === "ENOENT") return "missing";
        throw new LocalStoreError("cannot inspect a directory");
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new LocalStoreError("unexpected entry in the path");
    }
    return "ok";
  }

  /** Creates each level (0700), checking it is a real directory before going one level deeper. */
  async function makeDirs(base: string, dirs: string[]): Promise<void> {
    let at = base;
    for (const d of dirs) {
      at = path.join(at, d);
      let created = false;
      try {
        await mkdir(at, { mode: DIR_MODE });
        created = true;
      } catch (e) {
        if (errCode(e) !== "EEXIST") throw new LocalStoreError("cannot create a directory");
      }
      let st;
      try {
        st = await lstat(at);
      } catch {
        throw new LocalStoreError("cannot inspect a directory");
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new LocalStoreError("unexpected entry in the path");
      if (created) await chmod(at, DIR_MODE).catch(() => Promise.reject(new LocalStoreError("cannot set directory permissions")));
    }
  }

  return {
    async put(key, jpeg) {
      const parts = pieces(key);
      const base = await ensureRoot();
      const file = inside(base, parts);
      await makeDirs(base, parts.slice(0, -1));
      let handle;
      try {
        // O_EXCL refuses an existing file and an existing symlink alike; O_NOFOLLOW for good measure.
        handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
      } catch (e) {
        throw new LocalStoreError(errCode(e) === "EEXIST" ? "object exists" : "cannot create the file");
      }
      try {
        await handle.writeFile(jpeg);
        await handle.chmod(FILE_MODE);
      } catch {
        await handle.close().catch(() => {});
        await unlink(file).catch(() => {});
        throw new LocalStoreError("cannot write the file");
      }
      await handle.close();
    },

    async get(key) {
      const parts = pieces(key);
      const base = await ensureRoot();
      const file = inside(base, parts);
      if ((await checkDirs(base, parts.slice(0, -1))) === "missing") return null;
      let handle;
      try {
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (e) {
        if (errCode(e) === "ENOENT") return null;
        throw new LocalStoreError("cannot open the file");
      }
      try {
        const st = await handle.stat();
        if (!st.isFile()) throw new LocalStoreError("not a file");
        // A hard link could point a key at a file written elsewhere; the store only makes single links.
        if (st.nlink > 1) throw new LocalStoreError("unexpected link");
        if (st.size > MAX_READ_BYTES) throw new LocalStoreError("file too large");
        const data = await handle.readFile();
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } catch (e) {
        throw e instanceof LocalStoreError ? e : new LocalStoreError("cannot read the file");
      } finally {
        await handle.close().catch(() => {});
      }
    },

    async remove(key) {
      const parts = pieces(key);
      const base = await ensureRoot();
      const file = inside(base, parts);
      if ((await checkDirs(base, parts.slice(0, -1))) === "missing") return;
      try {
        // unlink removes a link itself, never its target.
        await unlink(file);
      } catch (e) {
        if (errCode(e) !== "ENOENT") throw new LocalStoreError("cannot remove the file");
      }
    },
  };
}
