// Voice-note limits and the audio type from a recording's first bytes. Pure.

/** Largest recording accepted, in bytes (the body also carries a date field and the multipart framing). */
export const AUDIO_MAX_BYTES = 3_000_000;
/**
 * The longest recording, in seconds. The recorder enforces this (it stops at 60 s); the server
 * cannot measure a duration without decoding, so it checks the byte size only (R55).
 */
export const AUDIO_MAX_SECONDS = 60;
/** Longest transcript kept, in characters. */
export const TRANSCRIPT_MAX = 2000;

export type AudioMime = "audio/mp4" | "audio/webm" | "audio/ogg";

const startsWith = (head: Uint8Array, at: number, sig: readonly number[]): boolean =>
  head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

const MATROSKA_SIG = [0x1a, 0x45, 0xdf, 0xa3];
const FTYP_SIG = [0x66, 0x74, 0x79, 0x70]; // "ftyp"
const OGG_SIG = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

/**
 * Brands of an ISO base media file that hold a picture (HEIC, HEIF, AVIF) and never a recording.
 * Any other brand (`M4A `, `isom`, `mp42`, `iso2`, `dash`, `3gp4`, ...) is an MP4 container.
 */
const IMAGE_BRANDS: ReadonlySet<string> = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1", "avif", "avis", "avci", "avcs", "jpeg", "jpgs",
]);

/**
 * The audio type from the recording's first bytes (at least 12 are read); the file name and the
 * declared type are never used. WebM / Matroska `1A 45 DF A3`; MP4 `ftyp` at bytes 4-7 with a
 * brand that is not a picture brand; Ogg `OggS`; anything else (WAV, MP3, HTML, JPEG, ...) is null.
 */
export function sniffAudio(head: Uint8Array): AudioMime | null {
  if (startsWith(head, 0, MATROSKA_SIG)) return "audio/webm";
  if (startsWith(head, 0, OGG_SIG)) return "audio/ogg";
  if (startsWith(head, 4, FTYP_SIG) && head.length >= 12) {
    const brand = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!);
    return IMAGE_BRANDS.has(brand.toLowerCase()) ? null : "audio/mp4";
  }
  return null;
}
