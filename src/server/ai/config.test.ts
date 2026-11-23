import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { providerOrder, readAiConfig } from "./config";
import { Secret } from "./secret";

describe("readAiConfig", () => {
  it("defaults to live with no keys", () => {
    const cfg = readAiConfig({});
    expect(cfg.mode).toBe("live");
    expect(cfg.gemini.key).toBeNull();
    expect(cfg.groq.key).toBeNull();
    expect(cfg.openrouter.key).toBeNull();
    expect(cfg.groq.sttModel).toBe("whisper-large-v3");
    expect(cfg.openrouter.visionModel).toBeNull();
    expect(cfg.openrouter.chatModel).toBeNull();
    expect(cfg.globalDay).toEqual({ vision: 400, stt: 600, chat: 800 });
    expect(cfg.globalMinute).toEqual({ vision: null, stt: null, chat: null });
  });

  it("resolves mode", () => {
    expect(readAiConfig({ AI_DISABLED: "1", AI_PROVIDER: "fake" }).mode).toBe("off");
    expect(readAiConfig({ AI_PROVIDER: "fake" }).mode).toBe("fake");
    expect(readAiConfig({ AI_PROVIDER: "fake", NODE_ENV: "production" }).mode).toBe("off");
    expect(
      readAiConfig({ AI_PROVIDER: "fake", NODE_ENV: "production", ALLOW_AI_FAKE: "1" }).mode,
    ).toBe("fake");
  });

  it("refuses a model id that could inject a path or query", () => {
    const def = readAiConfig({}).gemini.chatModel;
    expect(readAiConfig({ AI_GEMINI_CHAT_MODEL: "../v1/x?y" }).gemini.chatModel).toBe(def);
    expect(readAiConfig({ AI_GEMINI_CHAT_MODEL: "my-model.v2" }).gemini.chatModel).toBe("my-model.v2");
    expect(readAiConfig({ AI_OPENROUTER_CHAT_MODEL: "a/b:free" }).openrouter.chatModel).toBe("a/b:free");
    expect(readAiConfig({ AI_OPENROUTER_CHAT_MODEL: "a b" }).openrouter.chatModel).toBeNull();
  });

  it("validates global limits", () => {
    expect(readAiConfig({ AI_GLOBAL_DAY_CHAT: "-5" }).globalDay.chat).toBe(800);
    expect(readAiConfig({ AI_GLOBAL_DAY_CHAT: "100001" }).globalDay.chat).toBe(800);
    expect(readAiConfig({ AI_GLOBAL_DAY_CHAT: "0" }).globalDay.chat).toBe(0);
    expect(readAiConfig({ AI_GLOBAL_DAY_CHAT: "12" }).globalDay.chat).toBe(12);
    expect(readAiConfig({ AI_GLOBAL_DAY_CHAT: "1.5" }).globalDay.chat).toBe(800);
    expect(readAiConfig({ AI_GLOBAL_MINUTE_VISION: "0" }).globalMinute.vision).toBeNull();
    expect(readAiConfig({ AI_GLOBAL_MINUTE_VISION: "8" }).globalMinute.vision).toBe(8);
  });

  it("never prints a key", () => {
    const cfg = readAiConfig({ GEMINI_API_KEY: "k-123", GROQ_API_KEY: "g-456" });
    expect(cfg.gemini.key).toBeInstanceOf(Secret);
    expect(JSON.stringify(cfg)).not.toContain("k-123");
    expect(String(cfg.gemini.key)).not.toContain("k-123");
    expect(`${cfg.gemini.key}`).toBe("[secret]");
    expect(inspect(cfg, { depth: 6 })).not.toContain("k-123");
    expect(inspect(cfg, { depth: 6 })).not.toContain("g-456");
    expect(cfg.gemini.key!.reveal()).toBe("k-123");
  });

  it("ignores empty keys", () => {
    expect(readAiConfig({ GEMINI_API_KEY: "" }).gemini.key).toBeNull();
  });
});

describe("providerOrder", () => {
  it("lists providers per job", () => {
    expect(providerOrder("vision")).toEqual(["gemini", "openrouter"]);
    expect(providerOrder("stt")).toEqual(["groq", "gemini"]);
    expect(providerOrder("chat")).toEqual(["gemini", "openrouter"]);
  });
});
