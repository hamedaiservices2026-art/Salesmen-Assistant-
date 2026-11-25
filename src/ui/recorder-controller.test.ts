import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecorder, type RecorderEvents, type RecorderLike, type StreamLike } from "./recorder-controller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A recorder whose last data and `onstop` arrive 400 ms after `stop()` (slower than the 250 ms tick). */
class FakeRecorder implements RecorderLike {
  state = "inactive";
  mimeType = "audio/webm";
  stops = 0;
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  onerror: RecorderLike["onerror"] = null;
  constructor(private delay = 400, private bytes = 3) {}
  /** The system stops the recording (not a call to `stop()`). */
  systemStop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(this.bytes)]) });
    this.onstop?.();
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.stops += 1;
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(this.bytes)]) });
      this.onstop?.();
    }, this.delay);
  }
}

function setup(opts: { recorder?: FakeRecorder; media?: () => Promise<StreamLike>; permission?: () => Promise<"granted" | "denied" | "prompt" | undefined> } = {}) {
  const tracks = [{ stopped: 0, onended: null as (() => void) | null, stop() { this.stopped += 1; } }];
  const stream: StreamLike = { getTracks: () => tracks };
  const recorder = opts.recorder ?? new FakeRecorder();
  const log = { phases: [] as string[], results: [] as { blob: Blob; reason: string }[], errors: [] as string[], ticks: [] as number[] };
  const ev: RecorderEvents = {
    onPhase: (p) => log.phases.push(p),
    onTick: (ms) => log.ticks.push(ms),
    onResult: (r) => log.results.push(r),
    onError: (k) => log.errors.push(k),
  };
  const rec = createRecorder({ getUserMedia: opts.media ?? (async () => stream), makeRecorder: () => recorder, isTypeSupported: () => true, permissionState: opts.permission }, ev);
  return { rec, recorder, tracks, log };
}

describe("recorder controller", () => {
  it("a double tap on stop gives one result with all the data", async () => {
    const { rec, recorder, tracks, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(1000);
    rec.stop();
    rec.stop();
    expect(recorder.stops).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.blob.size).toBe(3);
    expect(log.results[0]!.reason).toBe("stopped");
    expect(tracks[0]!.stopped).toBeGreaterThan(0);
    expect(log.phases.at(-1)).toBe("idle");
  });

  it("the 60 s limit racing a tap on stop (onstop slower than a tick) gives exactly one result, chunks intact", async () => {
    const { rec, recorder, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(59_900);
    rec.stop(); // the rep taps just before the limit
    await vi.advanceTimersByTimeAsync(300); // the 60 s tick fires while the recorder is still stopping
    await vi.advanceTimersByTimeAsync(2000);
    expect(recorder.stops).toBe(1);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.blob.size).toBe(3);
  });

  it("the limit alone stops at 60 s and sends one result", async () => {
    const { rec, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.reason).toBe("limit");
    expect(Math.max(...log.ticks)).toBe(60_000);
  });

  it("a hidden page keeps what was recorded, releases the microphone and says why", async () => {
    const { rec, tracks, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(2000);
    rec.hidden();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.reason).toBe("hidden");
    expect(log.results[0]!.blob.size).toBe(3);
    expect(tracks[0]!.stopped).toBeGreaterThan(0);
  });

  it("cancel sends nothing and releases the microphone at once", async () => {
    const { rec, tracks, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(500);
    rec.cancel();
    expect(tracks[0]!.stopped).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(log.results).toHaveLength(0);
    expect(log.errors).toHaveLength(0);
  });

  it("a microphone that answers after a cancel is let go at once", async () => {
    let answer!: (s: StreamLike) => void;
    const { rec, tracks, log } = setup({ media: () => new Promise((r) => (answer = r)) });
    const started = rec.start();
    rec.cancel();
    answer({ getTracks: () => tracks });
    await started;
    expect(tracks[0]!.stopped).toBe(1);
    expect(log.results).toHaveLength(0);
  });

  it("a refused permission is denied, another failure is failed, no data is failed", async () => {
    const denied = setup({ media: async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) });
    await denied.rec.start();
    expect(denied.log.errors).toEqual(["denied"]);
    const broken = setup({ media: async () => Promise.reject(new Error("x")) });
    await broken.rec.start();
    expect(broken.log.errors).toEqual(["failed"]);
    const empty = setup({ recorder: new FakeRecorder(100, 0) });
    await empty.rec.start();
    empty.rec.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(empty.log.errors).toEqual(["failed"]);
    expect(empty.log.results).toHaveLength(0);
  });

  it("dispose (unmount) releases the microphone and sends nothing", async () => {
    const { rec, tracks, log } = setup();
    await rec.start();
    rec.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(tracks[0]!.stopped).toBeGreaterThan(0);
    expect(log.results).toHaveLength(0);
  });

  it("a recording the system ended (the recorder stops by itself) is kept and reported as ended, once", async () => {
    const { rec, recorder, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(2000);
    recorder.systemStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.reason).toBe("ended");
    expect(log.results[0]!.blob.size).toBe(3);
    expect(log.phases.at(-1)).toBe("idle");
  });

  it("a microphone track that ends is the same: kept, ended, one result", async () => {
    const { rec, tracks, log } = setup();
    await rec.start();
    await vi.advanceTimersByTimeAsync(2000);
    tracks[0]!.onended?.();
    tracks[0]!.onended?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(log.results).toHaveLength(1);
    expect(log.results[0]!.reason).toBe("ended");
  });

  it("a closed permission prompt (not reported as denied) is dismissed; a denied one is denied", async () => {
    const notAllowed = () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    const dismissed = setup({ media: notAllowed, permission: async () => "prompt" });
    await dismissed.rec.start();
    expect(dismissed.log.errors).toEqual(["dismissed"]);
    const denied = setup({ media: notAllowed, permission: async () => "denied" });
    await denied.rec.start();
    expect(denied.log.errors).toEqual(["denied"]);
    const unknown = setup({ media: notAllowed, permission: async () => undefined });
    await unknown.rec.start();
    expect(unknown.log.errors).toEqual(["denied"]);
  });

  it("cancelling while the microphone is being asked for ends the request and sends nothing", async () => {
    let answer!: (s: StreamLike) => void;
    const { rec, tracks, log } = setup({ media: () => new Promise((r) => (answer = r)) });
    const started = rec.start();
    expect(log.phases).toEqual(["asking"]);
    rec.cancel();
    expect(log.phases.at(-1)).toBe("idle");
    answer({ getTracks: () => tracks });
    await started;
    expect(tracks[0]!.stopped).toBe(1);
    expect(log.errors).toHaveLength(0);
  });
});
