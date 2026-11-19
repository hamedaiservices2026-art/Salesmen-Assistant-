/** Policy text: pure helpers. The text is plain text everywhere; nothing here interprets markup. */

export const POLICY_BODY_MAX = 200_000;
export const POLICY_TITLE_MAX = 200;
export const SECTIONS_MAX = 2000;
export const LABEL_MAX = 200;

export type PolicySection = { label: string; text: string };

export function codePointLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  let n = 0;
  for (const ch of text) {
    if (n === max) break;
    out += ch;
    n++;
  }
  return out;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** `^\d+(\.\d+)*[.)]\s+`, scanned by hand so that no input can make it backtrack. */
function isNumbered(line: string): boolean {
  let i = 0;
  while (isDigit(line[i])) i++;
  if (i === 0) return false;
  for (;;) {
    const c = line[i];
    if (c === "." && isDigit(line[i + 1])) {
      i++;
      while (isDigit(line[i])) i++;
      continue;
    }
    return (c === "." || c === ")") && isSpace(line[i + 1]);
  }
}

/** The label of a `#` heading, or null when the line is not one (a line of only hashes is text). */
function hashLabel(line: string): string | null {
  if (line[0] !== "#") return null;
  let i = 0;
  while (line[i] === "#") i++;
  const label = line.slice(i).trim();
  return label === "" ? null : label;
}

/**
 * Splits a policy into sections at `#` headings and numbered lines. Text before the first heading is
 * a section with label `""`. Sections with no text are dropped. CRLF and lone CR are line breaks.
 * Linear in the input; labels are cut at LABEL_MAX characters and at most SECTIONS_MAX sections are
 * made (what follows the last one stays in its text).
 */
export function splitSections(body: string): PolicySection[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: PolicySection[] = [];
  let label = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text !== "") out.push({ label, text });
    buf = [];
  };
  for (const line of lines) {
    const found = out.length < SECTIONS_MAX - 1 ? (hashLabel(line) ?? (isNumbered(line) ? line.trim() : null)) : null;
    if (found !== null) {
      flush();
      label = clip(found, LABEL_MAX);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export const POLICY_FILE_MAX_BYTES = 1_000_000;

export type PolicyFileError = "unsupported_type" | "too_big" | "bad_encoding";

const FILE_TYPES = ["", "text/plain", "text/markdown", "text/x-markdown"];

/** Checks a chosen file by name, MIME type and size before it is read: only `.txt` and `.md`, about 1 MB at most. */
export function checkPolicyFile(file: { name: string; type: string; size: number }): PolicyFileError | null {
  const name = file.name.toLowerCase();
  if (!(name.endsWith(".txt") || name.endsWith(".md")) || !FILE_TYPES.includes(file.type.toLowerCase())) return "unsupported_type";
  if (file.size > POLICY_FILE_MAX_BYTES) return "too_big";
  return null;
}

/** Reads file bytes as UTF-8 without a byte-order mark; bytes that are not valid UTF-8 are refused, never guessed. */
export function decodePolicyBytes(bytes: ArrayBuffer): { ok: true; text: string } | { ok: false; error: "bad_encoding" } {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: "bad_encoding" };
  }
}
