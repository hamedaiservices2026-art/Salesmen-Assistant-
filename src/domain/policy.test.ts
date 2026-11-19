import { describe, expect, it } from "vitest";
import { LABEL_MAX, SECTIONS_MAX, checkPolicyFile, codePointLength, decodePolicyBytes, splitSections } from "./policy";

describe("splitSections", () => {
  it("splits the brief's example", () => {
    expect(splitSections("مقدمة\n# المرتجعات\nنص\n2) الخصم\nنص2")).toEqual([
      { label: "", text: "مقدمة" },
      { label: "المرتجعات", text: "نص" },
      { label: "2) الخصم", text: "نص2" },
    ]);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(splitSections("")).toEqual([]);
    expect(splitSections("  \n\r\n \t")).toEqual([]);
  });

  it("accepts CRLF and lone CR", () => {
    const want = [
      { label: "A", text: "x" },
      { label: "1.2. B", text: "y" },
    ];
    expect(splitSections("# A\r\nx\r\n1.2. B\r\ny")).toEqual(want);
    expect(splitSections("# A\rx\r1.2. B\ry")).toEqual(want);
  });

  it("recognises numbered headings only with a closing . or ) and a space", () => {
    expect(splitSections("1. one\na\n1.2) two\nb\n3 three\n4.5 four\n12.\nx")).toEqual([
      { label: "1. one", text: "a" },
      { label: "1.2) two", text: "b\n3 three\n4.5 four\n12.\nx" },
    ]);
  });

  it("drops headings with no text and a heading made only of hashes is plain text", () => {
    expect(splitSections("# empty\n## next\nbody\n###")).toEqual([{ label: "next", text: "body\n###" }]);
  });

  it("caps the label length and the number of sections", () => {
    const [s] = splitSections(`# ${"x".repeat(LABEL_MAX + 50)}\nbody`);
    expect(codePointLength(s!.label)).toBe(LABEL_MAX);
    const many = Array.from({ length: SECTIONS_MAX + 500 }, (_, i) => `# h${i}\nt${i}`).join("\n");
    const out = splitSections(many);
    expect(out).toHaveLength(SECTIONS_MAX);
    expect(out[SECTIONS_MAX - 1]!.text).toContain("t" + (SECTIONS_MAX + 499));
  });

  it("is linear on hostile input", () => {
    for (const body of ["#".repeat(200_000), "1".repeat(200_000), "1.".repeat(100_000), "1.1".repeat(66_000) + "x", "\r".repeat(200_000), "# a\n".repeat(50_000)]) {
      const t0 = performance.now();
      splitSections(body);
      expect(performance.now() - t0).toBeLessThan(500);
    }
  });

  it("keeps markup as plain text", () => {
    expect(splitSections("<script>alert(1)</script>")).toEqual([{ label: "", text: "<script>alert(1)</script>" }]);
  });
});

describe("policy files", () => {
  it("accepts .txt and .md, refuses other names, types and big files", () => {
    expect(checkPolicyFile({ name: "a.TXT", type: "text/plain", size: 10 })).toBeNull();
    expect(checkPolicyFile({ name: "a.md", type: "", size: 10 })).toBeNull();
    expect(checkPolicyFile({ name: "a.md", type: "text/markdown", size: 10 })).toBeNull();
    expect(checkPolicyFile({ name: "a.pdf", type: "application/pdf", size: 10 })).toBe("unsupported_type");
    expect(checkPolicyFile({ name: "a.txt", type: "application/zip", size: 10 })).toBe("unsupported_type");
    expect(checkPolicyFile({ name: "a.txt.exe", type: "text/plain", size: 10 })).toBe("unsupported_type");
    expect(checkPolicyFile({ name: "a.txt", type: "text/plain", size: 1_000_001 })).toBe("too_big");
  });

  it("decodes UTF-8, drops a BOM and refuses invalid bytes", () => {
    const bytes = (a: number[]) => new Uint8Array(a).buffer;
    expect(decodePolicyBytes(new TextEncoder().encode("مرحبا").buffer as ArrayBuffer)).toEqual({ ok: true, text: "مرحبا" });
    expect(decodePolicyBytes(bytes([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ ok: true, text: "a" });
    expect(decodePolicyBytes(bytes([0xff, 0xfe, 0x61]))).toEqual({ ok: false, error: "bad_encoding" });
  });
});
