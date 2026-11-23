import type { AiKind, ProviderName } from "./config";
import { REPLY_MAX } from "./json";
import { AiError, type AiErrorCode, type AiProvider, type AudioMime, type TextResult, type Usage } from "./types";

export type RunOk<T> = {
  ok: true;
  value: T;
  provider: ProviderName;
  model: string;
  attempts: number;
  fallback: boolean;
  latencyMs: number;
  usage: Usage;
};
export type RunFail = { ok: false; code: AiErrorCode; provider: ProviderName | null; attempts: number; latencyMs: number };
/** `abortAfter` defaults to `AbortSignal.timeout` (R47); tests pass one driven by a fake clock. */
export type RunDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  abortAfter: (ms: number) => AbortSignal;
};

export const CALL_TIMEOUT_MS = 12_000;
export const DEADLINE_MS = 25_000;
export const MAX_ATTEMPTS_PER_PROVIDER = 2;
/** A retry is made only while the run's deadline leaves at least this much after the wait. */
const RETRY_MIN_LEFT_MS = 2_000;
/** Longest provider-requested wait (Retry-After) honoured before a rate-limit retry. */
const RATE_LIMIT_MAX_WAIT_MS = 2_000;
const BACKOFF_BASE_MS = 300;
const BACKOFF_JITTER_MS = 600;

const defaultDeps: RunDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  abortAfter: (ms) => AbortSignal.timeout(ms),
};

export type RunJob<T> = {
  kind: AiKind;
  providers: AiProvider[];
  call: (p: AiProvider, signal: AbortSignal) => Promise<TextResult>;
  parse: (text: string) => T | null;
  /** Absolute time on the `now` clock; the run never goes past it (R33). Ignored unless finite. */
  deadlineAt?: number;
  /** For an stt job: providers that cannot take this recording are skipped without a request (R48). */
  audioMime?: AudioMime;
};

type Attempt<T> = { ok: true; value: T; usage: Usage } | { ok: false; code: AiErrorCode; retryAfterMs?: number };

const ABORTED = new Error("aborted");
const CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  "timeout",
  "rate_limited",
  "provider_error",
  "bad_request",
  "invalid_output",
]);

/** Rejects as soon as `signal` aborts, so a call that ignores its signal still ends on time. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(ABORTED);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function count(n: unknown): number | null {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function attempt<T>(job: RunJob<T>, p: AiProvider, signal: AbortSignal): Promise<Attempt<T>> {
  let result: TextResult;
  try {
    result = await untilAborted(Promise.resolve().then(() => job.call(p, signal)), signal);
  } catch (e) {
    // Only the code survives: the error object (and anything a provider put in it) is dropped here.
    if (signal.aborted) return { ok: false, code: "timeout" };
    if (e instanceof AiError && CODES.has(e.code)) {
      const retryAfterMs = count(e.retryAfterMs) ?? undefined;
      return { ok: false, code: e.code, retryAfterMs };
    }
    return { ok: false, code: "provider_error" };
  }
  const text: unknown = result?.text;
  if (typeof text !== "string" || text.length > REPLY_MAX) return { ok: false, code: "invalid_output" };
  let value: T | null | undefined;
  try {
    value = job.parse(text);
  } catch {
    value = null;
  }
  if (value === null || value === undefined) return { ok: false, code: "invalid_output" };
  return { ok: true, value, usage: { tokensIn: count(result.usage?.tokensIn), tokensOut: count(result.usage?.tokensOut) } };
}

function waitBeforeRetry(a: Exclude<Attempt<unknown>, { ok: true }>, random: () => number): number | null {
  switch (a.code) {
    case "timeout":
    case "provider_error":
      return BACKOFF_BASE_MS + Math.floor(random() * BACKOFF_JITTER_MS);
    case "rate_limited":
      return a.retryAfterMs !== undefined && a.retryAfterMs <= RATE_LIMIT_MAX_WAIT_MS ? a.retryAfterMs : null;
    default:
      return null; // bad_request, invalid_output: the next provider is tried
  }
}

/**
 * Runs one AI job: providers in order, each call bounded by a timeout and the run by a deadline,
 * one retry with jitter on timeout, provider_error or a short rate limit, then the next provider.
 * Never throws and never logs; the result holds codes and counts only.
 */
export async function runAi<T>(job: RunJob<T>, deps: Partial<RunDeps> = {}): Promise<RunOk<T> | RunFail> {
  // An entry passed as `undefined` keeps the default instead of replacing it.
  const given = Object.fromEntries(Object.entries(deps ?? {}).filter(([, v]) => v !== undefined));
  const d: RunDeps = { ...defaultDeps, ...given };
  let start = 0;
  let attempts = 0;
  let lastCode: AiErrorCode = "provider_error";
  let lastProvider: ProviderName | null = null;
  try {
    start = d.now();
    // A deadlineAt that is not a finite number (NaN, ±Infinity) is ignored: the run's own
    // deadline still bounds it.
    const deadlineAt = Number.isFinite(job.deadlineAt) ? (job.deadlineAt as number) : Number.POSITIVE_INFINITY;
    const deadline = Math.min(start + DEADLINE_MS, deadlineAt);
    const usable = job.providers.filter(
      (p) => p.modelFor(job.kind) !== null && (job.audioMime === undefined || p.acceptsAudio(job.audioMime)),
    );
    if (usable.length > 0 && deadline <= start) lastCode = "timeout";

    providers: for (const [index, p] of usable.entries()) {
      const model = p.modelFor(job.kind) as string;
      for (let n = 0; n < MAX_ATTEMPTS_PER_PROVIDER; n++) {
        const left = deadline - d.now();
        if (left <= 0) break providers;
        attempts++;
        lastProvider = p.name;
        const a = await attempt(job, p, d.abortAfter(Math.min(CALL_TIMEOUT_MS, left)));
        if (a.ok) {
          return {
            ok: true,
            value: a.value,
            provider: p.name,
            model,
            attempts,
            fallback: index > 0,
            latencyMs: d.now() - start,
            usage: a.usage,
          };
        }
        lastCode = a.code;
        if (n + 1 >= MAX_ATTEMPTS_PER_PROVIDER) break;
        const wait = waitBeforeRetry(a, d.random);
        if (wait === null || deadline - d.now() - wait < RETRY_MIN_LEFT_MS) break;
        await d.sleep(wait);
      }
    }
  } catch {
    // A provider's own method (modelFor, acceptsAudio) or an injected dependency threw.
    lastCode = "provider_error";
  }
  let latencyMs = 0;
  try {
    latencyMs = d.now() - start;
  } catch {
    latencyMs = 0;
  }
  return { ok: false, code: lastCode, provider: lastProvider, attempts, latencyMs };
}
