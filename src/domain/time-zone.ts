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
  const name = input.trim();
  const listed = table().get(name.toLowerCase());
  if (listed) return listed;
  // Zones the runtime accepts but `supportedValuesOf` leaves out (Asia/Kolkata, Etc/GMT+3, other links
  // and aliases): written as Area/Place, they are canonicalised by the runtime itself. A bare offset
  // such as `+03:00` or `utc+3` has no slash and stays refused.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(name)) return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
