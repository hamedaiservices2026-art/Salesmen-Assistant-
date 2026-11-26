import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import type { Role } from "@/server/auth/roles";
import { localStore } from "./local-store";
import type { FileStore } from "./store";
import { saveUpload } from "./files";

// Pass-through unless a test sets `forceBusy`: then the decoder reports that its one slot is taken (R69).
const imageMock = vi.hoisted(() => ({ forceBusy: false }));
vi.mock("./image", async (importOriginal) => {
  const real = await importOriginal<typeof import("./image")>();
  return {
    ...real,
    normalisePhoto: (...args: Parameters<typeof real.normalisePhoto>) =>
      imageMock.forceBusy ? Promise.resolve({ ok: false as const, error: "busy" as const }) : real.normalisePhoto(...args),
  };
});
import { FILE_POST_MAX_BODY, PHOTO_REQUESTED_WITH, handleFileGet, handleFilePost } from "./http";

let db: Db;
let root: string;
let store: FileStore;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
  root = await mkdtemp(path.join(tmpdir(), "files-http-"));
  store = localStore(root);
});
afterEach(async () => {
  imageMock.forceBusy = false;
  await rm(root, { recursive: true, force: true });
});

const ctxOf = (userId: string, role: Role = "rep", companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const ahmed = () => ctxOf("ahmed");
const NOW = new Date("2026-11-14T07:00:00Z");
const deps = () => ({ store, now: NOW, today: "2026-11-14" });

const BASE = "https://app.test";
const grey = async (w: number, h: number) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg().toBuffer());

async function postRequest(fields: Record<string, string | Blob>, extra: Record<string, string> = {}, drop: string[] = []): Promise<Request> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = new Response(fd);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers({
    host: "app.test",
    origin: BASE,
    "x-requested-with": PHOTO_REQUESTED_WITH,
    "content-type": res.headers.get("content-type")!,
    "content-length": String(bytes.byteLength),
    ...extra,
  });
  for (const d of drop) headers.delete(d);
  return new Request(`${BASE}/app/files`, { method: "POST", headers, body: bytes });
}
const fileRows = async () => db.select().from(s.files);
async function storedObjects(): Promise<string[]> {
  try {
    return (await readdir(root, { recursive: true, withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
}
const getRequest = (id: string) => new Request(`${BASE}/files/${id}`);

describe("handleFilePost", () => {
  it("the body cap is the photo limit plus room for the form", () => {
    expect(FILE_POST_MAX_BODY).toBe(4_000_000 + 65_536);
    expect(PHOTO_REQUESTED_WITH).toBe("photo");
  });

  it("stores a return photo and answers { id, width, height } with no-store", async () => {
    const jpeg = await grey(800, 600);
    const req = await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg", { type: "image/jpeg" }) });
    const res = await handleFilePost(req, ahmed(), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { id: string; width: number; height: number };
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), width: 800, height: 600 });
    const rows = await fileRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.id, userId: "ahmed", kind: "return" });
  });

  it("no session → 401 JSON; an admin or owner → 403; nothing stored", async () => {
    const jpeg = await grey(10, 10);
    const make = () => postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") });
    const none = await handleFilePost(await make(), null, deps());
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    for (const ctx of [ctxOf("demo-admin", "admin"), ctxOf("owner", "owner", "platform")]) {
      const r = await handleFilePost(await make(), ctx, deps());
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "forbidden" });
    }
    expect(await fileRows()).toHaveLength(0);
  });

  it("without the custom header, or from another origin → 403, the body unread and nothing stored", async () => {
    const jpeg = await grey(10, 10);
    const file = new File([jpeg], "x.jpg");
    for (const req of [
      await postRequest({ kind: "return", date: "2026-11-14", file }, {}, ["x-requested-with"]),
      await postRequest({ kind: "return", date: "2026-11-14", file }, { origin: "https://evil.test" }),
    ]) {
      const r = await handleFilePost(req, ahmed(), deps());
      expect(r.status).toBe(403);
      expect(req.bodyUsed).toBe(false);
    }
    expect(await fileRows()).toHaveLength(0);
    expect(await storedObjects()).toEqual([]);
  });

  it("a declared length over the cap → 413 without reading the body", async () => {
    const req = await postRequest({ kind: "return", date: "2026-11-14", file: new File([new Uint8Array(10)], "x.jpg") }, {
      "content-length": String(FILE_POST_MAX_BODY + 1),
    });
    const r = await handleFilePost(req, ahmed(), deps());
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "too_large" });
    expect(req.bodyUsed).toBe(false);
  });

  it("kind=report (or anything but return) → 400 bad_kind, nothing stored (R51)", async () => {
    const jpeg = await grey(10, 10);
    for (const kind of ["report", "other", ""]) {
      const r = await handleFilePost(await postRequest({ kind, date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ahmed(), deps());
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "bad_kind" });
    }
    expect(await fileRows()).toHaveLength(0);
    expect(await storedObjects()).toEqual([]);
  });

  it("a missing file → 400 no_file; SVG bytes → 400 unsupported_type; a future date → 400 bad_date", async () => {
    const noFile = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14" }), ahmed(), deps());
    expect([noFile.status, await noFile.json()]).toEqual([400, { error: "no_file" }]);
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "x.jpg", { type: "image/jpeg" });
    const bad = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: svg }), ahmed(), deps());
    expect([bad.status, await bad.json()]).toEqual([400, { error: "unsupported_type" }]);
    const jpeg = await grey(10, 10);
    const future = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-15", file: new File([jpeg], "x.jpg") }), ahmed(), deps());
    expect([future.status, await future.json()]).toEqual([400, { error: "bad_date" }]);
    expect(await fileRows()).toHaveLength(0);
  });

  it("quota → 429; storage failure → 500", async () => {
    const jpeg = await grey(10, 10);
    await db.insert(s.aiCounters).values({ scope: "user:ahmed", bucket: "2026-11-14", kind: "upload", companyId: "demo-co", count: 40 });
    const q = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ahmed(), deps());
    expect([q.status, await q.json()]).toEqual([429, { error: "quota" }]);
    const failing: FileStore = { ...store, put: async () => Promise.reject(new Error("x")) };
    const st = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ctxOf("khaled"), {
      ...deps(),
      store: failing,
    });
    expect([st.status, await st.json()]).toEqual([500, { error: "storage_failed" }]);
  });
});

