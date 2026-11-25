import { todayIn } from "@/domain/calendar";
import type { Ctx } from "@/server/ctx";
import { aiAvailability, type AiUnavailable } from "./availability";
import { readAiConfig, type AiConfig } from "./config";
import { getProviders } from "./providers";
import { reserveAi, type QuotaResult } from "./quota";
import { runAi, type RunDeps } from "./run";
import type { AiKind, AiProvider, AudioMime, TextResult } from "./types";
import { logUsage, type AiFeature, type UsageRow } from "./usage";

export type AiCallFail = { ok: false; reason: AiUnavailable | "rate_limited" | "quota" | "failed" | "unreadable" };

export type AiCallSpec<T> = {
  kind: AiKind;
  feature: AiFeature;
  call: (p: AiProvider, signal: AbortSignal) => Promise<TextResult>;
  parse: (text: string) => T | null;
  /** A topic code from a closed list (Task 15); anything else is stored as null. */
  topic?: string | null;
  /** For an stt job: providers that refuse this recording are skipped (R48). */
  audioMime?: AudioMime;
};

export type AiCallOpts = {
  now?: Date;
  config?: AiConfig;
  deps?: Partial<RunDeps>;
  /** Absolute time on the runner's clock (R33). */
  deadlineAt?: number;
  /** Tests only: replaces `getProviders(kind, config)`, for the `no_provider` check as well (R27). */
  providers?: AiProvider[];
};

const NO_USAGE = { tokensIn: null, tokensOut: null };

/**
 * Logs a quota refusal as `rejected`, at most once per user, kind, day and reason (deterministic
 * id, conflicts ignored; R67), and not at all for `user_quota` (his own day counter is at its
 * limit): a rep who keeps pressing the button must not grow the log.
 */
export async function logRejection(
  ctx: Ctx,
  kind: AiKind,
  feature: AiFeature,
  topic: string | null,
  reason: Exclude<QuotaResult, "ok" | "rate_limited">,
  now: Date,
): Promise<void> {
  // The user-day step refuses first, so his counter is at its limit: the counters show it.
  if (reason === "user_quota") return;
  await logUsage(ctx, {
    id: `rej:${ctx.userId}:${kind}:${todayIn(ctx.timeZone, now)}:${reason}`,
    kind,
    feature,
    provider: null,
    model: null,
    outcome: "rejected",
    attempts: 0,
    fallback: false,
    latencyMs: 0,
    usage: NO_USAGE,
    topic,
  });
}

/**
 * The one way a feature talks to a model: availability → quota → run → usage log → result.
 * A refusal before the run moves no counter and calls no provider; a quota refusal is logged as
 * `rejected` with 0 attempts, the other early refusals are not logged. Once reserved, a request
 * counts whatever happens (nothing is refunded) and is always logged.
 */
export async function aiCall<T>(
  ctx: Ctx,
  spec: AiCallSpec<T>,
  opts: AiCallOpts = {},
): Promise<{ ok: true; value: T; fallback: boolean } | AiCallFail> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? readAiConfig(process.env);
  const { kind, feature } = spec;
  const topic = spec.topic ?? null;

  const available = await aiAvailability(ctx, kind, config, opts.providers);
  if (!available.ok) return { ok: false, reason: available.reason };

  // A recording no provider can take (its type is not on any provider's list; R48) is refused here,
  // before a counter moves and without a usage row: it would only burn a request.
  const providersFor = opts.providers ?? getProviders(kind, config);
  if (spec.audioMime !== undefined && !providersFor.some((p) => p.modelFor(kind) !== null && p.acceptsAudio(spec.audioMime as AudioMime))) {
    return { ok: false, reason: "no_provider" };
  }

  const quota = await reserveAi(ctx, kind, now, { day: config.globalDay[kind], minute: config.globalMinute[kind] });
  if (quota === "rate_limited") return { ok: false, reason: "rate_limited" };
  if (quota !== "ok") {
    await logRejection(ctx, kind, feature, topic, quota, now);
    return { ok: false, reason: "quota" };
  }

  // From here the slot is spent: whatever happens, exactly one row is written.
  let row: UsageRow = {
    kind,
    feature,
    provider: null,
    model: null,
    outcome: "provider_error",
    attempts: 0,
    fallback: false,
    latencyMs: 0,
    usage: NO_USAGE,
    topic,
  };
  let r: Awaited<ReturnType<typeof runAi<T>>>;
  try {
    const providers = providersFor;
    r = await runAi(
      { kind, providers, call: spec.call, parse: spec.parse, deadlineAt: opts.deadlineAt, audioMime: spec.audioMime },
      opts.deps,
    );
    row = {
      ...row,
      provider: r.provider,
      model: r.ok ? r.model : null,
      outcome: r.ok ? "ok" : r.code,
      attempts: r.attempts,
      fallback: r.ok ? r.fallback : false,
      latencyMs: r.latencyMs,
      usage: r.ok ? r.usage : NO_USAGE,
    };
  } catch {
    // The runner never throws by design; if it ever does, nothing of the error is kept.
    return { ok: false, reason: "failed" };
  } finally {
    await logUsage(ctx, row);
  }
  if (r.ok) return { ok: true, value: r.value, fallback: r.fallback };
  return { ok: false, reason: r.code === "invalid_output" ? "unreadable" : "failed" };
}
