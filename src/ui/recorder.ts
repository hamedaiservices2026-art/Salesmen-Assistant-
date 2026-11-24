// What the voice recorder decides before and while it records. Pure; the browser parts are in VoiceRecorder.

/** The recorder stops by itself at 60 s (the server checks bytes only; R55). */
export const MAX_RECORD_MS = 60_000;

/** Tried in this order; iOS Safari gives `audio/mp4`, Chromium and Firefox `webm` or `ogg`. */
const MIME_ORDER = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"] as const;

/** The first supported recorder type, or null when none of them is. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of MIME_ORDER) {
    try {
      if (isSupported(mime)) return mime;
    } catch {
      // an engine that throws for a type does not support it
    }
  }
  return null;
}

/** Whether the page can record at all (microphone access needs a secure context). */
export function recorderSupport(env: { mediaDevices: boolean; mediaRecorder: boolean; secure: boolean }): "ok" | "unsupported" {
  return env.mediaDevices && env.mediaRecorder && env.secure ? "ok" : "unsupported";
}

/** A refused permission has its own message; every other failure is a plain "could not record". */
export function recorderErrorKind(name: string | undefined): "denied" | "failed" {
  return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed";
}

/** `m:ss` in Western digits, never past the limit. */
export function elapsedLabel(ms: number): string {
  const seconds = Math.floor(Math.min(Math.max(ms, 0), MAX_RECORD_MS) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
