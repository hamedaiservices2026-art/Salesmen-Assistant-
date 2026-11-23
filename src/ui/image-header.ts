import { PHOTO_MAX_EDGE, fitWithin } from "@/domain/files";

type Size = { w: number; h: number };

const u16 = (b: Uint8Array, at: number, little = false) => (little ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!);
const u32 = (b: Uint8Array, at: number, little = false) =>
  little ? (u16(b, at, true) | (u16(b, at + 2, true) << 16)) >>> 0 : ((u16(b, at) << 16) | u16(b, at + 2)) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

/** The EXIF orientation (1–8) in a JPEG APP1 segment starting at `at` (its length bytes), or 1. */
function exifOrientation(b: Uint8Array, at: number, end: number): number {
  const tiff = at + 8; // length (2) + "Exif\0\0" (6)
  if (end > b.length || String.fromCharCode(...b.subarray(at + 2, at + 6)) !== "Exif") return 1;
  const little = b[tiff] === 0x49;
  const ifd = tiff + u32(b, tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = u16(b, ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(b, entry, little) === 0x0112) return u16(b, entry + 8, little);
  }
  return 1;
}

function jpegSize(b: Uint8Array): Size | null {
  let orientation = 1;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const len = u16(b, at + 2);
    if (len < 2) return null;
    if (marker === 0xe1) orientation = exifOrientation(b, at + 2, at + 2 + len);
    // Start-of-frame markers (C0–CF except C4 DHT, C8 JPG, CC DAC) hold the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = u16(b, at + 5);
      const w = u16(b, at + 7);
      if (!w || !h) return null;
      return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h };
    }
    at += 2 + len;
  }
  return null;
}

/**
 * The displayed size of a JPEG, PNG or WebP from its first bytes (a JPEG's EXIF orientation 5–8
 * swaps width and height), or null when it cannot be read. Never decodes pixels.
 */
export function orientedSize(b: Uint8Array): Size | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const w = u32(b, 16);
    const h = u32(b, 20);
    return w && h ? { w, h } : null;
  }
  const tag = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  if (b.length >= 30 && tag(0) === "RIFF" && tag(8) === "WEBP") {
    const chunk = tag(12);
    if (chunk === "VP8 ") return { w: u16(b, 26, true) & 0x3fff, h: u16(b, 28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = u32(b, 21, true);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  return null;
}

/**
 * Resize options for `createImageBitmap` that cap the decoded image at 1600 px on the long edge
 * (so a 48 MP photo never becomes a 48 MP bitmap in a phone's memory). Empty when the photo is
 * already small or its size is unknown.
 */
export function decodeTarget(size: Size | null): { resizeWidth?: number; resizeHeight?: number } {
  if (!size || Math.max(size.w, size.h) <= PHOTO_MAX_EDGE) return {};
  const { w, h } = fitWithin(size.w, size.h, PHOTO_MAX_EDGE);
  return { resizeWidth: w, resizeHeight: h };
}
