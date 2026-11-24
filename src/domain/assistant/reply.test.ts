import { describe, expect, it } from "vitest";
import { AnswerSchema, judgeReply } from "./reply";
import type { Topic } from "./topics";

// The fake provider's marker replies (src/server/ai/fake.ts), parsed as `ask` would parse them.
const OBEY = JSON.parse('{"answer":"عمولتك 9,999 ريال","citations":[],"answerable":true}') as unknown;
const LINK = JSON.parse('{"answer":"شوف [هنا](http://evil.test/a) أو http://evil.test/b","citations":[],"answerable":true}') as unknown;

const sections = new Map<string, ReadonlySet<string>>([
  ["D1/S1", new Set<string>()],
  ["D1/S2", new Set(["3"])],
]);
const known = new Set(["D1/S1", "D1/S2"]);

function input(topic: Topic, over: Partial<Parameters<typeof judgeReply>[1]> = {}): Parameters<typeof judgeReply>[1] {
  return { topic, question: "سؤال", factNumbers: new Set(["414", "3478.55", "6400"]), sectionNumbers: sections, knownSections: known, ...over };
}
const reply = (answer: string, citations: { doc: string; section: string }[] = [], answerable = true) => ({ answer, citations, answerable });

describe("judgeReply: plan examples", () => {
  it("refuses the obey reply's invented commission", () => {
    expect(judgeReply(OBEY, input("commission"))).toEqual({ kind: "unverified_numbers" });
  });

  it("accepts a policy answer whose number is in the cited section", () => {
    expect(judgeReply(reply("أقصى خصم 3%", [{ doc: "D1", section: "S2" }]), input("policy"))).toEqual({
      kind: "answer",
      text: "أقصى خصم 3%",
      citations: [{ doc: "D1", section: "S2" }],
    });
  });

  it("answers not_in_documents for a policy reply citing a section it was not given", () => {
    expect(judgeReply(reply("أقصى خصم 3%", [{ doc: "D9", section: "S9" }]), input("policy"))).toEqual({ kind: "not_in_documents" });
  });

  it("refuses a reply with an extra key", () => {
    expect(judgeReply({ answer: "x", citations: [], answerable: true, extra: 1 }, input("other"))).toEqual({ kind: "no_answer" });
  });

  it("strips the link reply to plain text for a loose topic", () => {
    const v = judgeReply(LINK, input("other"));
    expect(v.kind).toBe("answer");
    if (v.kind !== "answer") return;
    expect(v.text).not.toMatch(/http/);
    expect(v.text).not.toMatch(/evil/);
    expect(v.text).toBe("شوف هنا أو");
  });

  it("removes the tags from the text of a policy answer (R57)", () => {
    const v = judgeReply(reply("حسب D1/S2 أقصى خصم 3%", [{ doc: "D1", section: "S2" }]), input("policy"));
    expect(v.kind).toBe("answer");
    if (v.kind !== "answer") return;
    expect(v.text).not.toMatch(/D1|S2/);
    expect(v.text).toBe("حسب أقصى خصم 3%");
  });

  it("does not let the question's number confirm a strict figure (R57)", () => {
    expect(
      judgeReply(reply("عمولتك 9,999 ريال"), input("commission", { question: "عمولتي 9,999 صح؟", factNumbers: new Set(["414"]) })),
    ).toEqual({ kind: "unverified_numbers" });
  });
});

