import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { CloseDraft } from "@/domain/ai/draft";
import type { ClosePhotoFail } from "@/server/ai/close-photo";
import type { CloseVoiceFail } from "@/server/ai/close-voice";
import { AI_READ_REASONS, readErrorKey, readFromAi, transcribeAudio, type ReadReason } from "./ai-client";

// Type-level: a reason either route can return that the client does not know is a compile error here.
type Unknown = Exclude<ClosePhotoFail["reason"] | CloseVoiceFail["reason"], ReadReason>;
const everyServerReasonIsKnown: [Unknown] extends [never] ? true : never = true;

afterEach(() => vi.unstubAllGlobals());

const ID = "0123456789abcdef0123456789abcdef";
const draft = (over: Partial<CloseDraft> = {}): CloseDraft => ({
  source: "photo",
  date: "2026-11-14",
  fields: { "line:bev": { value: 118, confidence: 0.97, low: false, seenAs: "118" } },
  problems: [],
  reportDate: "2026-11-14",
  dateMismatch: false,
  ...over,
});
const reply = (status: number, body: unknown, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

const lookup = (catalog: unknown, dotted: string): unknown => dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), catalog);

describe("readErrorKey", () => {
  it("compiles only when every server reason is known", () => expect(everyServerReasonIsKnown).toBe(true));

  const ALL = ["bad_date", "not_selling_day", "too_large", "unsupported_type", "too_many_pixels", "corrupt", "storage_failed", "company_off", "disabled", "no_notice", "no_provider", "audio_type", "rate_limited", "quota", "failed", "unreadable", "nothing_heard", "empty", "timeout", "busy"];

  it("covers every reason the two routes can return", () => {
    for (const r of ALL) expect(AI_READ_REASONS, r).toContain(r);
  });

  it("every reason maps to copy that exists in ar, en and ur, for photo and voice", () => {
    for (const kind of ["photo", "voice"] as const) {
      for (const reason of [...AI_READ_REASONS, "something_new", "unauthorized", "forbidden", "bad_request", "no_file", "no_audio"]) {
        const key = readErrorKey(kind, reason);
        for (const [name, c] of [["ar", ar], ["en", en], ["ur", ur]] as const) {
          expect(typeof lookup(c, key), `${name} ${kind} ${reason} -> ${key}`).toBe("string");
        }
      }
    }
  });

  it("picks the voice or photo wording where they differ", () => {
    expect(readErrorKey("photo", "unreadable")).toBe("close.draft.unreadable");
    expect(readErrorKey("voice", "nothing_heard")).toBe("close.draft.nothingHeard");
    expect(readErrorKey("voice", "empty")).toBe("close.draft.nothingHeard");
    expect(readErrorKey("voice", "too_large")).not.toBe(readErrorKey("photo", "too_large"));
    expect(readErrorKey("voice", "unsupported_type")).toBe("ai.unavailable.audio_type");
    expect(readErrorKey("photo", "company_off")).toBe("ai.unavailable.disabled");
    // the shared timeout copy talks about a recording; a photo has its own
    expect(readErrorKey("voice", "timeout")).toBe("ai.unavailable.timeout");
    expect(readErrorKey("photo", "timeout")).toBe("close.read.errors.photo_timeout");
  });
});

