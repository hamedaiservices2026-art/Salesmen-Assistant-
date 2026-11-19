import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/ctx";
import { UPLOAD_MAX_BYTES } from "./uploads";
import { handleUpload, checkUploadHeaders } from "./upload-request";

const good = (extra: Record<string, string> = {}) =>
  new Headers({ host: "app.test", origin: "https://app.test", "x-requested-with": "upload", "content-length": "1000", ...extra });
const fake = (headers: Headers) => {
  const formData = vi.fn(async () => new FormData());
  return { request: { headers, url: "https://app.test/admin/uploads/upload", formData } as unknown as Request, formData };
};
const adminCtx = { role: "admin", companyId: "c", userId: "u" } as unknown as Ctx;
const status = async (r: Response) => [r.status, (await r.json()) as { failure?: string }] as const;

describe("checkUploadHeaders", () => {
  it("accepts a same-origin upload request", () => expect(checkUploadHeaders(good())).toBeNull());
  it("rejects a missing or foreign Origin", () => {
    const noOrigin = good();
    noOrigin.delete("origin");
    expect(checkUploadHeaders(noOrigin)).toBe("bad_origin");
    expect(checkUploadHeaders(good({ origin: "https://evil.test" }))).toBe("bad_origin");
  });
  it("requires the custom header", () => expect(checkUploadHeaders(good({ "x-requested-with": "" }))).toBe("bad_header"));
  it("rejects a missing or oversized content-length", () => {
    const none = good();
    none.delete("content-length");
    expect(checkUploadHeaders(none)).toBe("too_large");
    expect(checkUploadHeaders(good({ "content-length": String(UPLOAD_MAX_BYTES + 200_000) }))).toBe("too_large");
  });
});

describe("handleUpload", () => {
  it("rejects a too-big content-length without reading the body", async () => {
    const { request, formData } = fake(good({ "content-length": String(10 * UPLOAD_MAX_BYTES) }));
    expect(await status(await handleUpload(request, adminCtx))).toEqual([413, { failure: "too_large" }]);
    expect(formData).not.toHaveBeenCalled();
  });
  it("rejects a mismatched Origin without reading the body", async () => {
    const { request, formData } = fake(good({ origin: "https://evil.test" }));
    expect((await handleUpload(request, adminCtx)).status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
  });
  it("rejects a missing session and a non-admin without reading the body", async () => {
    for (const ctx of [null, { ...adminCtx, role: "rep" } as unknown as Ctx]) {
      const { request, formData } = fake(good());
      expect((await handleUpload(request, ctx)).status).toBe(403);
      expect(formData).not.toHaveBeenCalled();
    }
  });
  it("answers no_file for a request without a file and bad_kind for an unknown kind", async () => {
    const fd = new FormData();
    fd.set("kind", "targets");
    const a = fake(good());
    a.formData.mockResolvedValue(fd);
    expect(await status(await handleUpload(a.request, adminCtx))).toEqual([400, { kind: "targets", failure: "no_file" }]);
    const fd2 = new FormData();
    fd2.set("kind", "other");
    const b = fake(good());
    b.formData.mockResolvedValue(fd2);
    expect(await status(await handleUpload(b.request, adminCtx))).toEqual([400, { failure: "bad_kind" }]);
  });
});
