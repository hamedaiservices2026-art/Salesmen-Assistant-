export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** A password is 10 to 128 characters (code points) with at least 5 distinct characters. */
export function isStrongPassword(pw: string): boolean {
  const chars = Array.from(pw);
  if (chars.length < PASSWORD_MIN || chars.length > PASSWORD_MAX) return false;
  return new Set(chars).size >= 5;
}

/** Admin and owner logins are email addresses, compared trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A plausible email address (one `@`, a dot in the domain, no spaces); expects an already normalized value. */
export function isEmail(email: string): boolean {
  return EMAIL.test(email);
}
