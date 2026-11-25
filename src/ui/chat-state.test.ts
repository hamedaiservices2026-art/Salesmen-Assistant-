import { describe, expect, it } from "vitest";
import { chatReducer, counterVisible, initialChat, isBlocked, QUESTION_COUNTER_FROM, QUESTION_MAX, submitCheck, type ChatReply, type ChatState } from "./chat-state";

const answer: ChatReply = { ok: true, verdict: "answer", text: "الباقي 1,860 كرتونة", citations: [{ title: "سياسة", label: "بند" }] };
const fresh = (over: Partial<ChatState> = {}): ChatState => ({ ...initialChat([]), ...over });
const sent = (s: ChatState, q: string) => chatReducer(s, { type: "send", question: q });

describe("submitCheck", () => {
  it("accepts a trimmed question", () => expect(submitCheck(fresh(), "  أنا فين؟ ")).toEqual({ ok: true, question: "أنا فين؟" }));
  it("refuses an empty one", () => expect(submitCheck(fresh(), "   ")).toEqual({ ok: false, reason: "empty" }));
  it("counts code points: 500 passes, 501 does not", () => {
    expect(submitCheck(fresh(), "ا".repeat(QUESTION_MAX)).ok).toBe(true);
    expect(submitCheck(fresh(), "ا".repeat(QUESTION_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
    expect(submitCheck(fresh(), "😀".repeat(QUESTION_MAX)).ok).toBe(true);
  });
  it("a second submit while one is pending is ignored", () => {
    expect(submitCheck(fresh({ pending: true }), "سؤال")).toEqual({ ok: false, reason: "pending" });
  });
  it("a blocked chat takes nothing", () => {
    expect(submitCheck(fresh({ blocked: "disabled" }), "سؤال")).toEqual({ ok: false, reason: "blocked" });
  });
});

describe("chatReducer", () => {
  it("send adds the question, clears the input, sets pending", () => {
    const s = sent(fresh({ input: "سؤال" }), "سؤال");
    expect(s.pending).toBe(true);
    expect(s.input).toBe("");
    expect(s.items.map((i) => i.kind)).toEqual(["user"]);
  });
  it("a send while pending changes nothing", () => {
    const s = sent(fresh(), "أ");
    expect(sent(s, "ب")).toBe(s);
  });
  it("a send that fails the check shows the field error and adds nothing", () => {
    const s = sent(fresh(), "  ");
    expect(s.items).toEqual([]);
    expect(s.fieldError).toBe("empty");
    expect(sent(fresh(), "ا".repeat(501)).fieldError).toBe("too_long");
  });
  it("typing clears the field error", () => {
    const s = chatReducer(sent(fresh(), ""), { type: "input", text: "س" });
    expect(s.fieldError).toBeNull();
    expect(s.input).toBe("س");
  });
  it("an answer is added and pending ends", () => {
    const s = chatReducer(sent(fresh(), "q"), { type: "result", result: answer });
    expect(s.pending).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: "answer", text: answer.ok && answer.verdict === "answer" ? answer.text : "" });
  });
  it("a verdict card keeps only the server's facts", () => {
    const facts = [{ id: "F1", label: "العمولة", value: "414 ج.م" }];
    const s = chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: true, verdict: "unverified_numbers", facts } });
    expect(s.items.at(-1)).toEqual(expect.objectContaining({ kind: "verdict", verdict: "unverified_numbers", facts }));
  });
  it("empty or too_long from the server removes the optimistic question and returns it to the field", () => {
    const s = chatReducer(sent(fresh(), "سؤال"), { type: "result", result: { ok: false, reason: "too_long" } });
    expect(s.items).toEqual([]);
    expect(s.input).toBe("سؤال");
    expect(s.fieldError).toBe("too_long");
    expect(s.pending).toBe(false);
  });
  it.each(["rate_limited", "failed", "unreadable", "disabled", "company_off", "no_provider", "no_notice", "quota"] as const)(
    "%s keeps the rep's question: no bubble, the field holds it again, a transient notice says why",
    (reason) => {
      const s = chatReducer(sent(fresh(), "سؤالي"), { type: "result", result: { ok: false, reason } });
      expect(s.items).toEqual([]);
      expect(s.input).toBe("سؤالي");
      expect(s.notice).toBe(reason);
      expect(s.pending).toBe(false);
      expect(s.fieldError).toBeNull();
    },
  );
  it("a refusal after earlier answers removes only the new question's bubble", () => {
    let s = chatReducer(sent(fresh(), "أ"), { type: "result", result: answer });
    s = chatReducer(sent(s, "ب"), { type: "result", result: { ok: false, reason: "rate_limited" } });
    expect(s.items.map((i) => i.kind)).toEqual(["user", "answer"]);
    expect(s.input).toBe("ب");
  });
  it("the field text the rep typed meanwhile is not overwritten by the restored question", () => {
    let s = sent(fresh(), "قديم");
    s = chatReducer(s, { type: "input", text: "جديد" });
    s = chatReducer(s, { type: "result", result: { ok: false, reason: "failed" } });
    expect(s.input).toBe("جديد");
  });
  it("a temporary failure does not block", () => {
    const s = chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: false, reason: "rate_limited" } });
    expect(isBlocked(s)).toBe(false);
  });
  it.each(["disabled", "company_off", "no_provider", "no_notice", "quota"] as const)("%s blocks the input", (reason) => {
    const s = chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: false, reason } });
    expect(s.blocked).toBe(reason);
    expect(isBlocked(s)).toBe(true);
  });
  it("the notice goes when the rep types, sends again or clears", () => {
    const failed = chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: false, reason: "failed" } });
    expect(chatReducer(failed, { type: "input", text: "q2" }).notice).toBeNull();
    expect(sent(failed, "q").notice).toBeNull();
    expect(chatReducer(failed, { type: "clear" }).notice).toBeNull();
  });
  it("a transcript is cut to 500 characters", () => {
    const s = chatReducer(fresh({ input: "ا".repeat(300) }), { type: "transcript", text: "ب".repeat(400) });
    expect(Array.from(s.input)).toHaveLength(QUESTION_MAX);
  });
  it("a transcript fills the field and is never sent", () => {
    const s = chatReducer(fresh(), { type: "transcript", text: "مشروبات كام" });
    expect(s.input).toBe("مشروبات كام");
    expect(s.pending).toBe(false);
    expect(s.items).toEqual([]);
  });
  it("a transcript is appended to a field the rep already typed in", () => {
    expect(chatReducer(fresh({ input: "أولا" }), { type: "transcript", text: "ثانيا" }).input).toBe("أولا ثانيا");
  });
  it("clear empties the conversation and the error", () => {
    const s = chatReducer(chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: false, reason: "failed" } }), { type: "clear" });
    expect(s.items).toEqual([]);
    expect(s.notice).toBeNull();
  });
  it("ids are unique and stable", () => {
    let s = sent(fresh(), "a");
    s = chatReducer(s, { type: "result", result: answer });
    s = sent(s, "b");
    expect(new Set(s.items.map((i) => i.id)).size).toBe(s.items.length);
  });
  it("history items from the server are shown as they are; an old unverified card has no facts", () => {
    const s = initialChat([
      { id: "m1", role: "user", text: "سؤال", verdict: null, citations: [] },
      { id: "m2", role: "assistant", text: "", verdict: "unverified_numbers", citations: [] },
      { id: "m3", role: "assistant", text: "جواب", verdict: "answer", citations: [{ title: "ت", label: "ل" }] },
    ]);
    expect(s.items.map((i) => i.kind)).toEqual(["user", "verdict", "answer"]);
    expect(s.items[1]).toMatchObject({ kind: "verdict", verdict: "unverified_numbers", facts: null });
  });
});

describe("question counter", () => {
  it("shows from 400 characters", () => {
    expect(QUESTION_COUNTER_FROM).toBe(400);
    expect(counterVisible("ا".repeat(399))).toBe(false);
    expect(counterVisible("ا".repeat(400))).toBe(true);
  });
});

describe("unblock", () => {
  it("lets the rep ask again after he dealt with the notice", () => {
    const s = chatReducer(sent(fresh(), "q"), { type: "result", result: { ok: false, reason: "no_notice" } });
    expect(isBlocked(s)).toBe(true);
    expect(isBlocked(chatReducer(s, { type: "unblock" }))).toBe(false);
  });
});
