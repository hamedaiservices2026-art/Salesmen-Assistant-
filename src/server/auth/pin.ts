import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LEN = 32;
/** scrypt cost parameters written into every new hash (Node's defaults). */
const N = 16384;
const R = 8;
const P = 1;

function derive(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem: scrypt needs about 128 * N * r bytes (plus 128 * r * p); allow 130 * N * r so any cost
    // `parseHash` admits (up to 2^20 x 8 = about 1.1 GB) runs, and nothing beyond it can.
    scrypt(secret, salt, KEY_LEN, { N: n, r, p, maxmem: 130 * n * r + 128 * r * p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns `scrypt$16384$8$1$<salt>$<key>` (salt and key hex) with a random 16-byte salt. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("hex"), key.toString("hex")].join("$");
}

const HEX = /^(?:[0-9a-f]{2})+$/;

/** Parses a stored hash: the current `scrypt$N$r$p$salt$key` form or the plan-1 `salt:key` form (default cost). */
function parseHash(hash: string): { n: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  let n = N;
  let r = R;
  let p = P;
  let saltHex: string | undefined;
  let keyHex: string | undefined;
  if (hash.startsWith("scrypt$")) {
    const parts = hash.split("$");
    if (parts.length !== 6) return null;
    [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
    [saltHex, keyHex] = [parts[4], parts[5]];
    // Bounded cost (N a power of two up to 2^20, r up to 8, p up to 4) so a bad row cannot exhaust memory.
    // The cap is on what is verified; new hashes keep using N (see above).
    const powerOfTwo = Number.isInteger(n) && n >= 1024 && n <= 1_048_576 && (n & (n - 1)) === 0;
    if (!powerOfTwo || !Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 4) return null;
  } else {
    [saltHex, keyHex] = hash.split(":");
  }
  if (!saltHex || !keyHex || !HEX.test(saltHex) || !HEX.test(keyHex)) return null;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LEN) return null;
  return { n, r, p, salt: Buffer.from(saltHex, "hex"), key };
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  const parsed = parseHash(hash);
  if (!parsed) return false;
  const actual = await derive(secret, parsed.salt, parsed.n, parsed.r, parsed.p);
  return timingSafeEqual(actual, parsed.key);
}

/** A PIN is exactly 6 digits, not one repeated digit, and not 123456. */
export function isStrongPin(pin: string): boolean {
  if (!/^[0-9]{6}$/.test(pin)) return false;
  if (/^(.)\1{5}$/.test(pin)) return false;
  return pin !== "123456";
}

/** Maps Arabic-Indic (U+0660-0669) and Persian (U+06F0-06F9) digits to Western digits. */
export function normalizePin(pin: string): string {
  return pin.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
