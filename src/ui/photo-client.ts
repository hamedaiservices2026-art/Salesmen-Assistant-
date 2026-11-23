import { PHOTO_MAX_EDGE, PHOTO_REQUESTED_WITH, fitWithin, isFileId, type FileKind } from "@/domain/files";
import { decodeTarget, orientedSize } from "./image-header";

/** What the photo picker can show for a failed photo (`close.photo.errors.*`). */
export type PhotoError = "too_large" | "unsupported_type" | "unreadable" | "quota" | "busy" | "failed";

/** Above this the photo is encoded again at a lower quality, to stay under the server's 4 MB. */
const SECOND_PASS_BYTES = 3_500_000;

type Ctx2d = {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
};
type Canvas = { getContext(id: "2d"): Ctx2d | null };

/** How many leading bytes are read to find the photo's size (EXIF blocks with a thumbnail fit). */
const HEADER_BYTES = 256 * 1024;
/** Longest an upload may take before it is given up as failed. */
const UPLOAD_TIMEOUT_MS = 60_000;

/** An offscreen canvas where the browser has one, else a detached `<canvas>`. */
function makeCanvas(w: number, h: number): Canvas & { encode(quality: number): Promise<Blob> } {
  const Offscreen = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => Canvas & { convertToBlob(o: { type: string; quality: number }): Promise<Blob> } })
    .OffscreenCanvas;
  if (Offscreen) {
    const c = new Offscreen(w, h);
    return Object.assign(c, { encode: (quality: number) => c.convertToBlob({ type: "image/jpeg", quality }) });
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return Object.assign(c as unknown as Canvas, {
    encode: (quality: number) =>
      new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("unreadable"))), "image/jpeg", quality)),
  });
}

type Decoded = { source: unknown; width: number; height: number; close(): void };

/** Loads the photo through an `<img>` and an object URL (revoked when done); browsers apply EXIF orientation. */
function decodeWithImg(file: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  return new Promise<Decoded>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined });
    img.onerror = () => reject(new Error("unreadable"));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/**
 * Decodes the photo, trying in turn: `createImageBitmap` with the EXIF orientation applied and,
 * when the header gives the size, a decode capped at 1600 px; `createImageBitmap` without options
 * (Safari versions that refuse the options); an `<img>` from an object URL (no
 * `createImageBitmap`, or it cannot read the file). Rejects with `unreadable` when none works.
 */
async function decode(file: Blob): Promise<Decoded> {
  const create = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (create) {
    let size = null;
    try {
      size = orientedSize(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
    } catch {
      size = null;
    }
    const target = decodeTarget(size);
    const options: ImageBitmapOptions = {
      imageOrientation: "from-image",
      ...(target.resizeWidth ? { ...target, resizeQuality: "high" as const } : {}),
    };
    for (const attempt of [() => create(file, options), () => create(file)]) {
      try {
        const bitmap = await attempt();
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
      } catch {
        // try the next way
      }
    }
  }
  try {
    return await decodeWithImg(file);
  } catch {
    throw new Error("unreadable");
  }
}

/**
 * The photo redrawn in the browser before it is sent: the EXIF orientation applied, at most 1600 px
 * on the long edge, on white (a transparent PNG does not turn black), as a JPEG at quality 0.8
 * (again at 0.6 when that is still over 3.5 MB). Usually 300–600 KB, well under the platform's body
 * limit. A photo the browser cannot decode rejects with `unreadable`. The server decodes and
 * re-encodes it again; this step only makes the upload small.
 */
export async function downscalePhoto(file: Blob): Promise<Blob> {
  const image = await decode(file);
  try {
    const { w, h } = fitWithin(image.width, image.height, PHOTO_MAX_EDGE);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(image.source, 0, 0, w, h);
    const first = await canvas.encode(0.8);
    return first.size > SECOND_PASS_BYTES ? await canvas.encode(0.6) : first;
  } catch {
    throw new Error("unreadable");
  } finally {
    image.close();
  }
}

const SHOWN: Record<string, PhotoError> = {
  too_large: "too_large",
  too_many_pixels: "too_large",
  unsupported_type: "unsupported_type",
  corrupt: "unreadable",
  quota: "quota",
  busy: "busy",
};

/**
 * Sends one photo to `POST /app/files` with the custom header the server requires. A 413 (which
 * may come from the platform in front of the app, as an HTML page) is `too_large`; the server's own
 * codes map to the picker's messages (`busy` asks the rep to try again shortly); anything else,
 * including a timeout after 60 s or a reply id that is not a file id, is `failed`.
 */
export async function uploadPhoto(kind: FileKind, date: string, blob: Blob): Promise<{ ok: true; id: string } | { ok: false; error: PhotoError }> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("date", date);
  body.set("file", blob, "photo.jpg");
  let res: Response;
  try {
    res = await fetch("/app/files", {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { "x-requested-with": PHOTO_REQUESTED_WITH },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "failed" };
  }
  if (res.status === 413) return { ok: false, error: "too_large" };
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return { ok: false, error: "failed" };
  let reply: { id?: unknown; error?: unknown };
  try {
    reply = (await res.json()) as typeof reply;
  } catch {
    return { ok: false, error: "failed" };
  }
  if (res.ok && typeof reply.id === "string" && isFileId(reply.id)) return { ok: true, id: reply.id };
  return { ok: false, error: (typeof reply.error === "string" && SHOWN[reply.error]) || "failed" };
}
