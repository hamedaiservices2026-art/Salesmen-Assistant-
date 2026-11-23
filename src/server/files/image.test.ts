import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
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
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif && hasGpsPointer(before.exif)).toBe(true);

    const r = await normalisePhoto(new Uint8Array(input));
    expect(r).toMatchObject({ ok: true, width: 400, height: 600 });
    if (!r.ok) return;
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([400, 600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
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

  it("refuses a 40 000 001-pixel declaration and lets the exact limit through to the decoder", async () => {
    // 40 000 001 = 7 x 5 714 286: one pixel over.
    expect(await normalisePhoto(pngHeaderOnly(7, 5_714_286))).toEqual({ ok: false, error: "too_many_pixels" });
    // 8 000 x 5 000 = 40 000 000 is allowed by the limit; this header-only file then fails to decode.
    expect(await normalisePhoto(pngHeaderOnly(8_000, 5_000))).toEqual({ ok: false, error: "corrupt" });
  });
});
