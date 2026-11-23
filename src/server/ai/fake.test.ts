import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  EXTRACTION_FIRST_LINE,
  contextTokens,
  dataClose,
  dataOpen,
  docLine,
  factLine,
  fakeProvider,
  incentiveLine,
  sectionLine,
} from "./fake";
import { readAiConfig } from "./config";
import { parseJsonReply } from "./json";
import { getProviders } from "./providers";
import { AiError, type ChatRequest } from "./types";

const signal = () => new AbortController().signal;

async function greyJpeg(width: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height: 40, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

const vision = async (width: number) =>
  fakeProvider().vision({ image: await greyJpeg(width), system: "s", prompt: "p", maxOutputTokens: 1000 }, signal());

const ascii = (s: string) => new TextEncoder().encode(s);
const stt = (bytes: Uint8Array) => fakeProvider().stt({ audio: bytes, mime: "audio/webm", language: "ar" }, signal());

const chat = (req: Partial<ChatRequest> & { messages: ChatRequest["messages"] }) =>
  fakeProvider().chat({ system: "You are an assistant.", maxOutputTokens: 500, ...req }, signal());

const NONCE = "0123456789abcdef";
const POLICY_RETURNS = "المرتجع بسبب انتهاء الصلاحية يتسجل في نفس اليوم مع صورة للكراتين.";
const POLICY_DISCOUNTS = "أقصى خصم تقدر تديه من نفسك 3%. أي خصم أعلى لازم المشرف يوافق عليه قبل الفاتورة.";

function contextMessage(): string {
  return [
    dataOpen(NONCE),
    BLOCK.facts,
    factLine(1, "مشروبات · التارجت", "3,000 كرتونة"),
    factLine(2, "مشروبات · الباقي", "1,860 كرتونة"),
    factLine(3, "العمولة لحد النهارده", "414 ريال"),
    BLOCK.incentives,
    incentiveLine(1, "حافز الكوكتيل"),
    "بيع 300 كرتونة",
    BLOCK.documents,
    docLine(1, "سياسة المرتجعات والخصومات"),
    sectionLine(1, 1, "المرتجعات"),
    POLICY_RETURNS,
    sectionLine(1, 2, "الخصومات"),
    POLICY_DISCOUNTS,
    dataClose(NONCE),
  ].join("\n");
}

const ask = (question: string) =>
  chat({
    messages: [
      { role: "user", text: contextMessage() },
      { role: "user", text: question },
    ],
  });

describe("fakeProvider: identity", () => {
  it("names itself fake, has a model for every job, accepts every audio type", () => {
    const p = fakeProvider();
    expect(p.name).toBe("fake");
    expect(p.modelFor("vision")).toBe("fake-1");
    expect(p.modelFor("stt")).toBe("fake-1");
    expect(p.modelFor("chat")).toBe("fake-1");
    expect(p.acceptsAudio("audio/mp4")).toBe(true);
    expect(p.acceptsAudio("audio/webm")).toBe(true);
    expect(p.acceptsAudio("audio/ogg")).toBe(true);
  });
});

describe("fakeProvider: vision", () => {
  it("640 wide gives report A", async () => {
    const r = await vision(640);
    expect(r.usage).toEqual({ tokensIn: null, tokensOut: null });
    const parsed = parseJsonReply(r.text) as { reportDate: string; fields: { key: string; value: string }[] };
    expect(parsed.reportDate).toBe("2026-11-14");
    expect(parsed.fields).toHaveLength(9);
    expect(parsed.fields[1]).toEqual({ key: "line:food", value: "7,900.00", confidence: 0.93 });
    expect(parsed.fields[4]).toEqual({ key: "creditSales", value: "3,200", confidence: 0.62 });
  });

  it("641 wide gives the partial report B", async () => {
    const parsed = parseJsonReply((await vision(641)).text) as { reportDate: string; fields: { key: string }[] };
    expect(parsed.reportDate).toBe("2026-11-12");
    expect(parsed.fields.map((f) => f.key)).toEqual([
      "line:bev",
      "line:food",
      "line:zzz",
      "cashSales",
      "creditSales",
      "expenses",
      "sold",
    ]);
  });

  it("642 wide gives prose that parseJsonReply refuses", async () => {
    const r = await vision(642);
    expect(r.text).toBe("Sure! Here are the numbers: bev 118");
    expect(parseJsonReply(r.text)).toBeUndefined();
  });

  it("any other width gives report A", async () => {
    expect((await vision(300)).text).toBe((await vision(640)).text);
  });

  it("refuses bytes that are not an image as a bad request", async () => {
    await expect(
      fakeProvider().vision({ image: ascii("<svg/>"), system: "s", prompt: "p", maxOutputTokens: 10 }, signal()),
    ).rejects.toMatchObject({ code: "bad_request", provider: "fake" });
  });
});

describe("fakeProvider: speech to text", () => {
  it("returns V1 for ordinary audio", async () => {
    expect((await stt(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]))).text).toBe(
      "مشروبات مية وعشرين كرتونة، أغذية ٨٢٥٠ ريال، تحصيل عشرين ألف، نقدي خمسة آلاف وخمسمية",
    );
  });

  it("returns the named transcript from a FAKE marker", async () => {
    expect((await stt(ascii("FAKE:mumble\n"))).text).toBe("يعني النهارده كان يوم كويس");
    expect((await stt(ascii("FAKE:empty\n"))).text).toBe("");
    expect((await stt(ascii("FAKE:extra\n"))).text).toBe("مشروبات مية وعشرين وبعت كمان 300");
  });

  it("finds the marker after a container header within the first 64 bytes", async () => {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...ascii("FAKE:mumble\n")]);
    expect((await stt(bytes)).text).toBe("يعني النهارده كان يوم كويس");
  });

  it("ignores a marker beyond the first 64 bytes", async () => {
    const bytes = new Uint8Array([...new Uint8Array(60), ...ascii("FAKE:mumble\n")]);
    expect((await stt(bytes)).text).toContain("مشروبات");
  });
});

