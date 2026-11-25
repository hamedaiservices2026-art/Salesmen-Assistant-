// A model's answer made into plain text for the screen and for the number check: no tags, links,
// addresses, markup or invisible characters can survive. The result is rendered as a React text node
// only; this is defence in depth and keeps what the rep reads equal to what was checked. Pure, linear.
import { stripInvisible } from "@/domain/ai/aliases";
import { westernDigits } from "./numbers";

const LINE_BREAKS = /\r\n?|[\v\f\u0085\u2028\u2029]/g;

/** Control, format (bidi marks, overrides and isolates, zero-width, soft hyphen) and private-use characters, line by line so newlines stay. */
function removeInvisible(s: string): string {
  return s
    .replace(LINE_BREAKS, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => stripInvisible(line))
    .join("\n");
}

/**
 * Everything from a `<` to the next `>` goes. A `<` with no `>` after it is dropped on its own (the
 * text after it stays): removing to the end would let one stray `<` erase the answer, and keeping it
 * could open a tag. One pass; the position of the next `>` is looked up only when passed.
 */
function removeAngles(s: string): string {
  if (!s.includes("<")) return s;
  let out = "";
  let i = 0;
  let gt = -2; // -2: not looked up yet; -1: there is no `>` after this point
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    if (gt !== -1 && gt < lt) gt = s.indexOf(">", lt);
    i = gt === -1 ? lt + 1 : gt + 1;
  }
  return out;
}

/** Emphasis, code and strike-through markers anywhere; heading and quote markers at the start of a line. */
function removeEmphasis(s: string): string {
  return s.replace(/[*_`~]/g, "").replace(/^[ ]*(?:[#>][ ]*)+/gm, "");
}

/** The model's tags (`D1`, `S2`, `F3`, `I1`, `D1/S2`, `D1 S2`) and the brackets left empty around them (R57). */
function removeTags(s: string): string {
  return s.replace(/\b[DFIS]\d{1,4}\b(?:[ ]*[/,،][ ]*\b[DFIS]\d{1,4}\b)*/g, " ");
}

const LINK = /!?\[([^[\]\n]*)\]\(([^()\n]*)\)/g;
const REFERENCE = /!?\[([^[\]\n]*)\]\[[^[\]\n]*\]/g;
const DEFINITION = /^[ ]*\[[^[\]\n]*\]:[^\n]*/gm;

/** Markdown links and images become their text; reference definitions go. Nested links unwrap one level per pass. */
function removeLinks(s: string): string {
  let out = s.replace(DEFINITION, "");
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(LINK, "$1").replace(REFERENCE, "$1");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\]\(/g, " ");
}

const SCRIPT_SCHEMES = /(?:javascript|vbscript|livescript|data|blob|file|mailto|tel|sms|callto|intent)[ ]*:\S*/gi;
// Any scheme (`http`, `https`, `hxxp`, `ftp`, …), with spaces around `:` or `//` and the
// percent-encoded forms (`http%3A%2F%2F`). The scheme is at most 32 characters, so the scan stays linear.
const SCHEME_URL = /[a-z][a-z0-9+.-]{0,31}[ ]*(?::|%3a)[ ]*(?:\/|%2f)[ ]*(?:\/|%2f)\S*/gi;
const PROTOCOL_RELATIVE = /(^|[^\p{L}\p{N}:])\/\/\S+/gu;
const WWW = /www\d{0,3}\.\S*/gi;
// A bare domain (`evil.com`, `evil.test/a`) with a common top-level domain. Lookalike IDN hosts are out of scope.
const BARE_DOMAIN =
  /\b[a-z0-9-]{1,63}\.(?:com|net|org|info|biz|io|co|me|app|dev|xyz|top|site|online|shop|store|link|click|live|page|ly|gl|ru|cn|sa|ae|eg|qa|kw|bh|om|pk|in|uk|us|tk|ml|ga|cf|gq|ai|gg|to|cc|tv|ws|sh|test)\b\S*/gi;

function removeAddresses(s: string): string {
  return s
    .replace(SCRIPT_SCHEMES, " ")
    .replace(SCHEME_URL, " ")
    .replace(PROTOCOL_RELATIVE, "$1 ")
    .replace(WWW, " ")
    // An ideographic or half-width full stop between two letters is a dot to a domain (`evil\u3002com`).
    .replace(/(?<=[a-z0-9])[\u3002\uFF61](?=[a-z0-9])/gi, ".")
    .replace(BARE_DOMAIN, " ");
}

function removeEmptyBrackets(s: string): string {
  return s.replace(/[([{][ ]*[/,،:;\-–]*[ ]*[)\]}]/g, " ");
}

/** One cleaning pass. Each step can uncover what an earlier one hid (`h<x>ttp://`, `h_ttp://`), so passes repeat until nothing changes. */
function pass(s: string): string {
  // Addresses are removed again last: emptying a bracket can join `http( )://` into an address.
  return removeAddresses(removeEmptyBrackets(removeAddresses(removeLinks(removeTags(removeEmphasis(removeAngles(westernDigits(removeInvisible(s.normalize("NFKC"))))))))));
}

function tidy(s: string): string {
  return s
    .split("\n")
    .map((line) => line.replace(/[   -   　]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The answer as plain text: NFKC; control, bidi and zero-width characters removed; every digit made
 * Western and marks or fillers between two digits removed (`westernDigits`, the same as the number
 * check, R80); anything between
 * `<` and `>` removed; markdown emphasis, heading and quote markers removed; the tags `D1`, `S2`, `F3`,
 * `I1` (also `D1/S2`, `D1 S2`) removed before the number check sees the text (R57); markdown links and
 * images reduced to their text; addresses removed (any `scheme://`, spaced or percent-encoded,
 * `javascript:`, `data:`, `vbscript:`, `//host`, `www.`, a bare `host.com`); runs of blank lines
 * collapsed; cut to `max` code points.
 */
export function plainText(text: string, max: number): string {
  if (typeof text !== "string" || text === "") return "";
  let s = text.toWellFormed();
  for (let n = 0; n < 4; n++) {
    const next = pass(s);
    if (next === s) break;
    s = next;
  }
  s = tidy(s);
  const limit = Math.max(0, Math.floor(max));
  const points = Array.from(s);
  return points.length <= limit ? s : points.slice(0, limit).join("").trim();
}
