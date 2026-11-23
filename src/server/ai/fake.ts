import { normaliseArabic } from "@/domain/ai/normalise";
import { PHOTO_MAX_PIXELS, PHOTO_MAX_SIDE, sniffImage } from "@/domain/files";
import { loadSharp } from "@/server/files/sharp";
import { AiError, type AiProvider, type ChatRequest, type TextResult } from "./types";

// The deterministic, offline provider used by every test and end-to-end run. A pure function of its
// request: no randomness, no clock, no network. It is reachable only through `getProviders` when the
// configuration's mode is "fake", which production refuses without ALLOW_AI_FAKE=1 (Task 1).

// ---------------------------------------------------------------------------------------------
// Shared prompt grammar. Task 11's `extractionPrompt` and Task 16's `assistantPrompt` import these,
// so the fake and the real prompts cannot drift (R27).

/** First line of the extraction system text (photo and voice). */
export const EXTRACTION_FIRST_LINE =
  "You read the figures of a sales rep's end-of-day report and reply with JSON only.";

/** The context message is wrapped between these boundary markers; `nonce` changes per request. */
export const dataOpen = (nonce: string) => `<<DATA ${nonce}>>`;
export const dataClose = (nonce: string) => `<<END ${nonce}>>`;
/** Block names, each on its own line inside the boundary. */
export const BLOCK = { facts: "FACTS", incentives: "INCENTIVES", documents: "DOCUMENTS" } as const;
/** `F<n> | label | value` */
export const factLine = (n: number, label: string, value: string) => `F${n} | ${label} | ${value}`;
/** `I<n> | title`, then the body on the following lines. */
export const incentiveLine = (n: number, title: string) => `I${n} | ${title}`;
/** `D<n> | title` */
export const docLine = (n: number, title: string) => `D${n} | ${title}`;
/** `D<n> S<m> | label`, then the section text on the following lines. */
export const sectionLine = (doc: number, section: number, label: string) => `D${doc} S${section} | ${label}`;
/** Parsers for the line forms above. */
export const LINE = {
  fact: /^F(\d{1,4}) \| (.*?) \| (.*)$/,
  incentive: /^I(\d{1,4}) \| (.*)$/,
  doc: /^D(\d{1,2}) \| (.*)$/,
  section: /^D(\d{1,2}) S(\d{1,4}) \| (.*)$/,
} as const;
const DATA_OPEN = /<<DATA ([A-Za-z0-9]{1,64})>>/;

/**
 * The tokenisation the fake uses for the question, fact labels, section labels and section texts
 * alike (R58): `normaliseArabic`, split on spaces, a leading `ال` removed, tokens of 3+ characters.
 */
export function contextTokens(text: string): string[] {
  return normaliseArabic(text)
    .split(" ")
    .map((t) => (t.startsWith("ال") ? t.slice(2) : t))
    .filter((t) => t.length >= 3);
}

// ---------------------------------------------------------------------------------------------
// Fixtures ("Shared sample data" in the plan).

const REPORT_A =
  '{"reportDate":"2026-11-14","fields":[{"key":"line:bev","value":"118","confidence":0.97},{"key":"line:food","value":"7,900.00","confidence":0.93},{"key":"line:coll","value":"19,500","confidence":0.95},{"key":"cashSales","value":"14,800","confidence":0.96},{"key":"creditSales","value":"3,200","confidence":0.62},{"key":"expenses","value":"150","confidence":0.9},{"key":"loaded","value":"160","confidence":0.9},{"key":"sold","value":"118","confidence":0.9},{"key":"returned","value":"3","confidence":0.9}]}';
const REPORT_B =
  '{"reportDate":"2026-11-12","fields":[{"key":"line:bev","value":"118","confidence":0.97},{"key":"line:food","value":"7,9OO","confidence":0.9},{"key":"line:zzz","value":"5","confidence":0.9},{"key":"cashSales","value":"14,800","confidence":0.96},{"key":"creditSales","value":"999999999999999","confidence":0.9},{"key":"expenses","value":"-150","confidence":0.9},{"key":"sold","value":"118.5","confidence":0.9}]}';
