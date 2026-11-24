import { describe, expect, it } from "vitest";
import { elapsedLabel, MAX_RECORD_MS, pickRecorderMime, recorderErrorKind, recorderSupport } from "./recorder";

describe("pickRecorderMime", () => {
  it("takes the first supported type in order", () => {
    expect(pickRecorderMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/ogg;codecs=opus" || m === "audio/mp4")).toBe("audio/mp4");
  });
  it("iOS Safari only knows audio/mp4", () => {
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
  });
  it("null when none is supported", () => {
    expect(pickRecorderMime(() => false)).toBeNull();
  });
  it("a throwing isTypeSupported counts as unsupported", () => {
    expect(
      pickRecorderMime((m) => {
        if (m === "audio/webm;codecs=opus") throw new Error("boom");
        return m === "audio/mp4";
      }),
    ).toBe("audio/mp4");
  });
});

describe("recorderSupport", () => {
  it("is ok only with media devices, a recorder and a secure context", () => {
    expect(recorderSupport({ mediaDevices: true, mediaRecorder: true, secure: true })).toBe("ok");
    expect(recorderSupport({ mediaDevices: true, mediaRecorder: false, secure: true })).toBe("unsupported");
    expect(recorderSupport({ mediaDevices: false, mediaRecorder: true, secure: true })).toBe("unsupported");
    expect(recorderSupport({ mediaDevices: true, mediaRecorder: true, secure: false })).toBe("unsupported");
  });
});

describe("recorderErrorKind", () => {
  it("a refused permission is denied, anything else failed", () => {
    expect(recorderErrorKind("NotAllowedError")).toBe("denied");
    expect(recorderErrorKind("SecurityError")).toBe("denied");
    expect(recorderErrorKind("NotFoundError")).toBe("failed");
    expect(recorderErrorKind(undefined)).toBe("failed");
  });
});

describe("elapsedLabel", () => {
  it("is m:ss in Western digits and stops at the limit", () => {
    expect(elapsedLabel(0)).toBe("0:00");
    expect(elapsedLabel(7_400)).toBe("0:07");
    expect(elapsedLabel(59_999)).toBe("0:59");
    expect(elapsedLabel(MAX_RECORD_MS)).toBe("1:00");
    expect(elapsedLabel(MAX_RECORD_MS + 5_000)).toBe("1:00");
    expect(elapsedLabel(-5)).toBe("0:00");
  });
  it("the limit is 60 seconds", () => {
    expect(MAX_RECORD_MS).toBe(60_000);
  });
});
