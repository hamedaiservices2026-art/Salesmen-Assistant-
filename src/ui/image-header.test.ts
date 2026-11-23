import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeTarget, orientedSize } from "./image-header";

const grey = (w: number, h: number) => ({ create: { width: w, height: h, channels: 3 as const, background: { r: 9, g: 9, b: 9 } } });

describe("orientedSize", () => {
  it("reads the size of a JPEG, a PNG and a WebP from their first bytes", async () => {
    expect(orientedSize(new Uint8Array(await sharp(grey(4000, 3000)).jpeg().toBuffer()))).toEqual({ w: 4000, h: 3000 });
    expect(orientedSize(new Uint8Array(await sharp(grey(640, 480)).png().toBuffer()))).toEqual({ w: 640, h: 480 });
    expect(orientedSize(new Uint8Array(await sharp(grey(300, 200)).webp().toBuffer()))).toEqual({ w: 300, h: 200 });
    expect(orientedSize(new Uint8Array(await sharp(grey(300, 200)).webp({ lossless: true }).toBuffer()))).toEqual({ w: 300, h: 200 });
  });

  it("swaps width and height for a JPEG whose EXIF orientation turns it (5–8)", async () => {
    const turned = await sharp(grey(600, 400)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(orientedSize(new Uint8Array(turned))).toEqual({ w: 400, h: 600 });
    const upright = await sharp(grey(600, 400)).jpeg().withMetadata({ orientation: 3 }).toBuffer();
    expect(orientedSize(new Uint8Array(upright))).toEqual({ w: 600, h: 400 });
  });

  it("is null for anything it cannot read", () => {
    expect(orientedSize(new TextEncoder().encode("<svg/>"))).toBeNull();
    expect(orientedSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2]))).toBeNull();
    expect(orientedSize(new Uint8Array())).toBeNull();
  });
});

describe("decodeTarget", () => {
  it("asks the decoder for at most 1600 px on the long edge, or nothing when the photo is already small or unknown", () => {
    expect(decodeTarget({ w: 4000, h: 3000 })).toEqual({ resizeWidth: 1600, resizeHeight: 1200 });
    expect(decodeTarget({ w: 3000, h: 4000 })).toEqual({ resizeWidth: 1200, resizeHeight: 1600 });
    expect(decodeTarget({ w: 800, h: 600 })).toEqual({});
    expect(decodeTarget(null)).toEqual({});
  });
});
