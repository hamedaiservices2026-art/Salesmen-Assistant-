import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS, sniffImage } from "@/domain/files";

export type NormaliseError = "too_large" | "unsupported_type" | "too_many_pixels" | "corrupt";
export type NormaliseResult = { ok: true; jpeg: Uint8Array; width: number; height: number } | { ok: false; error: NormaliseError };

const JPEG_QUALITY = 82;
/** The sniffed type must be the one the decoder sees; any disagreement is refused. */
const SHARP_FORMAT = { jpeg: "jpeg", png: "png", webp: "webp" } as const;

const fail = (error: NormaliseError): NormaliseResult => ({ ok: false, error });

/**
 * Turns an uploaded photo into a fresh JPEG the server encoded itself.
 *
 * The type comes from the bytes (never a name or a declared type). The decoder is limited to
 * `PHOTO_MAX_PIXELS` and the declared size is checked from the header before any pixel is
 * decoded, so a small file declaring a huge image costs nothing. The output is always re-encoded:
 * EXIF orientation is applied, then every piece of metadata (EXIF, GPS, ICC, XMP) is dropped,
 * because `withMetadata`/`keepExif` are never called.
 */
export async function normalisePhoto(bytes: Uint8Array): Promise<NormaliseResult> {
  if (bytes.byteLength > PHOTO_MAX_BYTES) return fail("too_large");
  const type = sniffImage(bytes.subarray(0, 16));
  if (type === null) return fail("unsupported_type");

  // Loaded here, not at module scope, so importing this module never loads the native library.
  const { default: sharp } = await import("sharp");
  try {
    const image = sharp(bytes, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: "error", animated: false });
    const meta = await image.metadata();
    if (meta.format !== SHARP_FORMAT[type]) return fail("unsupported_type");
    const { width, height } = meta;
    if (!width || !height) return fail("corrupt");
    if (width * height > PHOTO_MAX_PIXELS) return fail("too_many_pixels");

    const out = await image
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const jpeg = new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
    if (out.info.format !== "jpeg" || sniffImage(jpeg) !== "jpeg") return fail("corrupt");
    if (out.info.width > PHOTO_MAX_EDGE || out.info.height > PHOTO_MAX_EDGE) return fail("corrupt");
    return { ok: true, jpeg, width: out.info.width, height: out.info.height };
  } catch (e) {
    // The decoder's message is only inspected, never passed on.
    return fail(e instanceof Error && /pixel limit/i.test(e.message) ? "too_many_pixels" : "corrupt");
  }
}
