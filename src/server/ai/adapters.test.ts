import { describe, expect, it, vi } from "vitest";
import { readAiConfig } from "./config";
import { MAX_RESPONSE_BYTES, postForm, postJson } from "./http";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { getProviders } from "./providers";
import { openrouterProvider } from "./openrouter";
import { AiError, type AiProvider } from "./types";

const KEY = "k-123-SECRET";
const CFG = readAiConfig({ GEMINI_API_KEY: KEY, GROQ_API_KEY: KEY, OPENROUTER_API_KEY: KEY, AI_OPENROUTER_VISION_MODEL: "vendor/free-vision:free", AI_OPENROUTER_CHAT_MODEL: "vendor/free-chat:free" });
const signal = () => new AbortController().signal;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const AUDIO = new Uint8Array([1, 2, 3, 4]);

type Call = { url: string; init: RequestInit };
/** A recorded fetch: answers with `respond` and remembers every request. */
function recorder(respond: () => Response | Promise<Response> = () => json(GEMINI_OK)) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  return { calls, fetchImpl };
}
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

// Recorded-shape fixtures (UNVERIFIED against the live providers; see docs/ai-providers.md).
const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
};
const GROQ_OK = { text: "مشروبات مية وعشرين كرتونة" };
const OR_OK = { choices: [{ message: { role: "assistant", content: '{"ok":true}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } };

const visionReq = { image: JPEG, system: "sys", prompt: "read it", maxOutputTokens: 500 };
const chatReq = { system: "sys", messages: [{ role: "user" as const, text: "q1" }, { role: "assistant" as const, text: "a1" }, { role: "user" as const, text: "q2" }], maxOutputTokens: 300 };

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as AiError;
  }
  throw new Error("did not reject");
}

describe("gemini adapter", () => {
  it("vision: constant host, key only in the x-goog-api-key header, image inline, no tools", async () => {
    const { calls, fetchImpl } = recorder();
    const r = await geminiProvider(CFG.gemini, fetchImpl).vision(visionReq, signal());
    expect(r).toEqual({ text: '{"ok":true}', usage: { tokensIn: 11, tokensOut: 5 } });
    const url = new URL(calls[0]!.url);
    expect(url.host).toBe("generativelanguage.googleapis.com");
    expect(url.protocol).toBe("https:");
    expect(calls[0]!.url).not.toContain("key=");
    expect(calls[0]!.url).not.toContain(KEY);
    const init = calls[0]!.init;
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64") });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: 500, responseMimeType: "application/json" });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("toolConfig");
  });

  it("chat: roles mapped, temperature 0.2, no tools", async () => {
    const { calls, fetchImpl } = recorder();
    await geminiProvider(CFG.gemini, fetchImpl).chat(chatReq, signal());
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(body).not.toHaveProperty("tools");
  });

  it("the model id is URL-encoded in the path", async () => {
    const { calls, fetchImpl } = recorder();
    const cfg = { ...CFG.gemini, chatModel: "tuned/x:v1" };
    await geminiProvider(cfg, fetchImpl).chat(chatReq, signal());
    expect(new URL(calls[0]!.url).pathname).toBe("/v1beta/models/tuned%2Fx%3Av1:generateContent");
  });

  it.each(["../../v1/other", "a/../b", "x?key=1", "x#frag", "a b", "m\r\nX-Evil: 1", "", "-start", "ü", "x".repeat(101)])(
    "a hostile model id %j makes no request",
    async (bad) => {
      const { fetchImpl } = recorder();
      const p = geminiProvider({ ...CFG.gemini, chatModel: bad, visionModel: bad, audioModel: bad }, fetchImpl);
      expect((await code(p.chat(chatReq, signal()))).code).toBe("bad_request");
      expect((await code(p.vision(visionReq, signal()))).code).toBe("bad_request");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("stt: inline audio and a verbatim-transcript instruction; token counts from the usage metadata", async () => {
    const { calls, fetchImpl } = recorder();
    const r = await geminiProvider(CFG.gemini, fetchImpl).stt({ audio: AUDIO, mime: "audio/webm", language: "ar" }, signal());
    expect(r.usage).toEqual({ tokensIn: 11, tokensOut: 5 });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe("audio/webm");
    expect(body.contents[0].parts[1].text).toMatch(/verbatim.*Arabic/);
    expect(new URL(calls[0]!.url).pathname).toContain("gemini-3.5-flash-lite");
  });

  it("stt with a type the document does not list → bad_request and no request (R48)", async () => {
    const { fetchImpl } = recorder();
    const p = geminiProvider(CFG.gemini, fetchImpl);
    expect(p.acceptsAudio("audio/mp4")).toBe(false);
    expect(p.acceptsAudio("audio/webm")).toBe(true);
    expect((await code(p.stt({ audio: AUDIO, mime: "audio/mp4", language: "ar" }, signal()))).code).toBe("bad_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a reply with no text → invalid_output; missing usage → null counts", async () => {
    const empty = recorder(() => json({ candidates: [{ finishReason: "SAFETY" }] }));
    expect((await code(geminiProvider(CFG.gemini, empty.fetchImpl).chat(chatReq, signal()))).code).toBe("invalid_output");
    const noUsage = recorder(() => json({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }));
    expect((await geminiProvider(CFG.gemini, noUsage.fetchImpl).chat(chatReq, signal())).usage).toEqual({ tokensIn: null, tokensOut: null });
  });

  it("without a key it has no model for any job", () => {
    const p = geminiProvider(readAiConfig({}).gemini);
    expect(p.modelFor("vision")).toBeNull();
    expect(p.modelFor("stt")).toBeNull();
  });
});

describe("groq adapter", () => {
  it("is stt only", () => {
    const p = groqProvider(CFG.groq);
    expect(p.modelFor("stt")).toBe("whisper-large-v3");
    expect(p.modelFor("vision")).toBeNull();
    expect(p.modelFor("chat")).toBeNull();
  });

  it("sends multipart with language, model and the file name for the type; key in the header only", async () => {
    const { calls, fetchImpl } = recorder(() => json(GROQ_OK));
    const p = groqProvider(CFG.groq, fetchImpl);
    const r = await p.stt({ audio: AUDIO, mime: "audio/mp4", language: "ar" }, signal());
    expect(r.text).toBe(GROQ_OK.text);
    const { url, init } = calls[0]!;
    expect(new URL(url).host).toBe("api.groq.com");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe("error");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("language")).toBe("ar");
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
    expect((form.get("file") as File).name).toBe("audio.m4a");
    expect([...new Uint8Array(await (form.get("file") as File).arrayBuffer())]).toEqual([...AUDIO]);
    for (const [mime, name] of [["audio/webm", "audio.webm"], ["audio/ogg", "audio.ogg"]] as const) {
      await p.stt({ audio: AUDIO, mime, language: "ur" }, signal());
      const f = calls.at(-1)!.init.body as FormData;
      expect((f.get("file") as File).name).toBe(name);
      expect(f.get("language")).toBe("ur");
    }
  });

  it("vision and chat are refused without a request", async () => {
    const { fetchImpl } = recorder();
    const p = groqProvider(CFG.groq, fetchImpl);
    expect((await code(p.vision(visionReq, signal()))).code).toBe("bad_request");
    expect((await code(p.chat(chatReq, signal()))).code).toBe("bad_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a reply without text → invalid_output", async () => {
    const { fetchImpl } = recorder(() => json({ nope: 1 }));
    expect((await code(groqProvider(CFG.groq, fetchImpl).stt({ audio: AUDIO, mime: "audio/webm", language: "en" }, signal()))).code).toBe("invalid_output");
  });
});

describe("openrouter adapter", () => {
  it("modelFor is null for an unset id and for stt", () => {
    const p = openrouterProvider({ key: CFG.openrouter.key, visionModel: null, chatModel: "vendor/free-chat:free" });
    expect(p.modelFor("vision")).toBeNull();
    expect(p.modelFor("chat")).toBe("vendor/free-chat:free");
    expect(p.modelFor("stt")).toBeNull();
    expect(p.acceptsAudio("audio/webm")).toBe(false);
  });

  it("vision: JPEG as a base64 data URL part; key in the header; no tools", async () => {
    const { calls, fetchImpl } = recorder(() => json(OR_OK));
    const r = await openrouterProvider(CFG.openrouter, fetchImpl).vision(visionReq, signal());
    expect(r).toEqual({ text: '{"ok":true}', usage: { tokensIn: 7, tokensOut: 3 } });
    const { url, init } = calls[0]!;
    expect(new URL(url).host).toBe("openrouter.ai");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("vendor/free-vision:free");
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}` } });
    expect(JSON.stringify(body)).not.toContain(KEY);
    for (const f of ["tools", "tool_choice", "functions", "plugins"]) expect(body).not.toHaveProperty(f);
  });

  it("chat: system then the history", async () => {
    const { calls, fetchImpl } = recorder(() => json(OR_OK));
    await openrouterProvider(CFG.openrouter, fetchImpl).chat(chatReq, signal());
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.max_tokens).toBe(300);
  });

  it("a request for a job with no model makes none", async () => {
    const { fetchImpl } = recorder();
    const p = openrouterProvider({ key: CFG.openrouter.key, visionModel: null, chatModel: null }, fetchImpl);
    expect((await code(p.vision(visionReq, signal()))).code).toBe("bad_request");
    expect((await code(p.chat(chatReq, signal()))).code).toBe("bad_request");
    expect((await code(p.stt({ audio: AUDIO, mime: "audio/webm", language: "ar" }, signal()))).code).toBe("bad_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the http layer", () => {
  const post = (r: () => Response | Promise<Response>, sig = signal()) => {
    const { fetchImpl } = recorder(r);
    return postJson("https://example.test/x", { "x-k": KEY }, { a: 1 }, sig, "gemini", fetchImpl);
  };

  it("a 429 with Retry-After: 2 → rate_limited, retryAfterMs 2000", async () => {
    const e = await code(post(() => new Response("{}", { status: 429, headers: { "retry-after": "2" } })));
    expect(e).toMatchObject({ code: "rate_limited", provider: "gemini", retryAfterMs: 2000 });
  });

  it("a 429 without a numeric Retry-After has no retryAfterMs", async () => {
    for (const h of [undefined, "Wed, 21 Oct 2026 07:28:00 GMT", "-5", "abc"]) {
      const e = await code(post(() => new Response("{}", { status: 429, headers: h === undefined ? {} : { "retry-after": h } })));
      expect(e.code).toBe("rate_limited");
      expect(e.retryAfterMs).toBeUndefined();
    }
  });

  it.each([[408, "timeout"], [400, "bad_request"], [401, "bad_request"], [403, "bad_request"], [404, "bad_request"], [413, "bad_request"], [422, "bad_request"], [500, "provider_error"], [502, "provider_error"], [503, "provider_error"], [418, "provider_error"]])(
    "status %i → %s",
    async (status, expected) => {
      expect((await code(post(() => new Response("{}", { status })))).code).toBe(expected);
    },
  );

  it("a 500 whose body names the key → provider_error that never mentions it", async () => {
    const e = await code(post(() => new Response('{"error":"bad key k-123"}', { status: 500 })));
    expect(e.code).toBe("provider_error");
    expect(e.message).toBe("gemini:provider_error");
    expect(`${e.message}${e.stack}${JSON.stringify(e)}`).not.toContain("k-123");
    expect(`${e.message}${e.stack}${JSON.stringify(e)}`).not.toContain("example.test");
  });

  it("a network failure that carries the URL and key keeps none of it", async () => {
    const fetchImpl = (async () => {
      throw new TypeError(`fetch failed https://example.test/x?key=${KEY}`);
    }) as unknown as typeof fetch;
    const e = await code(postJson("https://example.test/x", {}, {}, signal(), "groq", fetchImpl));
    expect(e.code).toBe("provider_error");
    expect(`${e.message}${e.stack}${JSON.stringify(e)}${String((e as { cause?: unknown }).cause)}`).not.toContain(KEY);
  });

  it("a body that is not JSON → provider_error", async () => {
    expect((await code(post(() => new Response("<html>oops</html>", { status: 200 })))).code).toBe("provider_error");
  });

  it("a body of 2 000 000 bytes → provider_error; one at the cap is read", async () => {
    expect((await code(post(() => new Response("x".repeat(2_000_000), { status: 200 })))).code).toBe("provider_error");
    // Chunked, no content-length: still stopped.
    const stream = () =>
      new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(400_000).fill(32)); } }), { status: 200 });
    expect((await code(post(stream))).code).toBe("provider_error");
    const ok = '{"a":"' + "y".repeat(MAX_RESPONSE_BYTES - 20) + '"}';
    expect(await post(() => new Response(ok, { status: 200 }))).toMatchObject({ a: expect.any(String) });
  });

  it("an aborted signal → timeout, with or without fetch noticing", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const throwing = (async (_u: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json({});
    }) as unknown as typeof fetch;
    expect((await code(postJson("https://example.test/x", {}, {}, ctl.signal, "gemini", throwing))).code).toBe("timeout");
    // Aborted while reading the body.
    const ctl2 = new AbortController();
    const slow = (async () =>
      new Response(new ReadableStream({ pull() { ctl2.abort(); throw new Error("stream died"); } }), { status: 200 })) as unknown as typeof fetch;
    expect((await code(postJson("https://example.test/x", {}, {}, ctl2.signal, "gemini", slow))).code).toBe("timeout");
  });

  it("redirects: redirect is 'error', and a 302 or a redirected response → provider_error", async () => {
    const { calls, fetchImpl } = recorder(() => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }));
    expect((await code(postJson("https://example.test/x", {}, {}, signal(), "openrouter", fetchImpl))).code).toBe("provider_error");
    expect(calls[0]!.init.redirect).toBe("error");
    const redirected = recorder(() => {
      const r = json({ ok: 1 });
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    });
    expect((await code(postJson("https://example.test/x", {}, {}, signal(), "openrouter", redirected.fetchImpl))).code).toBe("provider_error");
    // fetch itself refusing a redirect throws a TypeError
    const refusing = (async () => {
      throw new TypeError("redirect mode is set to error");
    }) as unknown as typeof fetch;
    expect((await code(postJson("https://example.test/x", {}, {}, signal(), "openrouter", refusing))).code).toBe("provider_error");
  });

  it("postForm passes the form through and refuses redirects too", async () => {
    const { calls, fetchImpl } = recorder(() => json({ text: "t" }));
    const form = new FormData();
    form.set("a", "b");
    expect(await postForm("https://example.test/x", { authorization: "Bearer z" }, form, signal(), "groq", fetchImpl)).toEqual({ text: "t" });
    expect(calls[0]!.init.body).toBe(form);
    expect(calls[0]!.init.redirect).toBe("error");
    // fetch sets the multipart content type: we must not.
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("never logs", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await code(post(() => new Response("bad k-123", { status: 500 })));
    await post(() => json({ ok: 1 }));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("getProviders (live)", () => {
  const names = (ps: AiProvider[]) => ps.map((p) => p.name);

  it("stt with Groq and Gemini keys → groq, gemini", () => {
    expect(names(getProviders("stt", readAiConfig({ GROQ_API_KEY: KEY, GEMINI_API_KEY: KEY })))).toEqual(["groq", "gemini"]);
  });

  it("no keys → none", () => {
    for (const kind of ["vision", "stt", "chat"] as const) expect(getProviders(kind, readAiConfig({}))).toEqual([]);
  });

  it("only providers with a key and a model for the kind", () => {
    expect(names(getProviders("vision", readAiConfig({ GEMINI_API_KEY: KEY, OPENROUTER_API_KEY: KEY })))).toEqual(["gemini"]);
    expect(names(getProviders("vision", CFG))).toEqual(["gemini", "openrouter"]);
    expect(names(getProviders("chat", readAiConfig({ GROQ_API_KEY: KEY })))).toEqual([]);
    expect(names(getProviders("stt", readAiConfig({ GEMINI_API_KEY: KEY })))).toEqual(["gemini"]);
  });

  it("mode off gives none even with keys; fake gives the fake", () => {
    expect(getProviders("chat", readAiConfig({ AI_DISABLED: "1", GEMINI_API_KEY: KEY }))).toEqual([]);
    expect(names(getProviders("chat", readAiConfig({ AI_PROVIDER: "fake", GEMINI_API_KEY: KEY })))).toEqual(["fake"]);
  });

  it("passes the injected fetch to the adapters", async () => {
    const { calls, fetchImpl } = recorder();
    const [g] = getProviders("chat", CFG, fetchImpl);
    await g!.chat(chatReq, signal());
    expect(calls).toHaveLength(1);
  });
});
