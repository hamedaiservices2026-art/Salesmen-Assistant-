import { describe, expect, it } from "vitest";
import { maskNames } from "./mask";
import { judgeReply } from "./reply";

const none = { sectionNumbers: new Map<string, ReadonlySet<string>>(), knownSections: new Set<string>() };

describe("maskNames", () => {
  it("masks a name repeated whole, so its digits are not a figure", () => {
    expect(maskNames("كولا 330 مل علب باقي لها 280", ["كولا 330 مل علب"])).toBe(" ∎  باقي لها 280");
    expect(maskNames("Pepsi 330 باقي 1,860", ["Pepsi 330"])).toBe(" ∎  باقي 1,860");
    expect(maskNames("(Pepsi 330).", ["Pepsi 330"])).toBe("( ∎ ).");
  });

  it("never masks a name glued to a longer number: the head of 330,000 stays to be checked (final review B-L1)", () => {
    for (const answer of ["عمولة Pepsi 330,000 ريال", "عمولة Pepsi 3301 ريال", "عمولة Pepsi 330.5 ريال", "Pepsi 330x", "1Pepsi 330", "aPepsi 330"])
      expect(maskNames(answer, ["Pepsi 330"]), answer).toBe(answer);
    const v = judgeReply({ answer: maskNames("عمولة Pepsi 330,000 ريال", ["Pepsi 330"]), citations: [], answerable: true }, { topic: "commission", question: "عمولتي كام؟", factNumbers: new Set(["0", "414"]), ...none });
    expect(v.kind).toBe("unverified_numbers");
  });

  it("a trailing comma or full stop after the name is fine", () => {
    expect(maskNames("Pepsi 330, باقي 5", ["Pepsi 330"])).toBe(" ∎ , باقي 5");
    expect(maskNames("Pepsi 330.", ["Pepsi 330"])).toBe(" ∎ .");
  });
});
