// Names we gave the model (line and focus-item names) that hold digits, masked in an answer before
// its numbers are checked, so `كولا 330 مل` repeated whole is not the figure 330. Pure.

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

/**
 * True when the name at `at` stands alone: no letter or digit right before it, and right after it no
 * letter, no digit, and no `,`/`.` followed by a digit. Otherwise the name is the head of something
 * longer (`Pepsi 330,000`) and masking it would hide the rest of that number from the check (final
 * review B-L1).
 */
function standsAlone(s: string, at: number, length: number): boolean {
  const before = at > 0 ? s[at - 1]! : "";
  if (before !== "" && LETTER_OR_DIGIT.test(before)) return false;
  const after = s[at + length] ?? "";
  if (after === "") return true;
  if (LETTER.test(after) || DIGIT.test(after)) return false;
  if ((after === "," || after === ".") && DIGIT.test(s[at + length + 1] ?? "")) return false;
  return true;
}

/** Each occurrence of a name we gave that stands alone, longest first (as given), replaced by a neutral mark. */
export function maskNames(answer: string, names: readonly string[]): string {
  if (typeof answer !== "string") return answer;
  let s = answer.toWellFormed().normalize("NFKC");
  for (const name of names) {
    if (name === "" || !DIGIT.test(name)) continue;
    let out = "";
    let from = 0;
    for (let at = s.indexOf(name); at !== -1; at = s.indexOf(name, at + 1)) {
      if (at < from || !standsAlone(s, at, name.length)) continue;
      out += s.slice(from, at) + " ∎ ";
      from = at + name.length;
    }
    s = out + s.slice(from);
  }
  return s;
}
