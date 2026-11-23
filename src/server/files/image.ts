import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS, PHOTO_MAX_SIDE, sniffImage } from "@/domain/files";
import { loadSharp } from "./sharp";

export type NormaliseError = "too_large" | "unsupported_type" | "too_many_pixels" | "corrupt" | "busy";
export type NormaliseResult = { ok: true; jpeg: Uint8Array; width: number; height: number } | { ok: false; error: NormaliseError };

const JPEG_QUALITY = 82;
/** Longest a photo waits for the one decoding slot before it is refused as `busy` (R69). */
export const PHOTO_QUEUE_WAIT_MS = 10_000;
/** Longest one decode-resize-encode may run (sharp's own timeout; R69). */
const PIPELINE_TIMEOUT_SECONDS = 10;
/** The sniffed type must be the one the decoder sees; any disagreement is refused. */
const SHARP_FORMAT = { jpeg: "jpeg", png: "png", webp: "webp" } as const;

const fail = (error: NormaliseError): NormaliseResult => ({ ok: false, error });

// --- One photo at a time per server instance (R69) ---------------------------------------------
// Decoding is the expensive part (a 24 MP photo needs a few hundred MB); running one at a time
// bounds the memory of the whole instance. Others wait in arrival order, for a bounded time.
let running = false;
const waiting: { start: () => void; settled: boolean }[] = [];

function release(): void {
  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
    if (next.settled) continue; // gave up waiting
    next.settled = true;
    next.start();
    return;
  }
  running = false;
}

/** Resolves true when the slot is ours, false when `maxWaitMs` passed first. */
function acquire(maxWaitMs: number): Promise<boolean> {
  if (!running) {
    running = true;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const entry = {
      settled: false,
      start: () => {
        clearTimeout(timer);
        resolve(true);
      },
    };
    const timer = setTimeout(() => {
      if (entry.settled) return;
      entry.settled = true;
      resolve(false);
    }, maxWaitMs);
    waiting.push(entry);
  });
}
// -------------------------------------------------------------------------------------------------

/**
 * Turns an uploaded photo into a fresh JPEG the server encoded itself.
 *
 * The type comes from the bytes (never a name or a declared type). The declared size is read from
 * the header and checked (at most `PHOTO_MAX_PIXELS`, and at most `PHOTO_MAX_SIDE` on each side,
 * which stops extreme aspect ratios that pass a pixel count) before any pixel is decoded; the
 * decoder is also limited to `PHOTO_MAX_PIXELS` and to `PIPELINE_TIMEOUT_SECONDS`. The output is
 * always re-encoded: EXIF orientation is applied, then every piece of metadata (EXIF, GPS, ICC,
 * XMP) is dropped, because `withMetadata`/`keepExif` are never called. Only one photo is worked on
 * at a time; a call that cannot start within `maxWaitMs` gets `busy` (retryable).
 * `opts.maxWaitMs` exists for tests; callers use the default.
 */
export async function normalisePhoto(bytes: Uint8Array, opts: { maxWaitMs?: number } = {}): Promise<NormaliseResult> {
  if (bytes.byteLength > PHOTO_MAX_BYTES) return fail("too_large");
  const type = sniffImage(bytes.subarray(0, 16));
  if (type === null) return fail("unsupported_type");

  if (!(await acquire(opts.maxWaitMs ?? PHOTO_QUEUE_WAIT_MS))) return fail("busy");
  try {
    return await decodeAndEncode(bytes, type);
  } finally {
    release();
  }
}

async function decodeAndEncode(bytes: Uint8Array, type: keyof typeof SHARP_FORMAT): Promise<NormaliseResult> {
  const sharp = await loadSharp();
  try {
    const image = sharp(bytes, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: "error", animated: false });
    // Header only: no pixel is decoded until the size has been checked.
    const meta = await image.metadata();
    if (meta.format !== SHARP_FORMAT[type]) return fail("unsupported_type");
    const { width, height } = meta;
    if (!width || !height) return fail("corrupt");
    if (width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE || width * height > PHOTO_MAX_PIXELS) return fail("too_many_pixels");

    const out = await image
      .timeout({ seconds: PIPELINE_TIMEOUT_SECONDS })
      .rotate()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    // A copy the caller owns outright (never a view into a larger or shared buffer).
    const jpeg = new Uint8Array(out.data);
    if (out.info.format !== "jpeg" || sniffImage(jpeg) !== "jpeg") return fail("corrupt");
    if (out.info.width > PHOTO_MAX_EDGE || out.info.height > PHOTO_MAX_EDGE) return fail("corrupt");
    return { ok: true, jpeg, width: out.info.width, height: out.info.height };
  } catch (e) {
    // The decoder's message is only inspected, never passed on. A pipeline timeout is `corrupt`.
    return fail(e instanceof Error && /pixel limit/i.test(e.message) ? "too_many_pixels" : "corrupt");
  }
}
