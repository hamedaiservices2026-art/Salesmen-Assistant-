import { describe, expect, it, vi } from "vitest";
import { readAiConfig } from "./config";
import { parseJsonReply } from "./json";
import { getProviders } from "./providers";
import { runAi, type RunDeps } from "./run";
import type { AiProvider } from "./types";

const KEY = "k-123-SECRET";
const deps: Partial<RunDeps> = { sleep: async () => {}, random: () => 0.5 };
const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const orOk = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: '{"from":"or"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
const busy = () => new Response("{}", { status: 503 });
const chatReq = { system: "s", messages: [{ role: "user" as const, text: "q" }], maxOutputTokens: 100 };
const job = (providers: AiProvider[]) => ({
  kind: "chat" as const,
  providers,
  call: (p: AiProvider, signal: AbortSignal) => p.chat(chatReq, signal),
  parse: (t: string) => parseJsonReply(t) as Record<string, unknown> | null,
});

function setup(env: Record<string, string>, respond: (url: string, n: number) => Response) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    return respond(String(url), urls.length);
  }) as unknown as typeof fetch;
  const providers = getProviders("chat", readAiConfig({ GEMINI_API_KEY: KEY, OPENROUTER_API_KEY: KEY, ...env }), fetchImpl);
  return { urls, providers };
}

describe("Gemini same-provider model fallback", () => {
  it("503 on the primary model twice, then 200 on the fallback model: recorded with the model used and fallback true", async () => {
    const { urls, providers } = setup({}, (url) => (url.includes("gemini-4-hydrogen") ? busy() : ok('{"ok":true}')));
    const r = await runAi(job(providers), deps);
    expect(r).toMatchObject({ ok: true, provider: "gemini", model: "gemini-3.5-flash-lite", fallback: true, attempts: 3, value: { ok: true } });
    expect(urls.map((u) => new URL(u).pathname.split("/").pop())).toEqual([
      "gemini-4-hydrogen:generateContent",
      "gemini-4-hydrogen:generateContent",
      "gemini-3.5-flash-lite:generateContent",
    ]);
    expect(urls.every((u) => new URL(u).host === "generativelanguage.googleapis.com")).toBe(true);
  });

  it("a 429 on the primary also moves to the fallback model", async () => {
    const { providers } = setup({}, (url) => (url.includes("hydrogen") ? new Response("{}", { status: 429 }) : ok('{"ok":true}')));
    const r = await runAi(job(providers), deps);
    expect(r).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite", fallback: true });
  });

  it("both Gemini models 503 → OpenRouter answers", async () => {
    const { urls, providers } = setup({}, (url) => (url.includes("openrouter.ai") ? orOk() : busy()));
    const r = await runAi(job(providers), deps);
    expect(r).toMatchObject({ ok: true, provider: "openrouter", model: "google/gemma-4-31b-it:free", fallback: true, attempts: 4 });
    expect(urls.filter((u) => u.includes("generativelanguage"))).toHaveLength(3);
  });

  it("a bad request on the primary (404 model) does not try the fallback model", async () => {
    const { urls, providers } = setup({}, (url) => (url.includes("openrouter.ai") ? orOk() : new Response("{}", { status: 404 })));
    const r = await runAi(job(providers), deps);
    expect(r).toMatchObject({ ok: true, provider: "openrouter" });
    expect(urls.filter((u) => u.includes("flash-lite"))).toHaveLength(0);
  });

  it("AI_GEMINI_FALLBACK_MODEL=none, or a fallback equal to the primary, adds no model fallback", async () => {
    for (const env of [{ AI_GEMINI_FALLBACK_MODEL: "none" }, { AI_GEMINI_FALLBACK_MODEL: "gemini-4-hydrogen" }]) {
      const { urls, providers } = setup(env, (url) => (url.includes("openrouter.ai") ? orOk() : busy()));
      const r = await runAi(job(providers), deps);
      expect(r).toMatchObject({ ok: true, provider: "openrouter" });
      expect(urls.filter((u) => u.includes("generativelanguage"))).toHaveLength(2);
    }
  });

  it("the fallback model attempt is inside the same deadline: a run whose deadline has passed makes no call", async () => {
    const { urls, providers } = setup({}, () => busy());
    const late = await runAi({ ...job(providers), deadlineAt: 0 }, { now: () => 0, sleep: async () => {}, random: () => 0.5 });
    expect(late).toMatchObject({ ok: false, attempts: 0 });
    expect(urls).toHaveLength(0);
  });
});