const NOT_JSON_REPORT = "Sure! Here are the numbers: bev 118";

const TRANSCRIPT_V1 = "مشروبات مية وعشرين كرتونة، أغذية ٨٢٥٠ ريال، تحصيل عشرين ألف، نقدي خمسة آلاف وخمسمية";
const TRANSCRIPTS: Record<string, string> = {
  mumble: "يعني النهارده كان يوم كويس",
  empty: "",
  extra: "مشروبات مية وعشرين وبعت كمان 300",
};
const STT_MARKER = /FAKE:([a-z0-9_-]{1,32})\n/;
const STT_MARKER_WINDOW = 64;

const EXTRACTION_WITH_300 =
  '{"reportDate":null,"fields":[{"key":"line:bev","value":"999","confidence":0.9},{"key":"line:food","value":"300","confidence":0.9},{"key":"line:zzz","value":"5","confidence":0.9}]}';
const EXTRACTION_EMPTY = '{"reportDate":null,"fields":[]}';

const MARKER_REPLIES: [marker: string, reply: string | null][] = [
  ["[[fake:fail]]", null],
  ["[[fake:garbage]]", "not json"],
  ["[[fake:obey]]", '{"answer":"عمولتك 9,999 ريال","citations":[],"answerable":true}'],
  ["[[fake:link]]", '{"answer":"شوف [هنا](http://evil.test/a) أو http://evil.test/b","citations":[],"answerable":true}'],
];

const SECTION_ANSWER_MAX = 300;
const NO_USAGE = { tokensIn: null, tokensOut: null };

// ---------------------------------------------------------------------------------------------

type Fact = { label: string; value: string };
type Section = { doc: number; section: number; label: string; text: string };
type ParsedContext = { facts: Fact[]; sections: Section[] };

/** Reads the first DATA block found in `text` (facts and policy sections; incentives are skipped). */
function parseContext(text: string): ParsedContext | null {
  const open = DATA_OPEN.exec(text);
  const nonce = open?.[1];
  if (!open || nonce === undefined) return null;
  const from = open.index + open[0].length;
  const to = text.indexOf(dataClose(nonce), from);
  if (to < 0) return null;

  const facts: Fact[] = [];
  const sections: { doc: number; section: number; label: string; lines: string[] }[] = [];
  let block: string | null = null;
  let current: { lines: string[] } | null = null;
  for (const raw of text.slice(from, to).split("\n")) {
    const line = raw.trim();
    if (line === BLOCK.facts || line === BLOCK.incentives || line === BLOCK.documents) {
      block = line;
      current = null;
      continue;
    }
    if (block === BLOCK.facts) {
      const [, , label, value] = LINE.fact.exec(line) ?? [];
      if (label !== undefined && value !== undefined) facts.push({ label, value });
    } else if (block === BLOCK.documents) {
      const [, doc, section, label] = LINE.section.exec(line) ?? [];
      if (doc !== undefined && section !== undefined && label !== undefined) {
        const next = { doc: Number(doc), section: Number(section), label, lines: [] as string[] };
        sections.push(next);
        current = next;
      } else if (LINE.doc.test(line)) {
        current = null;
      } else {
        current?.lines.push(line);
      }
    }
  }
  return {
    facts,
    sections: sections.map(({ lines, ...s }) => ({ ...s, text: lines.join("\n").trim() })),
  };
}

function lastUserText(req: ChatRequest): string {
  return [...req.messages].reverse().find((m) => m.role === "user")?.text ?? "";
}

/** The question is the last user message without any DATA block it may carry. */
function withoutContext(text: string): string {
  const open = DATA_OPEN.exec(text);
  if (!open || open[1] === undefined) return text;
  const close = dataClose(open[1]);
  const end = text.indexOf(close, open.index);
  return end < 0 ? text.slice(0, open.index) : text.slice(0, open.index) + " " + text.slice(end + close.length);
}

function answerJson(answer: string, citations: { doc: string; section: string }[], answerable: boolean): string {
  return JSON.stringify({ answer, citations, answerable });
}