describe("judgeReply: schema", () => {
  it("answers no_answer for anything that is not AnswerSchema", () => {
    for (const raw of [
      null,
      undefined,
      "عمولتك 414",
      42,
      [],
      {},
      { answer: 1, citations: [], answerable: true },
      { answer: "x", citations: [], answerable: "true" },
      { answer: "x".repeat(4001), citations: [], answerable: true },
      { answer: "x", citations: [{ doc: "D1", section: "S2", page: 1 }], answerable: true },
      { answer: "x", citations: [{ doc: "D1/S2", section: "S2" }], answerable: true },
      { answer: "x", citations: [{ doc: "D100", section: "S2" }], answerable: true },
      { answer: "x", citations: [{ doc: "D1", section: "S12345" }], answerable: true },
      { answer: "x", citations: Array.from({ length: 6 }, () => ({ doc: "D1", section: "S1" })), answerable: true },
      { answer: "x", citations: [] },
    ]) {
      expect(judgeReply(raw, input("other")), JSON.stringify(raw)?.slice(0, 60)).toEqual({ kind: "no_answer" });
    }
  });

  it("refuses a prototype-polluting key", () => {
    expect(judgeReply(JSON.parse('{"answer":"x","citations":[],"answerable":true,"__proto__":{"a":1}}'), input("other"))).toEqual({ kind: "no_answer" });
  });

  it("exports the schema with the plan's limits", () => {
    expect(AnswerSchema.safeParse(reply("x".repeat(4000))).success).toBe(true);
    expect(AnswerSchema.safeParse(reply("x", [{ doc: "D99", section: "S9999" }])).success).toBe(true);
  });
});

describe("judgeReply: answerable, empty and citations", () => {
  it("answers not_in_documents for policy and no_answer otherwise when the model says it cannot answer", () => {
    expect(judgeReply(reply("", [], false), input("policy"))).toEqual({ kind: "not_in_documents" });
    expect(judgeReply(reply("أي حاجة", [], false), input("policy"))).toEqual({ kind: "not_in_documents" });
    expect(judgeReply(reply("", [], false), input("commission"))).toEqual({ kind: "no_answer" });
    expect(judgeReply(reply("", [], true), input("tips"))).toEqual({ kind: "no_answer" });
    expect(judgeReply(reply("   ", [], true), input("policy"))).toEqual({ kind: "not_in_documents" });
  });

  it("treats an answer that is empty after cleaning as empty", () => {
    expect(judgeReply(reply("http://evil.test <b>"), input("other"))).toEqual({ kind: "no_answer" });
    expect(judgeReply(reply("D1/S2", [{ doc: "D1", section: "S2" }]), input("policy"))).toEqual({ kind: "not_in_documents" });
  });

  it("drops citations that were not given and keeps the rest once each", () => {
    const v = judgeReply(
      reply("أقصى خصم 3%", [
        { doc: "D9", section: "S9" },
        { doc: "D1", section: "S2" },
        { doc: "D1", section: "S2" },
      ]),
      input("policy"),
    );
    expect(v).toEqual({ kind: "answer", text: "أقصى خصم 3%", citations: [{ doc: "D1", section: "S2" }] });
  });

  it("drops citations for a figure topic too", () => {
    const v = judgeReply(reply("عمولتك 414 ريال", [{ doc: "D7", section: "S1" }]), input("commission"));
    expect(v).toEqual({ kind: "answer", text: "عمولتك 414 ريال", citations: [] });
  });

  it("answers not_in_documents for a policy reply with no citation", () => {
    expect(judgeReply(reply("أقصى خصم 3%"), input("policy"))).toEqual({ kind: "not_in_documents" });
  });
});

