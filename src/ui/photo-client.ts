import { PHOTO_MAX_EDGE, PHOTO_REQUESTED_WITH, fitWithin, isFileId, type FileKind } from "@/domain/files";

/** What the photo picker can show for a failed photo (`close.photo.errors.*`). */
export type PhotoError = "too_large" | "unsupported_type" | "unreadable" | "quota" | "failed";

/** Above this the photo is encoded again at a lower quality, to stay under the server's 4 MB. */
const SECOND_PASS_BYTES = 3_500_000;

type Canvas = { getContext(id: "2d"): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null };

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

/**
 * The photo redrawn in the browser before it is sent: the EXIF orientation applied, at most 1600 px
 * on the long edge, as a JPEG at quality 0.8 (again at 0.6 when that is still over 3.5 MB). Usually
 * 300–600 KB, well under the platform's body limit. A photo the browser cannot decode rejects with
 * `unreadable`. The server decodes and re-encodes it again; this step only makes the upload small.
 */
export async function downscalePhoto(file: Blob): Promise<Blob> {
  let bitmap: { width: number; height: number; close?: () => void };
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("unreadable");
  }
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("unreadable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const first = await canvas.encode(0.8);
    return first.size > SECOND_PASS_BYTES ? await canvas.encode(0.6) : first;
  } catch {
    throw new Error("unreadable");
  } finally {
    bitmap.close?.();
  }
}

const SHOWN: Record<string, PhotoError> = {
  too_large: "too_large",
  too_many_pixels: "too_large",
  unsupported_type: "unsupported_type",
  corrupt: "unreadable",
  quota: "quota",
};

/**
 * Sends one photo to `POST /app/files` with the custom header the server requires. A 413 (which
 * may come from the platform in front of the app, as an HTML page) is `too_large`; the server's own
 * codes map to the picker's messages; anything else, including a reply id that is not a file id,
 * is `failed`.
 */
export async function uploadPhoto(kind: FileKind, date: string, blob: Blob): Promise<{ ok: true; id: string } | { ok: false; error: PhotoError }> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("date", date);
  body.set("file", blob, "photo.jpg");
  let res: Response;
  try {
    res = await fetch("/app/files", { method: "POST", body, credentials: "same-origin", headers: { "x-requested-with": PHOTO_REQUESTED_WITH } });
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