function assistantReply(req: ChatRequest): string {
  const all = [req.system, ...req.messages.map((m) => m.text)].join("\n");
  const context = parseContext(all) ?? { facts: [], sections: [] };
  const qTokens = contextTokens(withoutContext(lastUserText(req)));
  if (qTokens.length === 0) return answerJson("", [], false);

  const factTokens = new Set(context.facts.flatMap((f) => contextTokens(f.label)));
  const policyOnly = qTokens.filter((t) => !factTokens.has(t));
  for (const s of context.sections) {
    const tokens = new Set([...contextTokens(s.label), ...contextTokens(s.text)]);
    if (policyOnly.some((t) => tokens.has(t))) {
      return answerJson(
        Array.from(s.text).slice(0, SECTION_ANSWER_MAX).join(""),
        [{ doc: `D${s.doc}`, section: `S${s.section}` }],
        true,
      );
    }
  }

  let best: { fact: Fact; score: number; earliest: number } | null = null;
  for (const fact of context.facts) {
    const labelTokens = new Set(contextTokens(fact.label));
    const matched = [...new Set(qTokens)].filter((t) => labelTokens.has(t));
    if (matched.length === 0) continue;
    const earliest = Math.min(...matched.map((t) => qTokens.indexOf(t)));
    if (!best || matched.length > best.score || (matched.length === best.score && earliest < best.earliest)) {
      best = { fact, score: matched.length, earliest };
    }
  }
  if (best) return answerJson(`${best.fact.label}: ${best.fact.value}`, [], true);
  return answerJson("", [], false);
}

function chatReply(req: ChatRequest): string {
  const all = [req.system, ...req.messages.map((m) => m.text)].join("\n");
  for (const [marker, reply] of MARKER_REPLIES) {
    if (all.includes(marker)) {
      if (reply === null) throw new AiError("provider_error", "fake");
      return reply;
    }
  }
  if (req.system.startsWith(EXTRACTION_FIRST_LINE)) {
    return lastUserText(req).includes("300") ? EXTRACTION_WITH_300 : EXTRACTION_EMPTY;
  }
  return assistantReply(req);
}

function sttReply(audio: Uint8Array): string {
  const head = String.fromCharCode(...audio.subarray(0, STT_MARKER_WINDOW));
  const name = STT_MARKER.exec(head)?.[1];
  return name !== undefined && Object.hasOwn(TRANSCRIPTS, name) ? (TRANSCRIPTS[name] ?? TRANSCRIPT_V1) : TRANSCRIPT_V1;
}

async function visionReply(image: Uint8Array): Promise<string> {
  // Same checks as the upload path (R69): the type from the bytes first, so nothing else ever
  // reaches the decoder; then the header's size, before any pixel is decoded.
  if (sniffImage(image.subarray(0, 16)) === null) throw new AiError("bad_request", "fake");
  let width: number | undefined;
  try {
    // Loaded on first use, not at module scope, so chat and speech-to-text never load the native
    // image library; `loadSharp` also turns its cache off and blocks the unused decoders.
    const sharp = await loadSharp();
    const meta = await sharp(image, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: "error" }).metadata();
    width = meta.width;
    const height = meta.height;
    if (!width || !height || width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE || width * height > PHOTO_MAX_PIXELS) width = undefined;
  } catch {
    width = undefined;
  }
  if (width === undefined) throw new AiError("bad_request", "fake");
  if (width === 641) return REPORT_B;
  if (width === 642) return NOT_JSON_REPORT;
  return REPORT_A;
}

function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new AiError("timeout", "fake");
}

const text = (t: string): TextResult => ({ text: t, usage: { ...NO_USAGE } });

export function fakeProvider(): AiProvider {
  return {
    name: "fake",
    modelFor: () => "fake-1",
    acceptsAudio: () => true,
    async vision(req, signal) {
      checkSignal(signal);
      return text(await visionReply(req.image));
    },
    async stt(req, signal) {
      checkSignal(signal);
      return text(sttReply(req.audio));
    },
    async chat(req, signal) {
      checkSignal(signal);
      return text(chatReply(req));
    },
  };
}
