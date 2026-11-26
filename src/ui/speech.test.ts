import { describe, expect, it } from "vitest";
import { pickVoice, SPEAK_MAX, speakable, takeHintOnce } from "./speech";

describe("pickVoice", () => {
  it("prefers ar-SA for Arabic", () => {
    expect(pickVoice([{ lang: "en-US", name: "A" }, { lang: "ar-SA", name: "Maged" }, { lang: "ar-EG", name: "B" }], "ar")).toBe(1);
  });
  it("returns null when no voice speaks the language", () => {
    expect(pickVoice([{ lang: "en-US", name: "A" }], "ur")).toBeNull();
    expect(pickVoice([], "ar")).toBeNull();
  });
  it("reads the underscore form of a language tag", () => {
    expect(pickVoice([{ lang: "ar_SA", name: "x" }], "ar")).toBe(0);
  });
  it("prefers a local-service voice, then the first", () => {
    expect(pickVoice([{ lang: "ar-EG", name: "a" }, { lang: "ar-AE", name: "b", localService: true }, { lang: "ar-JO", name: "c", localService: true }], "ar")).toBe(1);
    expect(pickVoice([{ lang: "en-GB", name: "a" }, { lang: "en-US", name: "b" }], "en")).toBe(0);
  });
  it("ar-SA wins over a local-service voice of another region; matches case-insensitively and by prefix only", () => {
    expect(pickVoice([{ lang: "ar-AE", name: "a", localService: true }, { lang: "AR-sa", name: "b" }], "ar")).toBe(1);
    expect(pickVoice([{ lang: "arc-IR", name: "x" }, { lang: "ur-PK", name: "u" }], "ar")).toBeNull();
  });
  it("never picks an online voice, even ar-SA (R86)", () => {
    const voices = [
      { lang: "ar-EG", name: "Local Arabic (device)", localService: true, default: true },
      { lang: "ar-SA", name: "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)", localService: false },
    ];
    expect(pickVoice(voices, "ar")).toBe(0);
    expect(pickVoice([{ lang: "ar-SA", name: "online", localService: false }], "ar")).toBeNull();
    // a browser that does not say (undefined) is taken as on-device
    expect(pickVoice([{ lang: "ar-SA", name: "x" }], "ar")).toBe(0);
  });
  it("a voice without a usable lang is ignored", () => {
    expect(pickVoice([{ lang: "", name: "x" }, { lang: undefined as unknown as string, name: "y" }, { lang: "ur-IN", name: "z" }], "ur")).toBe(2);
  });
});

describe("speakable", () => {
  it("keeps every line of the answer, including one that starts with a section sign", () => {
    expect(speakable("الجواب الأول.\n§ 4.2 بند\nالجواب الثاني.")).toBe("الجواب الأول.\n§ 4.2 بند\nالجواب الثاني.");
  });
  it("a full stop inside a number or a name is not a sentence end", () => {
    const text = `${"كلمة ".repeat(110)}3.5 كرتونة ${"و".repeat(100)}`;
    const out = speakable(text);
    expect(out.length).toBeLessThanOrEqual(SPEAK_MAX);
    expect(out.endsWith("3.")).toBe(false);
    expect(out.endsWith("3")).toBe(false);
    const long = `${"ا".repeat(500)} 12.50 ${"ب".repeat(300)}`;
    expect(speakable(long).endsWith("12.")).toBe(false);
  });
  it("a full stop followed by a space or the end is a sentence end", () => {
    const text = `${"ا".repeat(100)}. ${"ب".repeat(300)}. ${"ج".repeat(400)}`;
    expect(speakable(text)).toBe(`${"ا".repeat(100)}. ${"ب".repeat(300)}.`);
  });
  it("leaves short text as it is (trimmed)", () => {
    expect(speakable("  مرحبا.  ")).toBe("مرحبا.");
  });
  it("cuts at the last sentence end before 600 characters", () => {
    const sentence = "جملة قصيرة هنا. ";
    const text = sentence.repeat(60);
    const out = speakable(text);
    expect(out.length).toBeLessThanOrEqual(SPEAK_MAX);
    expect(out.endsWith(".")).toBe(true);
    expect(text.startsWith(out)).toBe(true);
  });
  it("cuts at an Arabic question mark or a Urdu full stop too", () => {
    const text = `${"ا".repeat(300)}؟ ${"ب".repeat(400)}`;
    expect(speakable(text)).toBe(`${"ا".repeat(300)}؟`);
    const ur = `${"ا".repeat(200)}۔ ${"ب".repeat(500)}`;
    expect(speakable(ur)).toBe(`${"ا".repeat(200)}۔`);
  });
  it("with no sentence end, cuts at a space, else hard", () => {
    const words = "كلمة ".repeat(200);
    const out = speakable(words);
    expect(out.length).toBeLessThanOrEqual(SPEAK_MAX);
    expect(out.endsWith("كلمة")).toBe(true);
    expect(speakable("x".repeat(900))).toHaveLength(SPEAK_MAX);
  });
  it("blank text is the empty string", () => {
    expect(speakable("  \n ")).toBe("");
  });
});

describe("takeHintOnce (the no-voice hint, once per device)", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("is true the first time and false after", () => {
    const s = store();
    const memory = { shown: false };
    expect(takeHintOnce(() => s, memory)).toBe(true);
    expect(takeHintOnce(() => s, memory)).toBe(false);
  });
  it("private mode (storage throws): once per page load, never throws", () => {
    const boom = () => {
      throw new Error("denied");
    };
    const memory = { shown: false };
    expect(takeHintOnce(boom, memory)).toBe(true);
    expect(takeHintOnce(boom, memory)).toBe(false);
  });
});
