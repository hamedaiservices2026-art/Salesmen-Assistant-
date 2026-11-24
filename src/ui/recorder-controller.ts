// The recording session of the voice recorder, apart from React so it can be tested: asking for the
// microphone, recording, stopping (by the rep, at the 60 s limit, or because the page was hidden),
// and releasing the microphone. Stopping is re-entrant-safe: whatever races (a double tap, the
// limit, a hidden page), one recording gives exactly one result, and the chunks are never cleared
// while the recorder is still delivering its last data.
import { MAX_RECORD_MS, pickRecorderMime, recorderErrorKind } from "./recorder";

export type RecorderLike = {
  readonly state: string;
  readonly mimeType: string;
  start(): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
};
export type StreamLike = { getTracks(): { stop(): void }[] };

export type RecorderDeps = {
  getUserMedia(): Promise<StreamLike>;
  makeRecorder(stream: StreamLike, mime: string | null): RecorderLike;
  isTypeSupported(mime: string): boolean;
};

export type RecorderPhase = "idle" | "asking" | "recording" | "stopping";
export type RecordingEnd = "stopped" | "limit" | "hidden";

export type RecorderEvents = {
  onPhase(phase: RecorderPhase): void;
  onTick(elapsedMs: number): void;
  /** One per recording. `hidden`: the page was hidden, so the recording was cut short but kept. */
  onResult(result: { blob: Blob; reason: RecordingEnd }): void;
  onError(kind: "denied" | "failed"): void;
};

type Session = {
  stream: StreamLike | null;
  recorder: RecorderLike | null;
  chunks: Blob[];
  timer: ReturnType<typeof setInterval> | null;
  stopping: boolean;
  cancelled: boolean;
};

export function createRecorder(deps: RecorderDeps, ev: RecorderEvents) {
  let current: Session | null = null;
  let attempt = 0;
  let disposed = false;

  const release = (s: Session) => {
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
  };
  const phase = (p: RecorderPhase) => {
    if (!disposed) ev.onPhase(p);
  };

  /** Ends the recording once; later calls while it is stopping do nothing. */
  function end(reason: RecordingEnd) {
    const s = current;
    if (!s || !s.recorder || s.stopping) return;
    s.stopping = true;
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    phase("stopping");
    const r = s.recorder;
    const finish = () => {
      r.onstop = null;
      r.ondataavailable = null;
      const blob = new Blob(s.chunks, { type: r.mimeType || "audio/webm" });
      s.chunks = [];
      release(s);
      if (current === s) current = null;
      phase("idle");
      if (s.cancelled || disposed) return;
      if (blob.size === 0) ev.onError("failed");
      else ev.onResult({ blob, reason });
    };
    r.onstop = finish;
    if (r.state === "inactive") {
      finish();
      return;
    }
    try {
      r.stop();
    } catch {
      finish();
    }
  }

  /** Drops the recording: the microphone is released at once and no result is sent. */
  function cancel() {
    attempt += 1;
    const s = current;
    if (!s) {
      phase("idle");
      return;
    }
    s.cancelled = true;
    current = null;
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    const r = s.recorder;
    if (r) {
      r.ondataavailable = null;
      r.onerror = null;
      r.onstop = null;
      try {
        if (r.state !== "inactive") r.stop();
      } catch {
        // already stopped
      }
    }
    release(s);
    phase("idle");
  }

  async function start() {
    if (current) return;
    const mine = ++attempt;
    const s: Session = { stream: null, recorder: null, chunks: [], timer: null, stopping: false, cancelled: false };
    current = s;
    phase("asking");
    let stream: StreamLike;
    try {
      stream = await deps.getUserMedia();
    } catch (e) {
      if (mine !== attempt) return;
      current = null;
      phase("idle");
      ev.onError(recorderErrorKind(e instanceof Error ? e.name : undefined));
      return;
    }
    if (mine !== attempt) {
      // cancelled (or unmounted) while the microphone was being asked for: let it go at once
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    s.stream = stream;
    try {
      const mime = pickRecorderMime((m) => deps.isTypeSupported(m));
      const r = deps.makeRecorder(stream, mime);
      r.ondataavailable = (e) => {
        if (e.data.size > 0) s.chunks.push(e.data);
      };
      r.onerror = () => {
        if (current !== s) return;
        cancel();
        ev.onError("failed");
      };
      s.recorder = r;
      r.start();
    } catch {
      release(s);
      current = null;
      phase("idle");
      ev.onError("failed");
      return;
    }
    const startedAt = Date.now();
    phase("recording");
    ev.onTick(0);
    s.timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      if (ms >= MAX_RECORD_MS) {
        ev.onTick(MAX_RECORD_MS);
        end("limit");
      } else ev.onTick(ms);
    }, 250);
  }

  return {
    start,
    /** The rep pressed stop. */
    stop: () => end("stopped"),
    cancel,
    /** The page was hidden: a recording is cut short and kept; a pending microphone request is dropped. */
    hidden: () => {
      if (current?.recorder) end("hidden");
      else cancel();
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}
