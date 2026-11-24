import { describe, expect, it } from "vitest";
import { classifyTopic, isTopic, strictnessFor, TOPICS, type Topic } from "./topics";

describe("classifyTopic", () => {
  it("classifies the plan's examples", () => {
    expect(classifyTopic("باقي لي كام على تارجت المشروبات؟")).toBe("remaining");
    expect(classifyTopic("عمولتي كام؟")).toBe("commission");
    expect(classifyTopic("ينفع أدي العميل خصم 5%؟")).toBe("policy");
    expect(classifyTopic("How do I sell more mango?")).toBe("tips");
    expect(classifyTopic("مرحبا")).toBe("other");
  });

  it("matches every form of the commission stem (R34)", () => {
    expect(classifyTopic("عمولتك كام؟")).toBe("commission");
    expect(classifyTopic("العمولة كام؟")).toBe("commission");
    expect(classifyTopic("العموله")).toBe("commission");
    expect(classifyTopic("عُمولتي")).toBe("commission");
    expect(classifyTopic("هكسب كام الشهر ده؟")).toBe("commission");
    expect(classifyTopic("How much will I earn?")).toBe("commission");
    expect(classifyTopic("My COMMISSION?")).toBe("commission");
    expect(classifyTopic("میرا کمیشن کتنا ہے؟")).toBe("commission");
  });

  it("puts incentive first, before commission and the rest", () => {
    expect(classifyTopic("الحافز ده بيدخل في العمولة؟")).toBe("incentive");
    expect(classifyTopic("حوافز الشهر")).toBe("incentive");
    expect(classifyTopic("what is the bonus left?")).toBe("incentive");
    expect(classifyTopic("incentive")).toBe("incentive");
    expect(classifyTopic("ترغیب")).toBe("incentive");
  });

  it("orders commission before remaining, remaining before standing", () => {
    expect(classifyTopic("باقي كام على العمولة؟")).toBe("commission");
    expect(classifyTopic("فاضل كام على التارجت؟")).toBe("remaining");
    expect(classifyTopic("how much is left of my target")).toBe("remaining");
    expect(classifyTopic("کتنا باقی ہے؟")).toBe("remaining");
  });

  it("classifies collection, coverage, focus, policy and standing", () => {
    expect(classifyTopic("التحصيل عامل ايه؟")).toBe("collection");
    expect(classifyTopic("my collection")).toBe("collection");
    expect(classifyTopic("وصولی کتنی ہوئی؟")).toBe("collection");
    expect(classifyTopic("التغطية كام؟")).toBe("coverage");
    expect(classifyTopic("coverage")).toBe("coverage");
    expect(classifyTopic("أصناف الفوكس")).toBe("focus");
    expect(classifyTopic("focus items")).toBe("focus");
    expect(classifyTopic("هل مسموح المرتجع بدون صورة؟")).toBe("policy");
    expect(classifyTopic("السياسة بتقول ايه؟")).toBe("policy");
    expect(classifyTopic("what is the return policy")).toBe("policy");
    expect(classifyTopic("پالیسی کیا ہے")).toBe("policy");
    expect(classifyTopic("أنا فين من الهدف؟")).toBe("standing");
    expect(classifyTopic("وصلت كام؟")).toBe("standing");
    expect(classifyTopic("my standing")).toBe("standing");
    expect(classifyTopic("میرا ہدف")).toBe("standing");
  });

  it("classifies tips and nothing else as loose", () => {
    expect(classifyTopic("ازاي ابيع أكتر؟")).toBe("tips");
    expect(classifyTopic("عايز نصيحة")).toBe("tips");
    expect(classifyTopic("any tips?")).toBe("tips");
    expect(classifyTopic("")).toBe("other");
  });

  it("is not fooled by invisible characters or tashkeel inside a keyword", () => {
    expect(classifyTopic("عمو\u200Bلتي كام؟")).toBe("commission");
    expect(classifyTopic("عمو\u202Eلتي")).toBe("commission");
    expect(classifyTopic("عمـــولتي")).toBe("commission");
    expect(classifyTopic("ｃｏｍｍｉｓｓｉｏｎ")).toBe("commission");
  });

  it("never throws and finishes fast on hostile input", () => {
    const t0 = performance.now();
    expect(classifyTopic("ا".repeat(100_000))).toBe("other");
    expect(classifyTopic(undefined as unknown as string)).toBe("other");
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("strictnessFor", () => {
  it("is loose only for tips and other", () => {
    const loose = TOPICS.filter((t) => strictnessFor(t) === "loose");
    expect(loose).toEqual(["tips", "other"]);
  });

  it("is strict for a value that is not a topic", () => {
    expect(strictnessFor("whatever" as Topic)).toBe("strict");
  });
});

describe("isTopic", () => {
  it("accepts the closed list only", () => {
    expect(TOPICS.every(isTopic)).toBe(true);
    expect(isTopic("Commission")).toBe(false);
    expect(isTopic(3)).toBe(false);
  });
});
