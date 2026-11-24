import { describe, expect, it } from "vitest";
import { plainText } from "./plain";

const fast = (fn: () => void, ms = 1500) => {
  const t0 = performance.now();
  fn();
  expect(performance.now() - t0).toBeLessThan(ms);
};

describe("plainText", () => {
  it("reduces links, removes bare addresses and markup (plan example)", () => {
    expect(plainText("شوف [هنا](http://evil.test/a) أو http://evil.test/b <img src=x onerror=1>", 1500)).toBe("شوف هنا أو");
  });

  it("removes the model's tag tokens before anything else sees them (R57)", () => {
    expect(plainText("حسب D1/S2 أقصى خصم 3%", 1500)).toBe("حسب أقصى خصم 3%");
    expect(plainText("حسب D1 S2 أقصى خصم 3%", 1500)).toBe("حسب أقصى خصم 3%");
    expect(plainText("عمولتك F3 و I1 (D12/S104)", 1500)).toBe("عمولتك و");
    expect(plainText("[D1/S2] أقصى خصم", 1500)).toBe("أقصى خصم");
    expect(plainText("**D1**", 1500)).toBe("");
    expect(plainText("_S2_ نص", 1500)).toBe("نص");
    expect(plainText("D\u200B1 Ｄ１", 1500)).toBe("");
    expect(plainText("حسبD1/S2", 1500)).toBe("حسب");
  });

  it("keeps tag-like words that are not tags", () => {
    expect(plainText("D12345 SS1 d1", 1500)).toBe("D12345 SS1 d1");
  });

  it("removes a bidi override, isolates, zero-width and control characters", () => {
    expect(plainText("a\u202Eb\u202Cc\u2066d\u2069\u200Be\u0007f\u0000g", 1500)).toBe("abcdefg");
  });

  it("keeps ZWNJ between two letters (Persian and Urdu spelling)", () => {
    expect(plainText("می\u200Cخواهم", 1500)).toBe("می\u200Cخواهم");
  });

  it("cuts to the maximum in code points", () => {
    expect(Array.from(plainText("ا".repeat(2000), 1500))).toHaveLength(1500);
    expect(Array.from(plainText("😀".repeat(2000), 1500))).toHaveLength(1500);
  });

  it("removes every form of address", () => {
    for (const s of [
      "go https://evil.test/x now",
      "go HTTP://evil.test now",
      "go www.evil.test now",
      "go hxxp://evil.test now",
      "go hxxps://evil.test now",
      "go http ://evil.test now",
      "go http: //evil.test now",
      "go http%3A%2F%2Fevil.test now",
      "go //evil.test/path now",
      "go javascript:alert(1) now",
      "go JavaScript :alert(1) now",
      "go data:text/html;base64,PHNjcmlwdD4= now",
      "go vbscript:msgbox now",
      "go ｈｔｔｐ：／／evil.test now",
      "go ftp://evil.test now",
      "go evil.test/a now",
      "go evil.com now",
      "go h*t*t*p://evil.test now",
      "go h_ttp://evil.test now",
      "go ht<b>tp://evil.test now",
      "go http\u200B://evil.test now",
      "go httpD1://evil.test now",
    ]) {
      const out = plainText(s, 1500);
      expect(out, s).not.toMatch(/evil|alert|msgbox|base64|:\/\/|javascript|vbscript|data:|%3a/i);
      expect(out.startsWith("go"), s).toBe(true);
      expect(out.endsWith("now"), s).toBe(true);
    }
  });

  it("removes images and nested links, keeping the link text", () => {
    expect(plainText("![صورة](http://evil.test/x.png) تمام", 1500)).toBe("صورة تمام");
    expect(plainText("[a [b](http://evil.test/1)](http://evil.test/2)", 1500)).not.toMatch(/evil|http|\(|\)/);
    expect(plainText("[هنا][1]\n\n[1]: http://evil.test", 1500)).not.toMatch(/evil|http/);
  });

  it("removes everything between < and >; an unbalanced < is dropped alone", () => {
    expect(plainText("a<script>alert(1)</script>b", 1500)).toBe("aalert(1)b");
    expect(plainText("a <b c", 1500)).toBe("a b c");
    expect(plainText("3 < 5 > 2", 1500)).toBe("3 2");
    expect(plainText("x ＜script＞ y", 1500)).toBe("x y");
    expect(plainText("a<<b>c", 1500)).toBe("ac");
  });

  it("removes markdown emphasis, heading and quote markers", () => {
    expect(plainText("# عنوان\n**مهم** _جدا_ `كود` ~~لا~~\n> اقتباس", 1500)).toBe("عنوان\nمهم جدا كود لا\nاقتباس");
  });

  it("collapses runs of blank lines and spaces", () => {
    expect(plainText("a\n\n\n\n\nb   c\r\n\r\n\r\nd\u2028e", 1500)).toBe("a\n\nb c\n\nd\ne");
  });

  it("is safe when applied twice", () => {
    const once = plainText("h<x>ttp://evil.test [t](u) *a*", 1500);
    expect(plainText(once, 1500)).toBe(once);
    expect(once).not.toMatch(/evil/);
  });

  it("finishes fast on hostile inputs", () => {
    fast(() => plainText("<".repeat(50_000), 1500));
    fast(() => plainText("<a".repeat(50_000) + ">", 1500));
    fast(() => plainText("[".repeat(50_000) + "x" + "](u)".repeat(10_000), 1500));
    fast(() => plainText("[a](".repeat(30_000), 1500));
    fast(() => plainText("http://".repeat(20_000), 1500));
    fast(() => plainText("*_`#".repeat(30_000), 1500));
    fast(() => plainText("\n".repeat(100_000), 1500));
    fast(() => plainText("D1/S2 ".repeat(20_000), 1500));
    fast(() => plainText("\u202E".repeat(100_000), 1500));
    fast(() => plainText("www".repeat(30_000), 1500));
    expect(plainText("<".repeat(50_000), 1500)).toBe("");
  });

  it("never throws on odd input", () => {
    expect(plainText("", 1500)).toBe("");
    expect(plainText(undefined as unknown as string, 1500)).toBe("");
    expect(plainText("a\uD800b", 1500)).toBe("a\uFFFDb");
  });
});
