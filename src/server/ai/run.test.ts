import { describe, expect, it, vi } from "vitest";
import type { AiKind, ProviderName } from "./config";
import { parseJsonReply } from "./json";
import { CALL_TIMEOUT_MS, DEADLINE_MS, MAX_ATTEMPTS_PER_PROVIDER, runAi, type RunDeps } from "./run";
import { AiError, type AiProvider, type AudioMime, type TextResult } from "./types";

const START = 1_000_000;

/** A fake clock: `sleep` advances it; `abortAfter` signals fire when the clock passes their time. */
function harness() {
  let t = START;
  const timers: { ms: number; at: number; ctrl: AbortController; firedAt?: number }[] = [];
  const sleeps: number[] = [];
  const advance = (ms: number) => {
    t += ms;
    for (const tm of timers) {
      if (!tm.ctrl.signal.aborted && t >= tm.at) {
        tm.firedAt = tm.at - START;
        tm.ctrl.abort();
      }
    }
  };
  const deps: RunDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      advance(ms);
    },
    random: () => 0.5,
    abortAfter: (ms) => {
      const ctrl = new AbortController();
      timers.push({ ms, at: t + ms, ctrl });
      return ctrl.signal;
    },
  };
  return { deps, sleeps, timers, advance };
}

type Behaviour = (signal: AbortSignal) => Promise<TextResult>;

const usage = { tokensIn: 3, tokensOut: 4 };
const answer = (text: string): Behaviour => async () => ({ text, usage });
const failWith =
  (name: ProviderName, code: AiError["code"], retryAfterMs?: number): Behaviour =>
  async () => {
    throw new AiError(code, name, retryAfterMs);
  };

function scripted(
  name: ProviderName,
  behaviours: Behaviour[],
  opts: { model?: string | null; accepts?: boolean } = {},
): AiProvider & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn();
  const next = (signal: AbortSignal) => {
    const i = Math.min(calls.mock.calls.length, behaviours.length - 1);
    calls(signal);
    return behaviours[i]!(signal);
  };
  const model = opts.model === undefined ? `${name}-m` : opts.model;
  return {
    name,
    calls,
    modelFor: () => model,
    acceptsAudio: () => opts.accepts ?? true,
    vision: (_req, signal) => next(signal),
    stt: (_req, signal) => next(signal),
    chat: (_req, signal) => next(signal),
  };
}

const chatReq = { system: "s", messages: [{ role: "user" as const, text: "q" }], maxOutputTokens: 100 };
const parseObject = (text: string) => {
  const v = parseJsonReply(text);
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
};

function chatJob(providers: AiProvider[], extra: { deadlineAt?: number; parse?: (t: string) => unknown; kind?: AiKind } = {}) {
  return {
    kind: extra.kind ?? ("chat" as AiKind),
    providers,
    call: (p: AiProvider, signal: AbortSignal) => p.chat(chatReq, signal),
    parse: extra.parse ?? parseObject,
    deadlineAt: extra.deadlineAt,
  };
}

