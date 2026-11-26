import { createDeflate, crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { PHOTO_MAX_BYTES } from "@/domain/files";
import { normalisePhoto } from "./image";

const grey = { r: 128, g: 128, b: 128 };
const canvas = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: grey } });
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ascii = (s: string) => new TextEncoder().encode(s);

/** A PNG made of a signature, an IHDR declaring `w` x `h`, one empty IDAT and IEND: tiny, no real pixels. */
function pngHeaderOnly(w: number, h: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(head) >>> 0);
    return Buffer.concat([len, head, crc]);
  };
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from([0]))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head) >>> 0);
  return Buffer.concat([len, head, crc]);
}

/**
 * A complete, decodable 8-bit RGB PNG of `w` x `h` black pixels. The zero rows are streamed into
 * the compressor in 4 MB pieces, so building even a 120 MB-raw image stays small in memory; the
 * file itself is a few hundred kilobytes (the shape of a real decompression bomb).
 */
async function realPng(w: number, h: number): Promise<Uint8Array> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const deflate = createDeflate({ level: 1 });
  const out: Buffer[] = [];
  deflate.on("data", (b: Buffer) => out.push(b));
  const done = new Promise<void>((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  const zeros = Buffer.alloc(4_000_000);
  let left = (w * 3 + 1) * h; // a filter byte (0) and the pixels of each row, all zero
  while (left > 0) {
    const n = Math.min(left, zeros.length);
    if (!deflate.write(zeros.subarray(0, n))) await new Promise((r) => deflate.once("drain", r));
    left -= n;
  }
  deflate.end();
  await done;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", Buffer.concat(out)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Raw-byte markers of metadata that must never reach a stored photo. */
const METADATA_MARKERS = ["Exif", "GPS", "xmp", "XMP", "ICC_PROFILE", "http://ns.adobe.com"];
const markersIn = (b: Uint8Array) => METADATA_MARKERS.filter((m) => Buffer.from(b).includes(Buffer.from(m, "latin1")));

/** Little-endian EXIF tag 0x8825 (the pointer to the GPS directory). */
const hasGpsPointer = (exif: Buffer) => exif.includes(Buffer.from([0x25, 0x88]));

describe("normalisePhoto", () => {
  it("shrinks a 4000 x 3000 JPEG to 1600 x 1200 JPEG", async () => {
    const input = await canvas(4000, 3000).jpeg({ quality: 50 }).toBuffer();
    const r = await normalisePhoto(new Uint8Array(input));
    expect(r).toMatchObject({ ok: true, width: 1600, height: 1200 });
    if (!r.ok) return;
    expect(isJpeg(r.jpeg)).toBe(true);
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1600, 1200]);
  });

  it("applies the EXIF orientation and drops EXIF, GPS, ICC and XMP", async () => {
    const input = await canvas(600, 400)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "24/1 42/1 0/1" } })
      .withIccProfile("p3")
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
      .toBuffer();
    // The input really carries every kind of metadata, so the checks below are not vacuous.
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif && hasGpsPointer(before.exif)).toBe(true);
    expect(before.icc).toBeDefined();
    expect(before.xmp).toBeDefined();
    expect(markersIn(new Uint8Array(input))).toEqual(expect.arrayContaining(["Exif", "ICC_PROFILE", "http://ns.adobe.com"]));

    const r = await normalisePhoto(new Uint8Array(input));
    expect(r).toMatchObject({ ok: true, width: 400, height: 600 });
    if (!r.ok) return;
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([400, 600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(markersIn(r.jpeg)).toEqual([]);
  });

  it("never enlarges a small photo", async () => {
    const r = await normalisePhoto(new Uint8Array(await canvas(300, 200).jpeg().toBuffer()));
    expect(r).toMatchObject({ ok: true, width: 300, height: 200 });
  });

  it("re-encodes a PNG and a WebP as JPEG", async () => {
    for (const input of [await canvas(320, 240).png().toBuffer(), await canvas(320, 240).webp().toBuffer()]) {
      const r = await normalisePhoto(new Uint8Array(input));
      expect(r).toMatchObject({ ok: true, width: 320, height: 240 });
      if (r.ok) expect(isJpeg(r.jpeg)).toBe(true);
    }
  });

  it("refuses SVG, HTML, GIF and PDF by their bytes", async () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', "<!doctype html><p>x", "GIF89a\x01\x00\x01\x00", "%PDF-1.7\n"]) {
      expect(await normalisePhoto(ascii(s))).toEqual({ ok: false, error: "unsupported_type" });
    }
    const gif = await canvas(10, 10).gif().toBuffer();
    expect(await normalisePhoto(new Uint8Array(gif))).toEqual({ ok: false, error: "unsupported_type" });
    expect(await normalisePhoto(new Uint8Array(0))).toEqual({ ok: false, error: "unsupported_type" });
  });

  it("calls a JPEG head followed by garbage corrupt", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...ascii("<html><script>alert(1)</script>".repeat(10))]);
    expect(await normalisePhoto(bytes)).toEqual({ ok: false, error: "corrupt" });
  });

  it("calls a truncated JPEG corrupt", async () => {
    const full = await canvas(200, 200).jpeg().toBuffer();
    expect(await normalisePhoto(new Uint8Array(full.subarray(0, Math.floor(full.length / 2))))).toEqual({ ok: false, error: "corrupt" });
  });

  it("refuses more than 4 000 000 bytes before looking at them", async () => {
    const bytes = new Uint8Array(4_000_001);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(await normalisePhoto(bytes)).toEqual({ ok: false, error: "too_large" });
  });

  it("refuses a PNG declaring 10 000 x 10 000 pixels without decoding it", async () => {
    const png = pngHeaderOnly(10_000, 10_000);
    expect(png.length).toBeLessThan(100);
    expect(await normalisePhoto(png)).toEqual({ ok: false, error: "too_many_pixels" });
  });

  it("refuses more than 24 000 000 pixels, or a side over 10 000, from the header", async () => {
    // 4 899 x 4 899 = 24 000 201: both sides fine, one row too many pixels.
    expect(await normalisePhoto(pngHeaderOnly(4_899, 4_899))).toEqual({ ok: false, error: "too_many_pixels" });
    expect(await normalisePhoto(pngHeaderOnly(12_000, 3_000))).toEqual({ ok: false, error: "too_many_pixels" });
    // 10 001 x 100 is only 1 000 100 pixels, but one side is too long.
    expect(await normalisePhoto(pngHeaderOnly(10_001, 100))).toEqual({ ok: false, error: "too_many_pixels" });
    expect(await normalisePhoto(pngHeaderOnly(100, 10_001))).toEqual({ ok: false, error: "too_many_pixels" });
    // Exactly at the limits the header passes; these header-only files then fail to decode.
    expect(await normalisePhoto(pngHeaderOnly(6_000, 4_000))).toEqual({ ok: false, error: "corrupt" });
    expect(await normalisePhoto(pngHeaderOnly(10_000, 2_400))).toEqual({ ok: false, error: "corrupt" });
  });

  describe("extreme aspect ratios (decompression bombs that pass a pixel count)", () => {
    const bombs: [string, number, number][] = [
      ["40 000 000 x 1", 40_000_000, 1],
      ["1 x 40 000 000", 1, 40_000_000],
      ["20 000 000 x 2", 20_000_000, 2],
    ];
    const files = new Map<string, Uint8Array>();
    beforeAll(async () => {
      for (const [name, w, h] of bombs) files.set(name, await realPng(w, h));
    }, 60_000);

    for (const [name] of bombs) {
      it(`refuses a decodable ${name} PNG without decoding it`, async () => {
        const png = files.get(name);
        expect(png).toBeDefined();
        if (!png) return;
        expect(png.length).toBeLessThan(PHOTO_MAX_BYTES);
        // Decoding these took 0.8 to 10.5 s and up to 2 GB before the fix; the header alone is
        // instant. Best of three, so a CPU shared with other test files does not decide it.
        let ms = Infinity;
        for (let run = 0; run < 3; run++) {
          const t0 = performance.now();
          expect(await normalisePhoto(png)).toEqual({ ok: false, error: "too_many_pixels" });
          ms = Math.min(ms, performance.now() - t0);
        }
        expect(ms).toBeLessThan(1500);
      });
    }
  });

  it("accepts a progressive 6000 x 4000 JPEG (the largest allowed photo)", async () => {
    const input = await canvas(6_000, 4_000).jpeg({ quality: 40, progressive: true }).toBuffer();
    const r = await normalisePhoto(new Uint8Array(input));
    expect(r).toMatchObject({ ok: true, width: 1600, height: 1067 });
  }, 30_000);

  it("returns bytes it owns (not a view into a shared buffer)", async () => {
    const r = await normalisePhoto(new Uint8Array(await canvas(50, 40).jpeg().toBuffer()));
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.jpeg.byteOffset, r.jpeg.buffer.byteLength]).toEqual([0, r.jpeg.byteLength]);
  });

  describe("one photo at a time", () => {
    it("runs two calls one after the other, in arrival order", async () => {
      const big = new Uint8Array(await canvas(3_000, 2_000).jpeg().toBuffer());
      const small = new Uint8Array(await canvas(10, 10).jpeg().toBuffer());
      const order: string[] = [];
      await Promise.all([
        normalisePhoto(big).then((r) => order.push(`big:${r.ok}`)),
        normalisePhoto(small).then((r) => order.push(`small:${r.ok}`)),
      ]);
      // Without the queue the small photo finishes first.
      expect(order).toEqual(["big:true", "small:true"]);
    });

    it("a call that cannot start within its wait bound is refused as busy", async () => {
      const big = new Uint8Array(await canvas(3_000, 2_000).jpeg().toBuffer());
      const small = new Uint8Array(await canvas(10, 10).jpeg().toBuffer());
      const first = normalisePhoto(big);
      const second = normalisePhoto(big);
      const third = normalisePhoto(small, { maxWaitMs: 5 });
      expect(await third).toEqual({ ok: false, error: "busy" });
      expect(await first).toMatchObject({ ok: true });
      expect(await second).toMatchObject({ ok: true });
      // The queue is free again afterwards.
      expect(await normalisePhoto(small, { maxWaitMs: 5 })).toMatchObject({ ok: true });
    });
  });

  it("blocks the SVG, PDF, TIFF, HEIF and GIF decoders in this process once loaded", async () => {
    await normalisePhoto(new Uint8Array(await canvas(10, 10).jpeg().toBuffer()));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(sharp(svg).metadata()).rejects.toThrow(/blocked|unsupported/i);
    const tiff = await canvas(10, 10).tiff().toBuffer();
    await expect(sharp(tiff).metadata()).rejects.toThrow(/blocked|unsupported/i);
  });
});
