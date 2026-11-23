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
};
const LETTER_RE = /[أإآٱىةؤئ]/g;
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
    .toLowerCase();
  const spaced = letters.replace(PUNCTUATION, (mark, offset: number, whole: string) =>
    DIGIT.test(whole[offset - 1] ?? "") && DIGIT.test(whole[offset + 1] ?? "") ? mark : " ",
  );
  return spaced.replace(/\s+/g, " ").trim();
}