describe("handleFilePost: cheap refusals before the body (final review A-L3)", () => {
  it("a rep at his daily upload limit is refused with quota before any of the body is read", async () => {
    await db.insert(s.aiCounters).values({ scope: "user:ahmed", bucket: "2026-11-14", kind: "upload", companyId: "demo-co", count: 40 });
    const req = await postRequest({ kind: "return", date: "2026-11-14", file: new File([await grey(10, 10)], "x.jpg") });
    const r = await handleFilePost(req, ahmed(), deps());
    expect([r.status, await r.json()]).toEqual([429, { error: "quota" }]);
    expect(req.bodyUsed).toBe(false);
  });

  it("at most two uploads in flight per rep: the third gets 429 busy with Retry-After; the slots come back", async () => {
    const jpeg = await grey(10, 10);
    const full = await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") });
    const bytes = new Uint8Array(await full.arrayBuffer());
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const slow = () =>
      new Request(`${BASE}/app/files`, {
        method: "POST",
        headers: full.headers,
        body: new ReadableStream<Uint8Array>({
          async pull(c) {
            await gate;
            c.enqueue(bytes);
            c.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
    const first = handleFilePost(slow(), ahmed(), deps());
    const second = handleFilePost(slow(), ahmed(), deps());
    // let both reach the body read
    await new Promise((resolve) => setTimeout(resolve, 50));
    const thirdReq = await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") });
    const third = await handleFilePost(thirdReq, ahmed(), deps());
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("5");
    expect(await third.json()).toEqual({ error: "busy" });
    expect(thirdReq.bodyUsed).toBe(false);
    // another rep is not held
    expect((await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ctxOf("khaled"), deps())).status).toBe(200);
    open();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ahmed(), deps())).status).toBe(200);
  });
});

describe("handleFilePost when the decoder is busy (R69)", () => {
  it("answers a retryable 503 { error: busy } with Retry-After, and stores nothing", async () => {
    const jpeg = await grey(10, 10);
    imageMock.forceBusy = true;
    const r = await handleFilePost(await postRequest({ kind: "return", date: "2026-11-14", file: new File([jpeg], "x.jpg") }), ahmed(), deps());
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("5");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ error: "busy" });
    expect(await fileRows()).toHaveLength(0);
    expect(await storedObjects()).toEqual([]);
    // The upload slot is given back (R70.5).
    const [c] = await db.select({ count: s.aiCounters.count }).from(s.aiCounters);
    expect(c?.count ?? 0).toBe(0);
  });

  it("saveUpload passes busy through", async () => {
    imageMock.forceBusy = true;
    expect(await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: await grey(10, 10) }, deps())).toEqual({ ok: false, error: "busy" });
  });
});

describe("handleFileGet", () => {
  async function ahmedsPhoto(kind: "return" | "report" = "return"): Promise<string> {
    const r = await saveUpload(ahmed(), { kind, date: "2026-11-14", bytes: await grey(800, 600) }, deps());
    if (!r.ok) throw new Error(r.error);
    return r.id;
  }
  async function expectEmpty404(res: Response) {
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }

  it("Ahmed gets his photo with the seven headers (R50)", async () => {
    const id = await ahmedsPhoto();
    const res = await handleFileGet(getRequest(id), ahmed(), id, { store });
    expect(res.status).toBe(200);
    const h = res.headers;
    expect(h.get("content-type")).toBe("image/jpeg");
    expect(h.get("content-disposition")).toBe('inline; filename="photo.jpg"');
    expect(h.get("cache-control")).toBe("private, no-store");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
    expect(h.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("every refusal is the same empty 404: no session, wrong company, wrong role, other rep, deleted, malformed, unknown, owner", async () => {
    const id = await ahmedsPhoto();
    const report = await ahmedsPhoto("report");
    const get = vi.fn(store.get);
    const spy: FileStore = { ...store, get };
    await expectEmpty404(await handleFileGet(getRequest(id), null, id, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(id), ctxOf("other-rep", "rep", "other-co"), id, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(id), ctxOf("other-admin", "admin", "other-co"), id, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(id), ctxOf("khaled"), id, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(id), ctxOf("owner", "owner", "platform"), id, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(report), ctxOf("demo-admin", "admin"), report, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest(report), ctxOf("sami", "supervisor"), report, { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest("x"), ahmed(), "../../etc/passwd", { store: spy }));
    await expectEmpty404(await handleFileGet(getRequest("x"), ahmed(), "f".repeat(32), { store: spy }));
    expect(get).not.toHaveBeenCalled();
    await db.update(s.files).set({ deletedAt: NOW });
    await expectEmpty404(await handleFileGet(getRequest(id), ahmed(), id, { store: spy }));
    expect(get).not.toHaveBeenCalled();
  });

  it("an id whose bytes are missing from the store is the same 404", async () => {
    const id = await ahmedsPhoto();
    const empty: FileStore = { ...store, get: async () => null };
    await expectEmpty404(await handleFileGet(getRequest(id), ahmed(), id, { store: empty }));
  });
});
