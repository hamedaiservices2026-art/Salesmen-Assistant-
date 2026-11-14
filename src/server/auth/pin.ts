import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LEN = 32;

function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns `salt:key` (both hex) using scrypt with a random 16-byte salt. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  if (expected.length !== KEY_LEN) return false;
  const actual = await derive(secret, Buffer.from(saltHex, "hex"));
  return timingSafeEqual(actual, expected);
}

/** A PIN is exactly 6 digits, not one repeated digit, and not 123456. */
export function isStrongPin(pin: string): boolean {
  if (!/^[0-9]{6}$/.test(pin)) return false;
  if (/^(.)\1{5}$/.test(pin)) return false;
  return pin !== "123456";
}
