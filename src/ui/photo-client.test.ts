import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downscalePhoto, uploadPhoto } from "./photo-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

describe("uploadPhoto", () => {
  it("posts kind, date and the file to /app/files with the custom header and same-origin credentials", async () => {
    const fetchMock = vi.fn(async () => reply(200, { id: "0123456789abcdef0123456789abcdef", width: 800, height: 600 }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    expect(await uploadPhoto("return", "2026-11-14", blob)).toEqual({ ok: true, id: "0123456789abcdef0123456789abcdef" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/app/files");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("x-requested-with")).toBe("photo");
    const fd = init.body as FormData;
    expect(fd.get("kind")).toBe("return");
    expect(fd.get("date")).toBe("2026-11-14");
    expect(fd.get("file")).toBeInstanceOf(Blob);
    // Never waits forever (R71).
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a request that times out is failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: "failed" });
  });

  it("maps 413 (whatever the body) to too_large", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(413, "<html>Request Entity Too Large</html>", "text/html")));
    expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: "too_large" });
  });

  it("maps the server's codes to the screen's messages", async () => {
    const cases: [number, string, string][] = [
      [400, "unsupported_type", "unsupported_type"],
      [400, "too_many_pixels", "too_large"],
      [400, "corrupt", "unreadable"],
      [429, "quota", "quota"],
      [503, "busy", "busy"],
      [500, "storage_failed", "failed"],
      [400, "bad_date", "failed"],
    ];
    for (const [status, error, shown] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(status, { error })));
      expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: shown });
    }
  });

  it("a network failure, a non-JSON reply or an id that is not a file id is failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(502, "<html>bad gateway</html>", "text/html")));
    expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { id: "../../x" })));
    expect(await uploadPhoto("return", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, error: "failed" });
  });
});

describe("downscalePhoto", () => {
  /** A canvas stub that records its size and what it was asked to encode. */
  const painted: string[] = [];
  function stubCanvas(sizes: number[]) {
    painted.length = 0;
    const made: { w: number; h: number; calls: number[] }[] = [];
    class FakeCanvas {
      calls: number[] = [];
      constructor(
        public width: number,
        public height: number,
      ) {
        made.push({ w: width, h: height, calls: this.calls });
      }
      getContext() {
        return {
          fillStyle: "",
          fillRect: () => painted.push("fill"),
          drawImage: () => painted.push("draw"),
        };
      }
      async convertToBlob(opts: { type: string; quality: number }) {
        this.calls.push(opts.quality);
        expect(opts.type).toBe("image/jpeg");
        return new Blob([new Uint8Array(sizes[this.calls.length - 1] ?? 10)], { type: "image/jpeg" });
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    return made;
  }

  it("draws the photo within 1600 px, as JPEG at 0.8, honouring the EXIF orientation", async () => {
    const bitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: () => undefined }));
    vi.stubGlobal("createImageBitmap", bitmap);
    const made = stubCanvas([500_000]);
    const out = await downscalePhoto(new Blob(["x"]));
    expect(bitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
    expect(made).toEqual([{ w: 1600, h: 1200, calls: [0.8] }]);
    expect(out.size).toBe(500_000);
  });

  it("encodes again at 0.6 when the first result is over 3 500 000 bytes", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: () => undefined })));
    const made = stubCanvas([3_500_001, 900_000]);
    const out = await downscalePhoto(new Blob(["x"]));
    expect(made[0]).toEqual({ w: 800, h: 600, calls: [0.8, 0.6] });
    expect(out.size).toBe(900_000);
  });

  it("paints white before drawing, so a transparent PNG does not turn black", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 10, height: 10, close: () => undefined })));
    stubCanvas([100]);
    await downscalePhoto(new Blob(["x"]));
    expect(painted).toEqual(["fill", "draw"]);
  });

  it("asks the decoder for 1600 px at most when the header gives the size (R71)", async () => {
    const jpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 1, g: 1, b: 1 } } }).jpeg().toBuffer();
    const bitmap = vi.fn(async () => ({ width: 1600, height: 1200, close: () => undefined }));
    vi.stubGlobal("createImageBitmap", bitmap);
    const made = stubCanvas([100]);
    await downscalePhoto(new Blob([new Uint8Array(jpeg)]));
    expect(bitmap).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: "from-image",
      resizeWidth: 1600,
      resizeHeight: 1200,
      resizeQuality: "high",
    });
    expect(made[0]).toMatchObject({ w: 1600, h: 1200 });
  });

  it("falls back to createImageBitmap without options when the options are refused (older Safari)", async () => {
    const bitmap = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("options not supported"))
      .mockResolvedValueOnce({ width: 3200, height: 2400, close: () => undefined });
    vi.stubGlobal("createImageBitmap", bitmap);
    const made = stubCanvas([100]);
    await downscalePhoto(new Blob(["x"]));
    expect(bitmap).toHaveBeenCalledTimes(2);
    expect(bitmap.mock.calls[1]).toHaveLength(1);
    expect(made[0]).toMatchObject({ w: 1600, h: 1200 });
  });

  /** An <img> stub that loads (or fails) as soon as its src is set. */
  function stubImage(result: { w: number; h: number } | "error") {
    const urls = { made: 0, revoked: [] as string[] };
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: () => `blob:photo-${++urls.made}`,
      revokeObjectURL: (u: string) => urls.revoked.push(u),
    }));
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = "";
      set src(_v: string) {
        queueMicrotask(() => {
          if (result === "error") this.onerror?.();
          else {
            this.naturalWidth = result.w;
            this.naturalHeight = result.h;
            this.onload?.();
          }
        });
      }
    }
    vi.stubGlobal("Image", FakeImage);
    return urls;
  }

  it("falls back to an <img> from an object URL when createImageBitmap fails or is missing, and revokes the URL", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("decode"))));
    const urls = stubImage({ w: 2000, h: 1000 });
    const made = stubCanvas([100]);
    await downscalePhoto(new Blob(["x"]));
    expect(made[0]).toMatchObject({ w: 1600, h: 800 });
    expect(urls.revoked).toEqual(["blob:photo-1"]);

    vi.stubGlobal("createImageBitmap", undefined);
    const urls2 = stubImage({ w: 100, h: 50 });
    const made2 = stubCanvas([100]);
    await downscalePhoto(new Blob(["x"]));
    expect(made2[0]).toMatchObject({ w: 100, h: 50 });
    expect(urls2.revoked).toEqual(["blob:photo-1"]);
  });

  it("rejects with unreadable when nothing can decode the photo, still revoking the URL", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("decode"))));
    const urls = stubImage("error");
    stubCanvas([]);
    await expect(downscalePhoto(new Blob(["x"]))).rejects.toThrow("unreadable");
    expect(urls.revoked).toEqual(["blob:photo-1"]);
  });
});
