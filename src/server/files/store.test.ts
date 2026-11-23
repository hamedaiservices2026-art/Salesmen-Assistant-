import { link, mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Secret } from "@/server/ai/secret";
import { localStore } from "./local-store";
import { getFileStore } from "./store";
import { supabaseStore } from "./supabase-store";

const ID = "0123456789abcdef0123456789abcdef";
const KEY = `demo-co/ahmed/2026-11-14/return-${ID}.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const BAD_KEYS = [
  `a/b/2026-11-14/return-${ID}.jpg/../../x`,
  "../../etc/passwd",
  "/etc/passwd",
  `demo-co\\ahmed/2026-11-14/return-${ID}.jpg`,
  "",
];

describe("localStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts and gets the bytes back", async () => {
    const store = localStore(path.join(root, "files"));
    await store.put(KEY, JPEG);
    expect(await store.get(KEY)).toEqual(JPEG);
  });

  it("writes files 0600 and directories 0700", async () => {
    const files = path.join(root, "files");
    await localStore(files).put(KEY, JPEG);
    expect((await stat(path.join(files, KEY))).mode & 0o777).toBe(0o600);
    for (const dir of ["", "demo-co", "demo-co/ahmed", "demo-co/ahmed/2026-11-14"]) {
      expect((await stat(path.join(files, dir))).mode & 0o777).toBe(0o700);
    }
  });

  it("refuses to overwrite", async () => {
    const store = localStore(root);
    await store.put(KEY, JPEG);
    await expect(store.put(KEY, new Uint8Array([9]))).rejects.toThrow();
    expect(await store.get(KEY)).toEqual(JPEG);
  });

  it("gives null for a missing key, and null after remove", async () => {
    const store = localStore(root);
    expect(await store.get(KEY)).toBeNull();
    await store.put(KEY, JPEG);
    await store.remove(KEY);
    expect(await store.get(KEY)).toBeNull();
    await expect(store.remove(KEY)).resolves.toBeUndefined();
  });

  it("throws on every malformed key before touching the disk", async () => {
    const files = path.join(root, "never-made");
    const store = localStore(files);
    for (const key of BAD_KEYS) {
      await expect(store.put(key, JPEG)).rejects.toThrow();
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.remove(key)).rejects.toThrow();
    }
    await expect(stat(files)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("the error names neither the key nor the path", async () => {
    const store = localStore(root);
    const err = await store.put(`a/b/2026-11-14/return-${ID}.jpg/../../x`, JPEG).catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain("..");
    expect(String((err as Error).message)).not.toContain(root);
  });

  it("does not follow a symlinked directory out of the root", async () => {
    const files = path.join(root, "files");
    const outside = path.join(root, "outside");
    await mkdir(files, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(files, "demo-co"));
    const store = localStore(files);
    await expect(store.put(KEY, JPEG)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    await expect(store.get(KEY)).rejects.toThrow();
  });

  it("refuses a hard-linked file", async () => {
    const files = path.join(root, "files");
    const secret = path.join(root, "secret.jpg");
    await writeFile(secret, JPEG);
    await mkdir(path.join(files, "demo-co/ahmed/2026-11-14"), { recursive: true });
    await link(secret, path.join(files, KEY));
    await expect(localStore(files).get(KEY)).rejects.toThrow();
  });

  it("makes the directories it creates exactly 0700, whatever the umask", async () => {
    // A umask that strips write bits would leave mkdir's 0700 as 0500; the store sets the mode itself.
    const old = process.umask(0o222);
    try {
      const files = path.join(root, "loose", "files");
      await localStore(files).put(KEY, JPEG);
      for (const dir of ["loose", "loose/files", "loose/files/demo-co", "loose/files/demo-co/ahmed", "loose/files/demo-co/ahmed/2026-11-14"]) {
        expect((await stat(path.join(root, dir))).mode & 0o777).toBe(0o700);
      }
      expect((await stat(path.join(files, KEY))).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(old);
    }
  });

  it("does not read through a symlinked file", async () => {
    const files = path.join(root, "files");
    const secret = path.join(root, "secret.txt");
    await writeFile(secret, "top secret");
    await mkdir(path.join(files, "demo-co/ahmed/2026-11-14"), { recursive: true });
    await symlink(secret, path.join(files, KEY));
    const store = localStore(files);
    await expect(store.get(KEY)).rejects.toThrow();
    await expect(store.put(KEY, JPEG)).rejects.toThrow();
  });
});

describe("getFileStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses the local disk by default, under FILES_DIR", async () => {
    const store = getFileStore({ FILES_DIR: root });
    await store.put(KEY, JPEG);
    expect(await store.get(KEY)).toEqual(JPEG);
    expect((await stat(path.join(root, KEY))).isFile()).toBe(true);
  });

  it("refuses the local disk in production unless ALLOW_LOCAL_FILES=1, on first use", async () => {
    const store = getFileStore({ NODE_ENV: "production", FILES_DIR: root });
    await expect(store.get(KEY)).rejects.toThrow(/ALLOW_LOCAL_FILES/);
    await expect(store.put(KEY, JPEG)).rejects.toThrow(/ALLOW_LOCAL_FILES/);
    expect(await readdir(root)).toEqual([]);
    const allowed = getFileStore({ NODE_ENV: "production", FILES_DIR: root, ALLOW_LOCAL_FILES: "1" });
    await allowed.put(KEY, JPEG);
    expect(await allowed.get(KEY)).toEqual(JPEG);
  });

  it("throws on an unknown driver", () => {
    expect(() => getFileStore({ STORAGE_DRIVER: "s3" })).toThrow();
  });

  it("supabase needs a well-formed URL and a key, and never says the key", () => {
    const key = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(() => getFileStore({ STORAGE_DRIVER: "supabase", SUPABASE_SERVICE_ROLE_KEY: key })).toThrow(/SUPABASE_URL/);
    expect(() => getFileStore({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    for (const url of ["http://169.254.169.254", "https://abc.supabase.co.evil.test", "https://evil.test/abc.supabase.co", "https://abc.supabase.co/"]) {
      let err: unknown;
      try {
        getFileStore({ STORAGE_DRIVER: "supabase", SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).not.toContain(key);
      expect((err as Error).message).not.toContain(url);
    }
    expect(() => getFileStore({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: key })).not.toThrow();
    expect(() =>
      getFileStore({ STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: key, STORAGE_BUCKET: "Bad_Bucket" }),
    ).toThrow();
  });
});

type Call = { url: string; method: string; headers: Headers; redirect?: RequestRedirect; body?: unknown };

function first(calls: Call[]): Call {
  const c = calls[0];
  if (c === undefined) throw new Error("no request was made");
  return c;
}

function recorder(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
      body: init?.body,
    };
    calls.push(call);
    return reply(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const SB_URL = "https://abcdefgh.supabase.co";
const SB_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
const JWT_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXBhcnQ";

describe("supabaseStore", () => {
  const make = (fetchImpl: typeof fetch, key = SB_KEY) => supabaseStore({ url: SB_URL, key: new Secret(key), bucket: "private-files" }, fetchImpl);

  it("puts with the apikey header only for a secret key, no overwrite, no redirects", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("{}", { status: 200 }));
    await make(fetchImpl).put(KEY, JPEG);
    expect(calls).toHaveLength(1);
    const c = first(calls);
    expect(c.method).toBe("POST");
    expect(c.url.startsWith(`${SB_URL}/`)).toBe(true);
    expect(c.url).toBe(`${SB_URL}/storage/v1/object/private-files/${KEY}`);
    expect(c.headers.get("apikey")).toBe(SB_KEY);
    expect(c.headers.get("authorization")).toBeNull();
    expect(c.headers.get("content-type")).toBe("image/jpeg");
    expect(c.headers.get("x-upsert")).toBe("false");
    expect(c.redirect).toBe("error");
    expect(new Uint8Array(c.body as Uint8Array)).toEqual(JPEG);
  });

  it("adds Authorization: Bearer for a JWT-shaped key", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("{}", { status: 200 }));
    await make(fetchImpl, JWT_KEY).put(KEY, JPEG);
    expect(first(calls).headers.get("apikey")).toBe(JWT_KEY);
    expect(first(calls).headers.get("authorization")).toBe(`Bearer ${JWT_KEY}`);
  });

  it("gets the bytes, and null for a 404", async () => {
    const { calls, fetchImpl } = recorder((c) => (c.url.includes(ID) ? new Response(JPEG, { status: 200 }) : new Response("", { status: 404 })));
    const store = make(fetchImpl);
    expect(await store.get(KEY)).toEqual(JPEG);
    expect(first(calls)).toMatchObject({ method: "GET", url: `${SB_URL}/storage/v1/object/private-files/${KEY}`, redirect: "error" });
    expect(first(calls).headers.get("apikey")).toBe(SB_KEY);
    const missing = KEY.replace(ID, "f".repeat(32));
    expect(await store.get(missing)).toBeNull();
  });

  it("treats a 400 whose body says the object is not found as missing", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 }));
    expect(await make(fetchImpl).get(KEY)).toBeNull();
    await expect(make(fetchImpl).remove(KEY)).resolves.toBeUndefined();
    const byMessage = recorder(() => new Response(JSON.stringify({ statusCode: "404", error: "Not Found", message: "Object not found" }), { status: 400 }));
    expect(await make(byMessage.fetchImpl).get(KEY)).toBeNull();
  });

  it("a missing bucket is an error, not a missing object", async () => {
    const body = JSON.stringify({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    for (const status of [400, 404]) {
      const { fetchImpl } = recorder(() => new Response(body, { status }));
      await expect(make(fetchImpl).get(KEY)).rejects.toThrow();
      await expect(make(fetchImpl).remove(KEY)).rejects.toThrow();
    }
  });

  it("a 400 whose body says 409 is the duplicate error", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }), { status: 400 }));
    await expect(make(fetchImpl).put(KEY, JPEG)).rejects.toThrow(/exists/);
  });

  it("an empty 200 body on get is an error", async () => {
    const { fetchImpl } = recorder(() => new Response(null, { status: 200 }));
    await expect(make(fetchImpl).get(KEY)).rejects.toThrow();
    const empty = recorder(() => new Response(new Uint8Array(0), { status: 200 }));
    await expect(make(empty.fetchImpl).get(KEY)).rejects.toThrow();
  });

  it("returns bytes it owns, not a view into a shared buffer", async () => {
    const { fetchImpl } = recorder(() => new Response(JPEG, { status: 200 }));
    const got = await make(fetchImpl).get(KEY);
    expect(got).toEqual(JPEG);
    expect([got?.byteOffset, got?.buffer.byteLength]).toEqual([0, JPEG.byteLength]);
  });

  it("refuses a body over 5 000 000 bytes, declared or streamed", async () => {
    const big = new Uint8Array(5_000_001);
    const declared = recorder(() => new Response(big, { status: 200, headers: { "content-length": "5000001" } }));
    await expect(make(declared.fetchImpl).get(KEY)).rejects.toThrow();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 10) controller.close();
        else controller.enqueue(new Uint8Array(1_000_000));
      },
    });
    const streamed = recorder(() => new Response(stream, { status: 200 }));
    await expect(make(streamed.fetchImpl).get(KEY)).rejects.toThrow();
    expect(pulled).toBeLessThan(10);
  });

  it("removes with DELETE; a missing object is fine", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("", { status: 404 }));
    await make(fetchImpl).remove(KEY);
    expect(first(calls)).toMatchObject({ method: "DELETE", url: `${SB_URL}/storage/v1/object/private-files/${KEY}`, redirect: "error" });
  });

  it("an error body that repeats the key is not in the error", async () => {
    const { fetchImpl } = recorder(() => new Response(`bad key ${SB_KEY} for ${SB_URL}/${KEY}`, { status: 500 }));
    for (const op of [(s: ReturnType<typeof make>) => s.put(KEY, JPEG), (s: ReturnType<typeof make>) => s.get(KEY), (s: ReturnType<typeof make>) => s.remove(KEY)]) {
      const err = await op(make(fetchImpl)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const text = `${(err as Error).message} ${String((err as Error).stack)} ${JSON.stringify(err)}`;
      expect(text).not.toContain(SB_KEY);
      expect(text).not.toContain(SB_URL);
      expect(text).not.toContain(KEY);
    }
  });

  it("a network failure carrying the URL becomes a plain error", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      throw new TypeError(`fetch failed for ${String(input)}`);
    }) as typeof fetch;
    const err = await make(fetchImpl).get(KEY).catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(SB_URL);
    expect((err as Error).message).not.toContain(KEY);
  });

  it("an existing object (HTTP 409) is refused (no overwrite)", async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ statusCode: "409", error: "Duplicate" }), { status: 409 }));
    await expect(make(fetchImpl).put(KEY, JPEG)).rejects.toThrow(/exists/);
  });

  it("a redirect is never followed", async () => {
    const { fetchImpl } = recorder(() => {
      const r = new Response(JPEG, { status: 200 });
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    });
    await expect(make(fetchImpl).get(KEY)).rejects.toThrow();
  });

  it("throws at construction for a URL that is not https://<ref>.supabase.co", () => {
    const { fetchImpl } = recorder(() => new Response("", { status: 200 }));
    for (const url of ["http://169.254.169.254", "http://abc.supabase.co", "https://abc.supabase.co.evil.test", "https://user@abc.supabase.co", "https://abc.supabase.co:8443", "https://ABC.supabase.co", "https://abc.supabase.co/x"]) {
      expect(() => supabaseStore({ url, key: new Secret(SB_KEY), bucket: "private-files" }, fetchImpl)).toThrow();
    }
  });

  it("throws at construction for a bad bucket or a key that cannot be a header", () => {
    const { fetchImpl } = recorder(() => new Response("", { status: 200 }));
    for (const bucket of ["", "a", "Private", "../x", "a/b", "-x"]) {
      expect(() => supabaseStore({ url: SB_URL, key: new Secret(SB_KEY), bucket }, fetchImpl)).toThrow();
    }
    for (const key of ["", "short", `${SB_KEY}\r\nx-evil: 1`]) {
      let err: unknown;
      try {
        supabaseStore({ url: SB_URL, key: new Secret(key), bucket: "private-files" }, fetchImpl);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      if (key) expect((err as Error).message).not.toContain(key);
    }
  });

  it("throws on a malformed key and makes no request", async () => {
    const { calls, fetchImpl } = recorder(() => new Response("", { status: 200 }));
    const store = make(fetchImpl);
    for (const key of BAD_KEYS) {
      await expect(store.put(key, JPEG)).rejects.toThrow();
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.remove(key)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it("only ever talks to the configured host", async () => {
    const { calls, fetchImpl } = recorder((c) => (c.method === "GET" ? new Response(JPEG) : new Response("{}")));
    const store = make(fetchImpl);
    await store.put(KEY, JPEG);
    await store.get(KEY);
    await store.remove(KEY);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(new URL(c.url).origin).toBe(SB_URL);
  });

  it("the store and its options print no key", () => {
    const { fetchImpl } = recorder(() => new Response(""));
    const store = make(fetchImpl);
    expect(JSON.stringify(store)).not.toContain(SB_KEY);
    expect(String(Object.values(store))).not.toContain(SB_KEY);
  });
});
