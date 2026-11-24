// Text normalisation shared by the spoken-number parser, topic matching and the fake provider.
// Pure: no framework or database imports.

// Tashkeel (harakat, tanween, shadda, sukun, small high marks), superscript alef and Quranic marks.
const TASHKEEL = /[ً-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;
const LETTERS: Record<string, string> = {
  "أ": "ا", // أ
  "إ": "ا", // إ
  "آ": "ا", // آ
  "ٱ": "ا", // ٱ
  "ى": "ي", // ى → ي
  "ة": "ه", // ة → ه
  "ؤ": "و", // ؤ → و
  "ئ": "ي", // ئ → ي
  // Urdu and Persian letters (Task 12), so an Urdu name matches its Arabic-script spelling.
  "\u06A9": "ك", // ک keheh → ك
  "\u06CC": "ي", // ی farsi yeh → ي
  "\u06D2": "ي", // ے yeh barree → ي
  "\u06C1": "ه", // ہ heh goal → ه
};
const LETTER_RE = /[أإآٱىةؤئ\u06A9\u06CC\u06D2\u06C1]/g;
// The Arabic decimal and thousands separators (U+066B, U+066C) read as `.` and `,`, so they are kept
// between two digits and become a space elsewhere, like the Latin ones.
const ARABIC_DECIMAL = /\u066B/g;
const ARABIC_THOUSANDS = /\u066C/g;
const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;
const PUNCTUATION = /[،,؛;.:!؟?]/g;
const DIGIT = /[0-9]/;

export function normaliseArabic(s: string): string {
  const letters = s
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(LETTER_RE, (c) => LETTERS[c] ?? c)
    .replace(ARABIC_INDIC, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(PERSIAN, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DECIMAL, ".")
    .replace(ARABIC_THOUSANDS, ",")
    .toLowerCase();
  const spaced = letters.replace(PUNCTUATION, (mark, offset: number, whole: string) =>
    DIGIT.test(whole[offset - 1] ?? "") && DIGIT.test(whole[offset + 1] ?? "") ? mark : " ",
  );
  return spaced.replace(/\s+/g, " ").trim();
}
