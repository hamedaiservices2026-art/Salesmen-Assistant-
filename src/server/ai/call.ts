import type { Ctx } from "@/server/ctx";
import { aiAvailability, type AiUnavailable } from "./availability";
import { readAiConfig, type AiConfig } from "./config";
import { getProviders } from "./providers";
import { reserveAi } from "./quota";
import { runAi, type RunDeps } from "./run";
import type { AiKind, AiProvider, AudioMime, TextResult } from "./types";
import { logUsage, type AiFeature } from "./usage";

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

  const quota = await reserveAi(ctx, kind, now, { day: config.globalDay[kind], minute: config.globalMinute[kind] });
  if (quota === "rate_limited") return { ok: false, reason: "rate_limited" };
  if (quota !== "ok") {
    await logUsage(ctx, {
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
    return { ok: false, reason: "quota" };
  }

  const providers = opts.providers ?? getProviders(kind, config);
  const r = await runAi(
    { kind, providers, call: spec.call, parse: spec.parse, deadlineAt: opts.deadlineAt, audioMime: spec.audioMime },
    opts.deps,
  );
  await logUsage(ctx, {
    kind,
    feature,
    provider: r.provider,
    model: r.ok ? r.model : null,
    outcome: r.ok ? "ok" : r.code,
    attempts: r.attempts,
    fallback: r.ok ? r.fallback : false,
    latencyMs: r.latencyMs,
    usage: r.ok ? r.usage : NO_USAGE,
    topic,
  });
  if (r.ok) return { ok: true, value: r.value, fallback: r.fallback };
  return { ok: false, reason: r.code === "invalid_output" ? "unreadable" : "failed" };
}
