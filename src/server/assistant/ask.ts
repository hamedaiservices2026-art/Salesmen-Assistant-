// Asking the assistant: the rep's question, his own context, one chat request, and a verdict decided
// by code. A reply is untrusted: it must be `AnswerSchema` JSON (else the fallback provider is tried
// and a final failure is `unreadable`, R35), and `judgeReply` then checks every number and citation
// against what was given, so text planted in a policy or incentive cannot make a figure appear.
// No `after()` here (R38): the server action schedules maintenance.
import { randomUUID } from "node:crypto";
import * as s from "@/db/schema";
import { ANSWER_MAX, AnswerSchema, judgeReply, type Verdict } from "@/domain/assistant/reply";
import { plainText } from "@/domain/assistant/plain";
import { classifyTopic, type Topic } from "@/domain/assistant/topics";
import { stripInvisible } from "@/domain/ai/aliases";
import { todayIn, type ISODate } from "@/domain/calendar";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { aiAvailability } from "@/server/ai/availability";
import { aiCall, logRejection, type AiCallFail } from "@/server/ai/call";
import { peekAi } from "@/server/ai/quota";
import { readAiConfig, type AiConfig } from "@/server/ai/config";
import { parseJsonReply } from "@/server/ai/json";
import type { AiProvider } from "@/server/ai/types";
import { buildRepContext, catalogTranslator, type Fact, type FactMeta, type RepContext, type Translate } from "./context";
import { deleteOwnExpired, HISTORY_TURNS, recentMessages, type Citation } from "./conversation";
import { assistantPrompt, cleanUntrusted, newNonce } from "./prompt";

export const QUESTION_MAX = 500;
/** Facts shown on a verdict card when the answer could not be verified. */
const VERDICT_FACTS_MAX = 8;
/** A question longer than this (in UTF-16 units) is refused before it is even trimmed. */
const QUESTION_RAW_MAX = 4 * QUESTION_MAX;
const MAX_OUTPUT_TOKENS = 700;
/** A stored assistant text is re-cleaned to this before it re-enters a prompt. */
const HISTORY_TEXT_MAX = 1500;
/** Stored rows read to find the last complete turns (unavailable rows are never read back). */
const HISTORY_SCAN = 4 * HISTORY_TURNS;

/**
 * The figures a topic's answer may state (R81), from the facts' own figures by group, never from a
 * label or a date: commission → commission facts; remaining and standing → line facts and selling
 * days; collection → collection lines; coverage; focus (targets and achieved, not windows);
 * incentive → incentive facts, incentive texts and commission facts; policy → none (the cited
 * sections are added by `judgeReply`); other and tips → line, commission and selling-day facts.
 */
function allowedFor(topic: Topic, c: RepContext): ReadonlySet<string> {
  const groups: Partial<Record<Topic, FactMeta["group"][]>> = {
    commission: ["commission"],
    remaining: ["line", "days"],
    standing: ["line", "days"],
    collection: ["line"],
    coverage: ["coverage"],
    focus: ["focus"],
    incentive: ["incentive", "commission"],
    other: ["line", "commission", "days"],
    tips: ["line", "commission", "days"],
  };
  const wanted = groups[topic] ?? [];
  const out = new Set<string>();
  for (const m of c.factMeta.values()) {
    if (!wanted.includes(m.group)) continue;
    if (topic === "collection" && m.lineKind !== "collection") continue;
    for (const n of m.numbers) out.add(n);
  }
  if (topic === "incentive") for (const n of c.incentiveNumbers) out.add(n);
  return out;
}

/** Each exact occurrence of a name we gave, longest first, replaced by a neutral mark. */
function maskNames(answer: string, names: readonly string[]): string {
  if (typeof answer !== "string") return answer;
  let s = answer.toWellFormed().normalize("NFKC");
  for (const name of names) if (name !== "" && /\p{Nd}/u.test(name)) s = s.split(name).join(" ∎ ");
  return s;
}

type Turn = { role: "user" | "assistant"; text: string };

/**
 * The last complete turns: a question immediately followed by an answer row with text (an
 * unverified, unanswered or unavailable turn is left out), each re-cleaned with `plainText` and the
 * boundary cleaning, at most `HISTORY_TURNS` rows, oldest first.
 */
function historyTurns(rows: { role: "user" | "assistant"; text: string; verdict: string | null }[], nonce: string): Turn[] {
  const pairs: Turn[][] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const q = rows[i]!;
    const a = rows[i + 1]!;
    if (q.role !== "user" || a.role !== "assistant" || a.verdict !== "answer") continue;
    const qt = cleanUntrusted(plainText(q.text, HISTORY_TEXT_MAX), nonce, false);
    const at = cleanUntrusted(plainText(a.text, HISTORY_TEXT_MAX), nonce, false);
    if (qt === "" || at === "") continue;
    pairs.push([{ role: "user", text: qt }, { role: "assistant", text: at }]);
    i++;
  }
  return pairs.slice(-Math.floor(HISTORY_TURNS / 2)).flat();
}