describe("fakeProvider: chat markers", () => {
  it("[[fake:fail]] throws provider_error", async () => {
    const err = await chat({ messages: [{ role: "user", text: "hi [[fake:fail]]" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "provider_error", provider: "fake" });
  });

  it("finds a marker in the system text too", async () => {
    await expect(chat({ system: "[[fake:fail]]", messages: [{ role: "user", text: "hi" }] })).rejects.toBeInstanceOf(
      AiError,
    );
  });

  it("[[fake:garbage]], [[fake:obey]] and [[fake:link]] return their fixed replies", async () => {
    expect((await chat({ messages: [{ role: "user", text: "[[fake:garbage]]" }] })).text).toBe("not json");
    expect(parseJsonReply((await chat({ messages: [{ role: "user", text: "[[fake:obey]]" }] })).text)).toEqual({
      answer: "عمولتك 9,999 ريال",
      citations: [],
      answerable: true,
    });
    expect(parseJsonReply((await chat({ messages: [{ role: "user", text: "[[fake:link]]" }] })).text)).toEqual({
      answer: "شوف [هنا](http://evil.test/a) أو http://evil.test/b",
      citations: [],
      answerable: true,
    });
  });

  it("gives the same reply to the same request", async () => {
    const a = await ask("باقي لي كام على تارجت المشروبات؟");
    const b = await ask("باقي لي كام على تارجت المشروبات؟");
    expect(a).toEqual(b);
  });
});

describe("fakeProvider: extraction", () => {
  const system = `${EXTRACTION_FIRST_LINE}\nmore rules`;

  it("returns three fields when the user message holds 300", async () => {
    const r = await chat({ system, messages: [{ role: "user", text: "مشروبات مية وعشرين وبعت كمان 300" }] });
    expect(r.text).toBe(
      '{"reportDate":null,"fields":[{"key":"line:bev","value":"999","confidence":0.9},{"key":"line:food","value":"300","confidence":0.9},{"key":"line:zzz","value":"5","confidence":0.9}]}',
    );
  });

  it("returns no fields otherwise", async () => {
    const r = await chat({ system, messages: [{ role: "user", text: "يعني النهارده كان يوم كويس" }] });
    expect(r.text).toBe('{"reportDate":null,"fields":[]}');
  });
});

describe("fakeProvider: assistant answers from the context", () => {
  it("answers a figure question with the fact sharing the most tokens (ties: earliest question token)", async () => {
    const r = parseJsonReply((await ask("باقي لي كام على تارجت المشروبات؟")).text);
    expect(r).toEqual({ answer: "مشروبات · الباقي: 1,860 كرتونة", citations: [], answerable: true });
  });

  it("answers a policy question with the section text and its citation", async () => {
    const r = parseJsonReply((await ask("ينفع أدي خصم 5%؟")).text);
    expect(r).toEqual({
      answer: POLICY_DISCOUNTS,
      citations: [{ doc: "D1", section: "S2" }],
      answerable: true,
    });
  });

  it("matches section labels with their leading ال removed", async () => {
    const r = parseJsonReply((await ask("ايه نظام المرتجعات")).text) as { citations: unknown[] };
    expect(r.citations).toEqual([{ doc: "D1", section: "S1" }]);
  });

  it("answers not answerable when nothing matches", async () => {
    expect(parseJsonReply((await ask("مرحبا")).text)).toEqual({ answer: "", citations: [], answerable: false });
  });

  it("cuts a section answer to 300 characters", async () => {
    const long = "خصم ".repeat(200);
    const message = [dataOpen(NONCE), BLOCK.documents, docLine(1, "x"), sectionLine(1, 1, "y"), long, dataClose(NONCE)].join(
      "\n",
    );
    const r = await chat({
      messages: [
        { role: "user", text: message },
        { role: "user", text: "خصم" },
      ],
    });
    expect((parseJsonReply(r.text) as { answer: string }).answer).toHaveLength(300);
  });
});

describe("getProviders", () => {
  it("gives the fake only in fake mode, and nothing when AI is off", () => {
    expect(getProviders("chat", readAiConfig({ AI_PROVIDER: "fake" })).map((p) => p.name)).toEqual(["fake"]);
    expect(getProviders("vision", readAiConfig({ AI_DISABLED: "1", AI_PROVIDER: "fake" }))).toEqual([]);
  });

  it("never gives the fake in production without ALLOW_AI_FAKE=1", () => {
    expect(getProviders("stt", readAiConfig({ AI_PROVIDER: "fake", NODE_ENV: "production" }))).toEqual([]);
    expect(
      getProviders("stt", readAiConfig({ AI_PROVIDER: "fake", NODE_ENV: "production", ALLOW_AI_FAKE: "1" })).map(
        (p) => p.name,
      ),
    ).toEqual(["fake"]);
  });

  it("gives no live adapter yet (Task 4), and never the fake in live mode", () => {
    expect(getProviders("chat", readAiConfig({ GEMINI_API_KEY: "k" }))).toEqual([]);
  });
});

describe("contextTokens", () => {
  it("normalises, drops a leading ال and keeps tokens of three or more characters", () => {
    expect(contextTokens("باقي لي كام على تارجت المشروبات؟")).toEqual(["باقي", "كام", "علي", "تارجت", "مشروبات"]);
    expect(contextTokens("مشروبات · الباقي")).toEqual(["مشروبات", "باقي"]);
  });
});