describe("readFromAi", () => {
  it("posts the photo to close-photo with the custom header, a timeout signal and the date", async () => {
    const fetchMock = vi.fn(async () => reply(200, { draft: draft(), draftId: ID }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readFromAi("photo", "2026-11-14", new Blob(["x"], { type: "image/jpeg" }));
    expect(r).toEqual({ ok: true, draft: draft(), draftId: ID });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/app/ai/close-photo");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("x-requested-with")).toBe("ai");
    const fd = init.body as FormData;
    expect(fd.get("date")).toBe("2026-11-14");
    expect(fd.get("file")).toBeInstanceOf(Blob);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("posts a voice note to close-voice and returns the transcript", async () => {
    const fetchMock = vi.fn(async () => reply(200, { draft: draft({ source: "voice" }), draftId: ID, transcript: "مشروبات مية وعشرين" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readFromAi("voice", "2026-11-14", new Blob(["x"], { type: "audio/webm" }));
    expect(r).toEqual({ ok: true, draft: draft({ source: "voice" }), draftId: ID, transcript: "مشروبات مية وعشرين" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/app/ai/close-voice");
    expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
  });

  it("sends the cut reason of a cut recording as a form field, and only then", async () => {
    const fetchMock = vi.fn(async () => reply(200, { draft: draft({ source: "voice" }), draftId: ID, transcript: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readFromAi("voice", "2026-11-14", new Blob(["x"]), { cut: "hidden" });
    expect(r).toMatchObject({ ok: true, cut: "hidden" });
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get("cut")).toBe("hidden");
    const plain = await readFromAi("voice", "2026-11-14", new Blob(["x"]));
    expect(plain).not.toHaveProperty("cut");
    expect(((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData).has("cut")).toBe(false);
  });

  it("works where AbortSignal.timeout does not exist (a timer aborts instead)", async () => {
    vi.useFakeTimers();
    const original = AbortSignal.timeout;
    // @ts-expect-error removing the static for the test
    delete AbortSignal.timeout;
    try {
      vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => (init.signal as AbortSignal).addEventListener("abort", () => rej(new DOMException("t", "TimeoutError"))))));
      const pending = readFromAi("photo", "2026-11-14", new Blob(["x"]));
      await vi.advanceTimersByTimeAsync(55_001);
      expect(await pending).toEqual({ ok: false, reason: "timeout" });
    } finally {
      AbortSignal.timeout = original;
      vi.useRealTimers();
    }
  });

  it("maps the server's reason codes and statuses", async () => {
    const cases: [number, unknown, string, string?][] = [
      [429, { reason: "quota" }, "quota"],
      [429, { reason: "rate_limited" }, "rate_limited"],
      [422, { reason: "unreadable" }, "unreadable"],
      [503, { reason: "busy" }, "busy"],
      [400, { reason: "not_selling_day" }, "not_selling_day"],
      [504, { reason: "timeout" }, "timeout"],
      [403, { reason: "no_notice" }, "no_notice"],
      [500, { reason: "storage_failed" }, "storage_failed"],
      [502, "<html>bad gateway</html>", "failed"],
      [504, "<html>gateway timeout</html>", "timeout"],
      [429, "slow down", "rate_limited"],
      [422, "nope", "unreadable"],
      [413, "<html>too big</html>", "too_large"],
      [503, "<html>x</html>", "failed"],
      [200, { draft: draft(), draftId: "nope" }, "failed"],
      [200, "<html>", "failed"],
      [403, { reason: "<script>alert(1)</script>" }, "failed"],
    ];
    for (const [status, body, reason] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(status, body, typeof body === "string" ? "text/html" : "application/json")));
      const r = await readFromAi("photo", "2026-11-14", new Blob(["x"]));
      expect(r, `${status} ${JSON.stringify(body)}`).toEqual({ ok: false, reason });
    }
  });

  it("401 is unauthorized (sign in again), other bad requests are bad_request", async () => {
    for (const [status, body, reason] of [
      [401, { reason: "unauthorized" }, "unauthorized"],
      [401, "<html>", "unauthorized"],
      [403, { reason: "forbidden" }, "bad_request"],
      [400, { reason: "no_file" }, "bad_request"],
      [400, { reason: "bad_request" }, "bad_request"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(status, body, typeof body === "string" ? "text/html" : "application/json")));
      expect(await readFromAi("photo", "2026-11-14", new Blob(["x"])), `${status}`).toEqual({ ok: false, reason });
    }
    expect(readErrorKey("photo", "unauthorized")).toBe("close.read.errors.unauthorized");
    expect(readErrorKey("photo", "bad_request")).toBe("close.read.errors.bad_request");
  });

  it("the caller's abort still works where AbortSignal.any does not exist, and the request has a 55 s limit", async () => {
    const original = AbortSignal.any;
    // @ts-expect-error removing the static for the test
    delete AbortSignal.any;
    try {
      const ctl = new AbortController();
      let seen: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => {
        seen = init.signal as AbortSignal;
        return new Promise<Response>((_res, rej) => seen!.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))));
      }));
      const pending = readFromAi("photo", "2026-11-14", new Blob(["x"]), { signal: ctl.signal });
      ctl.abort();
      expect(await pending).toEqual({ ok: false, reason: "cancelled" });
      expect(seen?.aborted).toBe(true);
    } finally {
      AbortSignal.any = original;
    }
    const spy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { draft: draft(), draftId: ID })));
    await readFromAi("photo", "2026-11-14", new Blob(["x"]));
    expect(spy).toHaveBeenCalledWith(55_000);
    spy.mockRestore();
  });

  it("keeps the transcript of a nothing_heard reply, as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(422, { reason: "nothing_heard", transcript: "يعني النهارده كان يوم كويس" })));
    expect(await readFromAi("voice", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, reason: "nothing_heard", transcript: "يعني النهارده كان يوم كويس" });
  });

  it("refuses a draft for another date, another source, a broken shape or a bad receipt id", async () => {
    for (const body of [
      { draft: draft({ date: "2026-11-12" }), draftId: ID },
      { draft: draft({ source: "voice" }), draftId: ID },
      { draft: { ...draft(), fields: { "line:bev": { value: "118" } } }, draftId: ID },
      { draft: draft(), draftId: "../etc" },
      { draftId: ID },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(200, body)));
      expect(await readFromAi("photo", "2026-11-14", new Blob(["x"])), JSON.stringify(body)).toEqual({ ok: false, reason: "failed" });
    }
  });

  it("a network error is failed, a timeout is timeout, a cancel is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await readFromAi("photo", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, reason: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("t", "TimeoutError"))));
    expect(await readFromAi("photo", "2026-11-14", new Blob(["x"]))).toEqual({ ok: false, reason: "timeout" });
    const ctl = new AbortController();
    ctl.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("a", "AbortError"))));
    expect(await readFromAi("photo", "2026-11-14", new Blob(["x"]), { signal: ctl.signal })).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("readErrorKey for the assistant (kinds transcribe and ask)", () => {
  const EXTRA = ["empty", "too_long", "too_large", "unsupported_type", "audio_type", "timeout", "unauthorized", "bad_request", "company_off", "disabled", "no_notice", "no_provider", "quota", "rate_limited", "failed", "unreadable", "busy", "no_audio", "something_new"];
  it("every reason has copy in ar, en and ur for both kinds", () => {
    for (const kind of ["transcribe", "ask"] as const) {
      for (const reason of EXTRA) {
        const key = readErrorKey(kind, reason);
        for (const [name, c] of [["ar", ar], ["en", en], ["ur", ur]] as const) expect(typeof lookup(c, key), `${name} ${kind} ${reason} -> ${key}`).toBe("string");
      }
    }
  });
  it("picks the assistant wording", () => {
    expect(readErrorKey("ask", "empty")).toBe("assistant.errors.empty");
    expect(readErrorKey("ask", "too_long")).toBe("assistant.errors.too_long");
    expect(readErrorKey("transcribe", "empty")).toBe("assistant.errors.nothingHeard");
    expect(readErrorKey("transcribe", "too_large")).toBe("close.read.errors.audio_too_large");
    expect(readErrorKey("transcribe", "unsupported_type")).toBe("ai.unavailable.audio_type");
    expect(readErrorKey("ask", "quota")).toBe("ai.unavailable.quota");
    expect(readErrorKey("ask", "no_provider")).toBe("ai.unavailable.disabled");
  });
});

describe("transcribeAudio", () => {
  it("posts the recording to transcribe with the custom header and returns the transcript", async () => {
    const fetchMock = vi.fn(async () => reply(200, { transcript: "  مشروبات كام  " }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(new Blob(["x"], { type: "audio/webm" }));
    expect(r).toEqual({ ok: true, transcript: "مشروبات كام" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/app/ai/transcribe");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-requested-with"]).toBe("ai");
    expect((init.body as FormData).get("audio")).toBeInstanceOf(Blob);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("maps reasons and statuses, never trusts a reply without a transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(422, { reason: "empty" })));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "empty" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(504, "gateway", "text/html")));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "timeout" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { transcript: 5 })));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "failed" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { transcript: "   " })));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "empty" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { reason: "unauthorized" })));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "unauthorized" });
  });
  it("a cancel is cancelled, a network error is failed", async () => {
    const ctl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { ctl.abort(); throw new DOMException("aborted", "AbortError"); }));
    expect(await transcribeAudio(new Blob(["x"]), { signal: ctl.signal })).toEqual({ ok: false, reason: "cancelled" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    expect(await transcribeAudio(new Blob(["x"]))).toEqual({ ok: false, reason: "failed" });
  });
});