/** Consecutive messages of the same role joined, so the request strictly alternates and ends with the question. */
function alternate(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const last = out.at(-1);
    if (last && last.role === t.role) last.text = `${last.text}\n\n${t.text}`;
    else out.push({ ...t });
  }
  return out;
}

export type AskResult =
  | { ok: true; verdict: "answer"; text: string; citations: Citation[] }
  | { ok: true; verdict: "not_in_documents" | "unverified_numbers" | "no_answer"; facts: Fact[] }
  | { ok: false; reason: AiCallFail["reason"] | "empty" | "too_long" };

export type AskInput = { question: string; explain?: { notificationId: string }; viaVoice?: boolean };
export type AskOpts = { today?: ISODate; now?: Date; config?: AiConfig; t?: Translate; providers?: AiProvider[] };

/** The question as stored and sent: well formed, no control/bidi characters, trimmed, 1–500 code points. */
function cleanQuestion(raw: unknown): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (raw.length > QUESTION_RAW_MAX) return { ok: false, reason: "too_long" };
  const text = raw
    .toWellFormed()
    .replace(/\r\n?|[\v\f\u0085\u2028\u2029]/g, "\n")
    .split("\n")
    .map((line) => stripInvisible(line).replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
  const points = Array.from(text).length;
  if (points === 0) return { ok: false, reason: "empty" };
  if (points > QUESTION_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

/** Which facts a verdict card shows, by topic, chosen by code (catalog keys in priority order). */
const VERDICT_KEYS: Partial<Record<Topic, { groups: FactMeta["group"][]; keys?: string[]; lineKind?: FactMeta["lineKind"] }>> = {
  remaining: { groups: ["line", "days"], keys: ["lineRemaining", "lineDaily", "daysLeft"] },
  standing: { groups: ["line"], keys: ["linePct", "lineAchieved", "lineTarget", "lineStatus"] },
  collection: { groups: ["line"], lineKind: "collection", keys: ["lineRemaining", "lineAchieved", "lineTarget", "linePct"] },
  coverage: { groups: ["coverage"] },
  focus: { groups: ["focus"] },
  commission: { groups: ["commission"] },
  incentive: { groups: ["incentive", "commission"] },
  other: { groups: ["line"], keys: ["linePct", "lineRemaining"] },
};

function verdictFacts(topic: Topic, c: RepContext): Fact[] {
  const rule = VERDICT_KEYS[topic];
  if (!rule) return [];
  const eligible = c.facts.filter((f) => {
    const m = c.factMeta.get(f.id);
    if (!m || !rule.groups.includes(m.group)) return false;
    if (rule.lineKind && m.lineKind !== rule.lineKind) return false;
    return !rule.keys || rule.keys.includes(m.key);
  });
  const rank = (f: Fact) => {
    const m = c.factMeta.get(f.id)!;
    const g = rule.groups.indexOf(m.group);
    const k = rule.keys ? rule.keys.indexOf(m.key) : 0;
    return g * 1000 + k;
  };
  return eligible
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .slice(0, VERDICT_FACTS_MAX)
    .map(({ f }) => ({ id: f.id, label: f.label, value: f.value }));
}

async function store(ctx: Ctx, now: Date, question: string, answer: { text: string; verdict: Verdict["kind"] | "unavailable"; citations: Citation[] }) {
  await ctx.db.insert(s.assistantMessages).values([
    { id: randomUUID(), companyId: ctx.companyId, userId: ctx.userId, role: "user", text: question, verdict: null, createdAt: now },
    {
      id: randomUUID(),
      companyId: ctx.companyId,
      userId: ctx.userId,
      role: "assistant",
      text: answer.text,
      verdict: answer.verdict,
      citations: answer.citations,
      createdAt: now,
    },
  ]);
}

/**
 * Answers one question. Order: own context, rep or supervisor; the question checked (1–500 code
 * points); the topic from code (`incentive` for an explain request); the caller's rows past retention
 * deleted; availability; the context (null only for an explain id that is not the caller's → `failed`
 * at once, no counter, no provider, nothing stored); one `aiCall` (availability, rate limit and quotas
 * before any provider call); `judgeReply`. The question and the answer (or the verdict) are stored as
 * two rows; a call refused by a limit or failed stores the question and an `unavailable` row.
 * `viaVoice` changes nothing in the request (the transcript was shown to the rep, who sent it).
 */
export async function ask(ctx: Ctx, input: AskInput, opts: AskOpts = {}): Promise<AskResult> {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
  const explain = input?.explain;
  // An explain request carries no wording from the browser: the question is written below from the
  // catalog and the incentive's title.
  const q = explain ? ({ ok: true, text: "" } as const) : cleanQuestion(input?.question);
  if (!q.ok) return { ok: false, reason: q.reason };
  let question = q.text;

  const now = opts.now ?? new Date();
  const today = opts.today ?? todayIn(ctx.timeZone, now);
  const config = opts.config ?? readAiConfig(process.env);
  const t = opts.t ?? catalogTranslator(ctx.locale);
  const topic: Topic = explain ? "incentive" : classifyTopic(question);

  await deleteOwnExpired(ctx, now);

  // Nothing is read, built or stored for a request that cannot be sent (switches, notice, provider).
  const available = await aiAvailability(ctx, "chat", config, opts.providers);
  if (!available.ok) return { ok: false, reason: available.reason };

  // R81: a request the counters would refuse is answered before any context is built, and stores
  // nothing. A read-only peek; `aiCall`'s reservation below stays the authority.
  const peek = await peekAi(ctx, "chat", now, { day: config.globalDay.chat, minute: config.globalMinute.chat });
  if (peek === "rate_limited") return { ok: false, reason: "rate_limited" };
  if (peek !== "ok") {
    await logRejection(ctx, "chat", explain ? "explain" : "assistant", topic, peek, now);
    return { ok: false, reason: "quota" };
  }

  const c = await buildRepContext(ctx, {
    today,
    now,
    question,
    t,
    budget: config.contextMax,
    ...(explain ? { only: { notificationId: explain.notificationId } } : {}),
  });
  if (c === null) return { ok: false, reason: "failed" };
  if (explain) {
    // Stored and sent as the rep's turn: the catalog wording, then the title as the company wrote it
    // (cleaned, cut to the question limit). The title is data; it is cleaned again at the boundary below.
    const title = c.incentives[0]?.title ?? "";
    const worded = cleanQuestion(`${t("assistant.explainQuestion")} ${title}`);
    question = worded.ok ? worded.text : Array.from(`${t("assistant.explainQuestion")} ${title}`).slice(0, QUESTION_MAX).join("").trim();
  }

  const nonce = newNonce();
  const { system, contextMessage } = assistantPrompt(c, ctx.locale, nonce);
  const history = historyTurns(await recentMessages(ctx, HISTORY_SCAN, now), nonce);
  const messages = alternate([
    { role: "user", text: contextMessage },
    ...history,
    { role: "user", text: cleanUntrusted(question, nonce, false) },
  ]);

  const r = await aiCall(
    ctx,
    {
      kind: "chat",
      feature: explain ? "explain" : "assistant",
      topic,
      call: (p, signal) => p.chat({ system, messages, maxOutputTokens: MAX_OUTPUT_TOKENS }, signal),
      parse: (text) => {
        const raw = parseJsonReply(text);
        return AnswerSchema.safeParse(raw).success ? raw : null;
      },
    },
    { now, config, ...(opts.providers ? { providers: opts.providers } : {}) },
  );
  if (!r.ok) {
    // A limit refusal (only a race past the peek gets here) stores nothing, like the peek (R81).
    if (r.reason === "failed" || r.reason === "unreadable") {
      await store(ctx, now, question, { text: "", verdict: "unavailable", citations: [] });
    }
    return { ok: false, reason: r.reason };
  }

  // R35: judged after the call, on the reply the parse accepted. R81: the figures allowed are the
  // topic's own facts (a commission answer cannot state the remaining cases or a date); a policy
  // answer has the sections it cites alone. Names we gave (lines, items, components, labels) are
  // masked for the check, so `كولا 330 مل` repeated whole is not the figure 330.
  const reply = r.value as { answer: string; citations: unknown; answerable: boolean };
  const verdict = judgeReply(
    { ...reply, answer: maskNames(reply.answer, c.names) },
    { topic, question, factNumbers: allowedFor(topic, c), sectionNumbers: c.sectionNumbers, knownSections: c.knownSections },
  );

  if (verdict.kind === "answer") {
    const text = plainText(reply.answer, ANSWER_MAX);
    const citations = verdict.citations.flatMap((ci) => {
      const doc = c.docs.find((d) => d.tag === ci.doc);
      const sec = doc?.sections.find((x) => x.tag === ci.section);
      return doc && sec ? [{ title: doc.title, label: sec.label }] : [];
    });
    await store(ctx, now, question, { text, verdict: "answer", citations });
    return { ok: true, verdict: "answer", text, citations };
  }
  await store(ctx, now, question, { text: "", verdict: verdict.kind, citations: [] });
  const facts = verdict.kind === "not_in_documents" ? [] : verdictFacts(topic, c);
  return { ok: true, verdict: verdict.kind, facts };
}
