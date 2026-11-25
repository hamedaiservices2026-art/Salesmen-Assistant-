import { beforeEach, describe, expect, it, vi } from "vitest";

const ask = vi.fn();
let thrower: (() => never) | null = null;
vi.mock("@/server/auth/guard", () => ({ requireCtx: async () => ({ userId: "ahmed", locale: "ar", role: "rep" }) }));
vi.mock("@/server/assistant/ask", () => ({ ask: (...a: unknown[]) => (thrower ? thrower() : ask(...a)) }));
vi.mock("@/server/assistant/conversation", () => ({ clearConversation: async () => ({ deleted: 0 }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import { askAction } from "./actions";

beforeEach(() => {
  ask.mockReset();
  thrower = null;
});

describe("askAction", () => {
  it("a non-string question is empty and reaches no server code", async () => {
    expect(await askAction(5 as unknown as string)).toEqual({ ok: false, reason: "empty" });
    expect(ask).not.toHaveBeenCalled();
  });
  it("an explain id that is not shaped like an id is failed, without asking", async () => {
    for (const bad of ["", "a/b", "x".repeat(65), "id with space", "<script>", 7 as unknown as string]) {
      expect(await askAction("q", bad), String(bad)).toEqual({ ok: false, reason: "failed" });
    }
    expect(ask).not.toHaveBeenCalled();
  });
  it("a well-formed explain id is passed on as the notification id", async () => {
    ask.mockResolvedValue({ ok: true, verdict: "no_answer", facts: [] });
    await askAction("q", "n-mango_1");
    expect(ask.mock.calls[0]![1]).toEqual({ question: "q", explain: { notificationId: "n-mango_1" } });
    await askAction("q");
    expect(ask.mock.calls[1]![1]).toEqual({ question: "q" });
  });
  it("returns only the fields the screen shows", async () => {
    ask.mockResolvedValue({ ok: true, verdict: "answer", text: "نص", citations: [{ title: "ت", label: "ل", extra: 1 }], secret: "x" });
    expect(await askAction("q")).toEqual({ ok: true, verdict: "answer", text: "نص", citations: [{ title: "ت", label: "ل" }] });
    ask.mockResolvedValue({ ok: true, verdict: "unverified_numbers", facts: [{ id: "F1", label: "a", value: "1", numbers: ["1"] }] });
    expect(await askAction("q")).toEqual({ ok: true, verdict: "unverified_numbers", facts: [{ id: "F1", label: "a", value: "1" }] });
  });
  it("passes a refusal reason through", async () => {
    ask.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect(await askAction("q")).toEqual({ ok: false, reason: "rate_limited" });
  });
  it("an unexpected error is failed and its text is not logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // a plain function: vitest reports a throwing spy's recorded error as the test's own
    thrower = () => {
      throw new TypeError("secret question text");
    };
    const r = await askAction("q").catch((e: unknown) => ({ threw: String(e) }));
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret question text");
    log.mockRestore();
  });
});
