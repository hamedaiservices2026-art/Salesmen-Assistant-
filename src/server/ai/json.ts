/** Longest model reply the server will read (Global Constraints). */
export const REPLY_MAX = 20_000;

const FENCE = "```";
// One fenced block, optionally tagged `json`, filling the whole (trimmed) reply.
const FENCED = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*```$/i;

/**
 * Reads a model reply that is exactly one JSON value, or exactly one fenced block holding one,
 * with only whitespace around it. Anything else (prose before or after, two blocks, broken JSON,
 * a reply over the cap) is `undefined`. The reply is untrusted: no eval, only `JSON.parse`.
 */
export function parseJsonReply(text: string): unknown | undefined {
  if (typeof text !== "string" || text.length > REPLY_MAX) return undefined;
  const trimmed = text.trim();
  if (trimmed === "") return undefined;

  let body = trimmed;
  if (trimmed.startsWith(FENCE)) {
    const inner = FENCED.exec(trimmed)?.[1];
    if (inner === undefined || inner.includes(FENCE)) return undefined;
    body = inner.trim();
    if (body === "") return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
