import { describe, expect, it } from "vitest";
import { CITATION_MARK, pickVoice, SPEAK_MAX, speakable } from "./speech";

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
  it("a voice without a usable lang is ignored", () => {
    expect(pickVoice([{ lang: "", name: "x" }, { lang: undefined as unknown as string, name: "y" }, { lang: "ur-IN", name: "z" }], "ur")).toBe(2);
  });
});

describe("speakable", () => {
  it("drops lines that start with the citation marker", () => {
    expect(speakable(`الجواب الأول.\n${CITATION_MARK} سياسة · بند\nالجواب الثاني.`)).toBe("الجواب الأول.\nالجواب الثاني.");
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
  it("nothing left after dropping citations is the empty string", () => {
    expect(speakable(`${CITATION_MARK} a\n${CITATION_MARK} b`)).toBe("");
  });
});