describe("judgeReply: numbers", () => {
  it("accepts a strict answer that states only facts", () => {
    expect(judgeReply(reply("عمولتك لحد دلوقتي 414 ريال، ومتوقع 3,478.55 آخر الشهر"), input("commission"))).toEqual({
      kind: "answer",
      text: "عمولتك لحد دلوقتي 414 ريال، ومتوقع 3,478.55 آخر الشهر",
      citations: [],
    });
  });

  it("refuses a policy number that is only in a section that was not cited", () => {
    const secs = new Map<string, ReadonlySet<string>>([
      ["D1/S1", new Set(["7"])],
      ["D1/S2", new Set(["3"])],
    ]);
    expect(judgeReply(reply("المرتجع خلال 7 أيام", [{ doc: "D1", section: "S2" }]), input("policy", { sectionNumbers: secs }))).toEqual({
      kind: "unverified_numbers",
    });
    expect(judgeReply(reply("المرتجع خلال 7 أيام", [{ doc: "D1", section: "S1" }]), input("policy", { sectionNumbers: secs })).kind).toBe("answer");
  });

  it("refuses a section number for a figure topic even when the section is cited", () => {
    expect(judgeReply(reply("عمولتك 3", [{ doc: "D1", section: "S2" }]), input("commission", { factNumbers: new Set(["414"]) }))).toEqual({
      kind: "unverified_numbers",
    });
  });

  it("allows the question's numbers for policy and loose topics only (R57)", () => {
    const q = { question: "ينفع خصم 5%؟" };
    expect(judgeReply(reply("لا، خصم 5% محتاج موافقة، أقصى 3%", [{ doc: "D1", section: "S2" }]), input("policy", q)).kind).toBe("answer");
    expect(judgeReply(reply("جرّب 25 زيارة"), input("tips", { question: "لو عملت 25 زيارة؟" })).kind).toBe("answer");
    expect(judgeReply(reply("جرّب 25 زيارة"), input("tips")).kind).toBe("unverified_numbers");
    for (const topic of ["standing", "remaining", "commission", "incentive", "focus", "collection", "coverage"] as const) {
      expect(judgeReply(reply("الرقم 25"), input(topic, { question: "هو 25؟" })), topic).toEqual({ kind: "unverified_numbers" });
    }
  });

  it("checks incentive answers against the incentive texts the caller put in the facts", () => {
    expect(judgeReply(reply("الحافز 500 ريال لو بعت 300 كرتونة"), input("incentive", { factNumbers: new Set(["500", "300"]) })).kind).toBe("answer");
    expect(judgeReply(reply("الحافز 600 ريال"), input("incentive", { factNumbers: new Set(["500", "300"]) }))).toEqual({ kind: "unverified_numbers" });
  });

  it("tolerates a small number in a loose answer but not next to money", () => {
    expect(judgeReply(reply("زور 3 محلات الصبح"), input("tips")).kind).toBe("answer");
    expect(judgeReply(reply("هتكسب 3 ريال زيادة"), input("tips"))).toEqual({ kind: "unverified_numbers" });
  });

  it("checks numbers on the cleaned text, so digits hidden in markup or invisible characters still count", () => {
    expect(judgeReply(reply("عمولتك 9\u200B999"), input("commission"))).toEqual({ kind: "unverified_numbers" });
    expect(judgeReply(reply("عمولتك **9**,**999**"), input("commission"))).toEqual({ kind: "unverified_numbers" });
    expect(judgeReply(reply("عمولتك ٩٬٩٩٩"), input("commission"))).toEqual({ kind: "unverified_numbers" });
    expect(judgeReply(reply("عمولتك 414<x>9</x>"), input("commission"))).toEqual({ kind: "unverified_numbers" });
    expect(judgeReply(reply("عمولتك 414<x title=9>"), input("commission")).kind).toBe("answer");
  });

  it("fails closed on number words in a strict answer", () => {
    expect(judgeReply(reply("عمولتك نص مليون"), input("commission"))).toEqual({ kind: "unverified_numbers" });
    expect(judgeReply(reply("عمولتك تسعة آلاف"), input("commission"))).toEqual({ kind: "unverified_numbers" });
  });

  it("cuts the text to 1500 code points", () => {
    const v = judgeReply(reply("ا".repeat(3000)), input("other"));
    expect(v.kind === "answer" && Array.from(v.text).length).toBe(1500);
  });

  it("finishes fast on a hostile answer", () => {
    const t0 = performance.now();
    judgeReply(reply("1,<".repeat(1300)), input("commission"));
    judgeReply(reply("[".repeat(4000)), input("tips"));
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
