// "Explain simply" on an incentive notification: the shape of the id the address carries, the
// address itself, and when the button is offered. Pure; the server re-checks the id's owner.

/** A notification id as it is written in an address: letters, digits, `_` and `-`, 1–64 characters. */
const NOTIFICATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isNotificationId(value: unknown): value is string {
  return typeof value === "string" && NOTIFICATION_ID.test(value);
}

/** The assistant address that explains one notification; null for anything that is not an id. */
export function explainHref(notificationId: unknown): string | null {
  return isNotificationId(notificationId) ? `/app/assistant?explain=${notificationId}` : null;
}

/**
 * The button is shown when a request would go (available) or would go after the rep accepts the
 * notice (the assistant screen then asks him). Every other state has no use for it: the
 * assistant screen says why there instead.
 */
export function explainOffered(status: { available: boolean; reason: string | null }): boolean {
  return status.available || status.reason === "no_notice";
}