describe("runAi", () => {
  it("has the plan's constants", () => {
    expect(CALL_TIMEOUT_MS).toBe(12_000);
    expect(DEADLINE_MS).toBe(25_000);
    expect(MAX_ATTEMPTS_PER_PROVIDER).toBe(2);
  });

  it("returns the first provider's parsed answer", async () => {
    const h = harness();
    const a = scripted("gemini", [answer('{"a":1}')]);
    const b = scripted("openrouter", [answer('{"b":2}')]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toEqual({
      ok: true,
      value: { a: 1 },
      provider: "gemini",
      model: "gemini-m",
      attempts: 1,
      fallback: false,
      latencyMs: 0,
      usage,
    });
    expect(b.calls).not.toHaveBeenCalled();
  });

  it("retries a timeout once after 600 ms, then falls back", async () => {
    const h = harness();
    const a = scripted("gemini", [failWith("gemini", "timeout")]);
    const b = scripted("openrouter", [answer('{"b":2}')]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toMatchObject({ ok: true, provider: "openrouter", attempts: 3, fallback: true, value: { b: 2 } });
    expect(h.sleeps).toEqual([600]);
    expect(a.calls).toHaveBeenCalledTimes(2);
  });

  it("retries provider_error once on the same provider", async () => {
    const h = harness();
    const a = scripted("gemini", [failWith("gemini", "provider_error"), answer('{"a":1}')]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: true, attempts: 2, fallback: false, latencyMs: 600 });
    expect(h.sleeps).toEqual([600]);
  });

  it("does not retry bad_request on the same provider", async () => {
    const h = harness();
    const a = scripted("gemini", [failWith("gemini", "bad_request")]);
    const b = scripted("openrouter", [answer('{"b":2}')]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toMatchObject({ ok: true, provider: "openrouter", attempts: 2, fallback: true });
    expect(h.sleeps).toEqual([]);
    expect(a.calls).toHaveBeenCalledTimes(1);
  });

  it("treats an unparseable reply as invalid_output and tries the next provider", async () => {
    const h = harness();
    const a = scripted("gemini", [answer("not json")]);
    const b = scripted("openrouter", [answer('{"b":2}')]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toMatchObject({ ok: true, provider: "openrouter", fallback: true, attempts: 2 });
    expect(a.calls).toHaveBeenCalledTimes(1);
  });

  it("fails invalid_output when every provider replies garbage", async () => {
    const h = harness();
    const a = scripted("gemini", [answer("not json")]);
    const b = scripted("openrouter", [answer("Sure! {}")]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toEqual({ ok: false, code: "invalid_output", provider: "openrouter", attempts: 2, latencyMs: 0 });
    expect(h.sleeps).toEqual([]);
  });

  it("waits retryAfterMs for a rate limit up to 2000 ms", async () => {
    const h = harness();
    const a = scripted("gemini", [failWith("gemini", "rate_limited", 1500), answer('{"a":1}')]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(h.sleeps).toEqual([1500]);
  });

  it("does not retry a rate limit asking for a long wait, or with no wait given", async () => {
    for (const retryAfter of [30_000, undefined]) {
      const h = harness();
      const a = scripted("gemini", [failWith("gemini", "rate_limited", retryAfter)]);
      const b = scripted("openrouter", [answer('{"b":2}')]);
      const r = await runAi(chatJob([a, b]), h.deps);
      expect(r).toMatchObject({ ok: true, provider: "openrouter", attempts: 2 });
      expect(h.sleeps).toEqual([]);
      expect(a.calls).toHaveBeenCalledTimes(1);
    }
  });

  it("aborts a call that never resolves at 12 000 ms of fake time", async () => {
    const h = harness();
    const a = scripted("gemini", [
      async () => {
        h.advance(13_000);
        return new Promise<TextResult>(() => {});
      },
    ]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: false, code: "timeout", provider: "gemini", attempts: 2 });
    expect(h.timers[0]).toMatchObject({ ms: 12_000, firedAt: 12_000 });
    // The retry's signal is bounded by the time left to the deadline.
    expect(h.timers[1]?.ms).toBe(DEADLINE_MS - 13_600);
    expect(h.sleeps).toEqual([600]);
  });

  it("treats an AbortError thrown by a call as a timeout", async () => {
    const h = harness();
    const a = scripted("gemini", [
      (signal) =>
        new Promise<TextResult>((_res, rej) => {
          signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
          h.advance(12_000);
        }),
    ]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: false, code: "timeout" });
  });

  it("skips the retry when less than 2000 ms would be left", async () => {
    const h = harness();
    const a = scripted("gemini", [
      async () => {
        h.advance(24_500);
        return new Promise<TextResult>(() => {});
      },
    ]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(h.sleeps).toEqual([]);
  });

  it("uses deadlineAt when it is earlier than the run's own deadline", async () => {
    const h = harness();
    const a = scripted("gemini", [
      async () => {
        h.advance(6_000);
        return new Promise<TextResult>(() => {});
      },
    ]);
    const r = await runAi(chatJob([a], { deadlineAt: START + 5_000 }), h.deps);
    expect(r).toMatchObject({ ok: false, code: "timeout", attempts: 1 });
    expect(h.timers[0]).toMatchObject({ ms: 5_000, firedAt: 5_000 });
  });

  it("makes no request when the deadline has already passed", async () => {
    const h = harness();
    const a = scripted("gemini", [answer('{"a":1}')]);
    const r = await runAi(chatJob([a], { deadlineAt: START - 1 }), h.deps);
    expect(r).toMatchObject({ ok: false, code: "timeout", attempts: 0 });
    expect(a.calls).not.toHaveBeenCalled();
  });

  it("skips a provider that refuses the recording's audio type", async () => {
    const h = harness();
    const a = scripted("groq", [answer("x")], { accepts: false });
    const b = scripted("gemini", [answer("hello")]);
    const accepts = vi.spyOn(a, "acceptsAudio");
    const r = await runAi(
      {
        kind: "stt",
        providers: [a, b],
        call: (p, signal) => p.stt({ audio: new Uint8Array([1]), mime: "audio/webm", language: "ar" }, signal),
        parse: (t) => t,
        audioMime: "audio/webm" as AudioMime,
      },
      h.deps,
    );
    expect(accepts).toHaveBeenCalledWith("audio/webm");
    expect(a.calls).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, provider: "gemini", attempts: 1, fallback: false, value: "hello" });
  });

  it("skips a provider with no model for the job", async () => {
    const h = harness();
    const a = scripted("openrouter", [answer('{"a":1}')], { model: null });
    const b = scripted("gemini", [answer('{"b":2}')]);
    const r = await runAi(chatJob([a, b]), h.deps);
    expect(r).toMatchObject({ ok: true, provider: "gemini", fallback: false, attempts: 1 });
    expect(a.calls).not.toHaveBeenCalled();
  });

  it("fails provider_error with no usable provider", async () => {
    const h = harness();
    expect(await runAi(chatJob([]), h.deps)).toEqual({
      ok: false,
      code: "provider_error",
      provider: null,
      attempts: 0,
      latencyMs: 0,
    });
  });

  it("keeps nothing from a foreign error", async () => {
    const h = harness();
    const a = scripted("gemini", [
      async () => {
        throw new Error("key=k-123");
      },
    ]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: false, code: "provider_error", provider: "gemini", attempts: 2 });
    expect(JSON.stringify(r)).not.toContain("k-123");
  });

  it("refuses a reply over 20 000 characters without parsing it", async () => {
    const h = harness();
    const parse = vi.fn(() => ({}));
    const a = scripted("gemini", [answer("x".repeat(20_001))]);
    const r = await runAi(chatJob([a], { parse }), h.deps);
    expect(r).toMatchObject({ ok: false, code: "invalid_output", attempts: 1 });
    expect(parse).not.toHaveBeenCalled();
  });

  it("treats a parse that throws, or a reply that is not text, as invalid_output", async () => {
    const h = harness();
    const a = scripted("gemini", [answer("{}")]);
    const r1 = await runAi(
      chatJob([a], {
        parse: () => {
          throw new Error("boom");
        },
      }),
      h.deps,
    );
    expect(r1).toMatchObject({ ok: false, code: "invalid_output" });

    const b = scripted("gemini", [async () => ({ text: 42 as unknown as string, usage })]);
    expect(await runAi(chatJob([b]), h.deps)).toMatchObject({ ok: false, code: "invalid_output" });
  });

  it("never throws, even when a provider's own methods throw", async () => {
    const h = harness();
    const a = scripted("gemini", [answer("{}")]);
    a.modelFor = () => {
      throw new Error("key=k-123");
    };
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: false, code: "provider_error" });
    expect(JSON.stringify(r)).not.toContain("k-123");
  });

  it("measures latency on the injected clock, including sleeps", async () => {
    const h = harness();
    const a = scripted("gemini", [
      async () => {
        h.advance(1_000);
        throw new AiError("provider_error", "gemini");
      },
      async () => {
        h.advance(250);
        return { text: '{"a":1}', usage };
      },
    ]);
    const r = await runAi(chatJob([a]), h.deps);
    expect(r).toMatchObject({ ok: true, latencyMs: 1_850 });
  });
});

describe("AiError", () => {
  it("carries only provider and code in its message", () => {
    const e = new AiError("rate_limited", "groq", 1200);
    expect(e.message).toBe("groq:rate_limited");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("rate_limited");
    expect(e.provider).toBe("groq");
    expect(e.retryAfterMs).toBe(1200);
  });
});
