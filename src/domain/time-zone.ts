let byLower: Map<string, string> | null = null;

function table(): Map<string, string> {
  if (!byLower) {
    byLower = new Map();
    for (const tz of [...Intl.supportedValuesOf("timeZone"), "UTC"]) byLower.set(tz.toLowerCase(), tz);
  }
  return byLower;
}

/**
 * The canonical spelling of an IANA time zone name (`asia/riyadh` becomes `Asia/Riyadh`), or null
 * for anything else: unknown names, offsets such as `+03:00` or `utc+3`, empty input.
 */
export function canonicalTimeZone(input: string): string | null {
  return table().get(input.trim().toLowerCase()) ?? null;
}
