import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/ctx";
import { UPLOAD_MAX_BYTES } from "./uploads";
import { checkUploadHeaders, handleUpload } from "./upload-request";

const URL_ = "https://app.test/admin/uploads/upload";
const good = (extra: Record<string, string> = {}) =>
  new Headers({ host: "app.test", origin: "https://app.test", "x-requested-with": "upload", "content-length": "1000", ...extra });
const adminCtx = { role: "admin", companyId: "c", userId: "u" } as unknown as Ctx;

/** A request whose body stream records whether anything was pulled from it. */
function fake(headers: Headers, bytes: Uint8Array | null = null) {
  const pulled = vi.fn();
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled();
      if (sent || !bytes) return c.close();
      sent = true;
      c.enqueue(bytes);
    },
  }, { highWaterMark: 0 });
  return { request: { headers, url: URL_, body } as unknown as Request, pulled };
}
async function multipart(fd: FormData) {
  const res = new Response(fd);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type")! };
}
const status = async (r: Response) => [r.status, (await r.json()) as { failure?: string }] as const;

describe("checkUploadHeaders", () => {
  it("accepts a same-origin upload request", () => expect(checkUploadHeaders(good(), URL_)).toBeNull());
  it("rejects a missing or foreign Origin", () => {
    const noOrigin = good();
    noOrigin.delete("origin");
    expect(checkUploadHeaders(noOrigin, URL_)).toBe("bad_origin");
    expect(checkUploadHeaders(good({ origin: "https://evil.test" }), URL_)).toBe("bad_origin");
  });
  it("compares the scheme too, from x-forwarded-proto when present", () => {
    expect(checkUploadHeaders(good({ origin: "http://app.test" }), URL_)).toBe("bad_origin");
    expect(checkUploadHeaders(good({ origin: "http://app.test", "x-forwarded-proto": "http" }), URL_)).toBeNull();
    expect(checkUploadHeaders(good({ "x-forwarded-proto": "http" }), URL_)).toBe("bad_origin");
  });
  it("requires the custom header", () => expect(checkUploadHeaders(good({ "x-requested-with": "" }), URL_)).toBe("bad_header"));
  it("rejects a missing or oversized content-length", () => {
    const none = good();
    none.delete("content-length");
    expect(checkUploadHeaders(none, URL_)).toBe("too_large");
    expect(checkUploadHeaders(good({ "content-length": String(UPLOAD_MAX_BYTES + 200_000) }), URL_)).toBe("too_large");
  });
});

describe("handleUpload", () => {
  it("rejects a too-big content-length without reading the body", async () => {
    const { request, pulled } = fake(good({ "content-length": String(10 * UPLOAD_MAX_BYTES) }));
    // no database here: the attempt is recorded through rejectUpload, which needs one
    const r = await handleUpload(request, { ...adminCtx, db: recordingDb() } as unknown as Ctx);
    expect(await status(r)).toEqual([413, { failure: "too_large" }]);
    expect(pulled).not.toHaveBeenCalled();
  });
  it("refuses a body over the cap whatever content-length claims, without parsing it", async () => {
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 200_000);
    const { request } = fake(good({ "content-length": "1000", "content-type": "multipart/form-data; boundary=x" }), big);
    const parse = vi.spyOn(Response.prototype, "formData");
    const r = await handleUpload(request, { ...adminCtx, db: recordingDb() } as unknown as Ctx);
    expect(await status(r)).toEqual([413, { failure: "too_large" }]);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
  it("answers bad_request for a mismatched Origin or missing header, reading nothing", async () => {
    for (const h of [good({ origin: "https://evil.test" }), good({ "x-requested-with": "" })]) {
      const { request, pulled } = fake(h);
      expect(await status(await handleUpload(request, adminCtx))).toEqual([403, { failure: "bad_request" }]);
      expect(pulled).not.toHaveBeenCalled();
    }
  });
  it("rejects a missing session and a non-admin without reading the body", async () => {
    for (const ctx of [null, { ...adminCtx, role: "rep" } as unknown as Ctx]) {
      const { request, pulled } = fake(good());
      expect(await status(await handleUpload(request, ctx))).toEqual([403, { failure: "forbidden" }]);
      expect(pulled).not.toHaveBeenCalled();
    }
  });
  it("answers no_file for a request without a file and bad_kind for an unknown kind", async () => {
    const a = new FormData();
    a.set("kind", "targets");
    const pa = await multipart(a);
    expect(await status(await handleUpload(fake(good({ "content-type": pa.type }), pa.bytes).request, adminCtx))).toEqual([
      400,
      { kind: "targets", failure: "no_file" },
    ]);
    const b = new FormData();
    b.set("kind", "other");
    const pb = await multipart(b);
    expect(await status(await handleUpload(fake(good({ "content-type": pb.type }), pb.bytes).request, adminCtx))).toEqual([
      400,
      { failure: "bad_kind" },
    ]);
  });
});

/** Just enough of a drizzle db for `rejectUpload`'s single insert. */
function recordingDb() {
  return { insert: () => ({ values: async () => undefined }) };
}
