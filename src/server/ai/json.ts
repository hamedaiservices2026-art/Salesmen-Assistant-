/** Longest model reply the server will read (Global Constraints). */
export const REPLY_MAX = 20_000;

const FENCE = "```";
/** Keys refused anywhere in a reply: they name prototype machinery, never a field we read. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

class Refused extends Error {}

/**
 * Throws (caught below) on a forbidden key or a number that is not finite (`1e999` parses to
 * Infinity). Duplicate keys are not detected: `JSON.parse` keeps the last one, which is safe here
 * because every reply is then checked by a strict zod schema.
 */
function reviver(key: string, value: unknown): unknown {
  if (FORBIDDEN_KEYS.has(key)) throw new Refused();
  if (typeof value === "number" && !Number.isFinite(value)) throw new Refused();
  return value;
}
// One fenced block, optionally tagged `json`, filling the whole (trimmed) reply.
const FENCED = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n[ \t]*```$/i;

/**
 * Reads a model reply that is exactly one JSON value, or exactly one fenced block holding one,
 * with only whitespace around it. Anything else (prose before or after, two blocks, broken JSON,
 * a reply over the cap, a `__proto__`/`constructor`/`prototype` key, a non-finite number) is
 * `undefined`. The reply is untrusted: no eval, only `JSON.parse`. Duplicate keys: last wins.
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
    return JSON.parse(body, reviver) as unknown;
  } catch {
    return undefined;
  }
}
