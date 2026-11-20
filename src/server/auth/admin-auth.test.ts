import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import * as pin from "./pin";
import { hashSecret, verifySecret } from "./pin";
import { isStrongPassword } from "./password";
import { attemptWithLockout } from "./lockout";
import { Forbidden, assertRole, homeFor, signInPathFor } from "./roles";
import { acceptAdminInvite, acceptInvite, createInvite, peekAdminInvite, peekInvite } from "./invites";
import { ADMIN_SESSION_TTL_MS, ADMIN_SESSION_COOKIE_MAX_AGE_S, SESSION_COOKIE_MAX_AGE_S, createSession, sessionCookieMaxAgeS, getSessionUser, signIn, signInWithPassword } from "./sessions";
import { requireRole } from "./guard";
import { acceptInviteAction, signInAction, signOutAction } from "@/app/(auth-actions)/actions";
import { acceptAdminInviteAction, adminSignInAction, adminSignOutAction } from "@/app/admin/actions";
import { saveCloseAction } from "@/app/app/close/actions";
import { setLocaleAction } from "@/app/app/settings/actions";
import nextConfig from "../../../next.config";

const h = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
    }
  }
  return {
    Redirect,
    db: undefined as unknown,
    jar: new Map<string, { value: string; opts?: Record<string, unknown> }>(),
    scryptCalls: 0,
  };
});

vi.mock("node:crypto", async (orig) => {
  const actual = await orig<typeof import("node:crypto")>();
  const scrypt = ((...args: Parameters<typeof actual.scrypt>) => {
    h.scryptCalls++;
    return (actual.scrypt as (...a: unknown[]) => void)(...args);
  }) as typeof actual.scrypt;
  const scryptSync = ((...args: Parameters<typeof actual.scryptSync>) => {
    h.scryptCalls++;
    return actual.scryptSync(...args);
  }) as typeof actual.scryptSync;
  return { ...actual, default: { ...actual, scrypt, scryptSync }, scrypt, scryptSync };
});
vi.mock("./pin", async (orig) => {
  const actual = await orig<typeof import("./pin")>();
  return { ...actual, verifySecret: vi.fn(actual.verifySecret) };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = h.jar.get(name);
      return c ? { name, value: c.value } : undefined;
    },
    set: (name: string, value: string, opts?: Record<string, unknown>) => {
      h.jar.set(name, { value, opts });
    },
    delete: (name: string) => {
      h.jar.delete(name);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new h.Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db/client", () => ({ getDb: async () => h.db }));

const OWNER = { email: "owner@platform.test", password: "demo-owner-2026" };
const ADMIN = { email: "admin@demo.test", password: "demo-admin-2026" };

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  h.db = db;
  h.jar.clear();
  seed = await seedDemo(db);
  vi.mocked(pin.verifySecret).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const userRow = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;
const sessionCount = async (userId: string) =>
  (await db.select().from(s.sessions).where(eq(s.sessions.userId, userId))).length;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const redirectOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof h.Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
};

describe("seeded owner and admin", () => {
  it("seeds the platform company, the owner and the demo admin with password hashes and no PIN", async () => {
    expect((await db.select().from(s.companies)).length).toBe(3);
    const owner = await userRow(seed.ownerId);
    expect(owner).toMatchObject({ companyId: "platform", role: "owner", login: OWNER.email, pinHash: null });
    expect(owner.passwordHash).toMatch(/^scrypt\$/);
    const admin = await userRow(seed.adminId);
    expect(admin).toMatchObject({ companyId: seed.companyId, role: "admin", login: ADMIN.email, pinHash: null });
    expect(admin.passwordHash).toMatch(/^scrypt\$/);
  });

  it("seeding runs no scrypt", async () => {
    const fresh = await createTestDb();
    h.scryptCalls = 0;
    await seedDemo(fresh);
    expect(h.scryptCalls).toBe(0);
    // The spy itself works: a password check runs scrypt.
    await signInWithPassword(fresh, ADMIN.email, ADMIN.password);
    expect(h.scryptCalls).toBeGreaterThan(0);
  });

  it("the owner and the admin sign in with their passwords", async () => {
    const o = await signInWithPassword(db, OWNER.email, OWNER.password);
    expect(o.ok).toBe(true);
    if (o.ok) expect((await getSessionUser(db, o.sessionToken))?.role).toBe("owner");
    const a = await signInWithPassword(db, ADMIN.email, ADMIN.password);
    expect(a.ok).toBe(true);
    if (a.ok) expect(await getSessionUser(db, a.sessionToken)).toMatchObject({ role: "admin", companyId: seed.companyId });
  });

  it("trims and lowercases the email", async () => {
    expect((await signInWithPassword(db, "  Admin@Demo.TEST ", ADMIN.password)).ok).toBe(true);
  });
});

describe("signInWithPassword", () => {
  it("returns the same invalid for an unknown email and a wrong password, checking a decoy hash for the unknown one", async () => {
    expect(await signInWithPassword(db, ADMIN.email, "wrong-password-1")).toEqual({ ok: false, error: "invalid" });
    vi.mocked(pin.verifySecret).mockClear();
    expect(await signInWithPassword(db, "nobody@demo.test", ADMIN.password)).toEqual({ ok: false, error: "invalid" });
    expect(vi.mocked(pin.verifySecret)).toHaveBeenCalledTimes(1);
  });

  it("refuses a PIN user on the password path (Ahmed → invalid), without touching his counter", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    vi.mocked(pin.verifySecret).mockClear();
    expect(await signInWithPassword(db, "ahmed", "482915")).toEqual({ ok: false, error: "invalid" });
    expect(vi.mocked(pin.verifySecret)).toHaveBeenCalledTimes(1); // the decoy
    expect((await userRow("ahmed")).failedAttempts).toBe(0);
  });

  it("refuses the admin on the PIN path (admin password through signIn → invalid)", async () => {
    expect(await signIn(db, ADMIN.email, ADMIN.password)).toEqual({ ok: false, error: "invalid" });
    expect(await signIn(db, "demo-admin", ADMIN.password)).toEqual({ ok: false, error: "invalid" });
    expect((await userRow(seed.adminId)).failedAttempts).toBe(0);
  });

  it("refuses an inactive admin", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, seed.adminId));
    expect(await signInWithPassword(db, ADMIN.email, ADMIN.password)).toEqual({ ok: false, error: "invalid" });
  });

  it("locks after five wrong passwords; the right one is then locked and issues no session", async () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      expect(await signInWithPassword(db, ADMIN.email, `wrong-password-${i}`, t0)).toEqual({ ok: false, error: "invalid" });
    }
    const before = await sessionCount(seed.adminId);
    expect(await signInWithPassword(db, ADMIN.email, ADMIN.password, t0)).toEqual({ ok: false, error: "locked" });
    expect(await sessionCount(seed.adminId)).toBe(before);
    const t2 = new Date(t0.getTime() + 16 * 60_000);
    expect((await signInWithPassword(db, ADMIN.email, ADMIN.password, t2)).ok).toBe(true);
  });
});

describe("attemptWithLockout", () => {
  it("runs at most five checks under ten parallel attempts, then the right password is locked (Review Focus 5)", async () => {
    let checks = 0;
    const check = async () => {
      checks++;
      await new Promise((r) => setTimeout(r, 5));
      return false;
    };
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 10 }, () => attemptWithLockout(db, seed.adminId, check, now)));
    expect(checks).toBeLessThanOrEqual(5);
    expect(results.filter((r) => r === "ok")).toHaveLength(0);
    expect(results.filter((r) => r === "locked").length).toBeGreaterThanOrEqual(5);
    expect((await userRow(seed.adminId)).lockedUntil).not.toBeNull();
    const before = await sessionCount(seed.adminId);
    expect(await signInWithPassword(db, ADMIN.email, ADMIN.password, now)).toEqual({ ok: false, error: "locked" });
    expect(await sessionCount(seed.adminId)).toBe(before);
  });

  it("returns ok for a passing check and clears the counter and failed_at", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    expect(await attemptWithLockout(db, seed.adminId, async () => false, now)).toBe("invalid");
    const mid = await userRow(seed.adminId);
    expect(mid.failedAttempts).toBe(1);
    expect(mid.failedAt?.getTime()).toBe(now.getTime());
    expect(await attemptWithLockout(db, seed.adminId, async () => true, now)).toBe("ok");
    const after = await userRow(seed.adminId);
    expect(after.failedAttempts).toBe(0);
    expect(after.failedAt).toBeNull();
  });
});

describe("isStrongPassword", () => {
  it("needs 10 to 128 characters with at least 5 distinct ones", () => {
    expect(isStrongPassword("aaaaaaaaaa")).toBe(false);
    expect(isStrongPassword("pilot-2026!")).toBe(true);
    expect(isStrongPassword("abcd-2026")).toBe(false); // 9 characters
    expect(isStrongPassword("ababababab")).toBe(false); // 2 distinct
    expect(isStrongPassword("abcdeabcde")).toBe(true);
    expect(isStrongPassword("abcde".repeat(25) + "abc")).toBe(true); // 128
    expect(isStrongPassword("abcde".repeat(25) + "abcd")).toBe(false); // 129
  });
});

describe("secret hashes", () => {
  it("writes scrypt$16384$8$1$<salt>$<key>", async () => {
    const hash = await hashSecret("pilot-2026!");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifySecret("pilot-2026!", hash)).toBe(true);
    expect(await verifySecret("pilot-2026?", hash)).toBe(false);
  });

  it("still accepts a plan-1 salt:key hash", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("482915", salt, 32);
    const legacy = `${salt.toString("hex")}:${key.toString("hex")}`;
    expect(await verifySecret("482915", legacy)).toBe(true);
    expect(await verifySecret("482916", legacy)).toBe(false);
  });

  it("verifies a hash made at N=2^17 (C3), and new hashes still use 2^14", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("pilot-2026!", salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 131072 * 8 });
    const hash = ["scrypt", 131072, 8, 1, salt.toString("hex"), key.toString("hex")].join("$");
    expect(await verifySecret("pilot-2026!", hash)).toBe(true);
    expect(await verifySecret("pilot-2026?", hash)).toBe(false);
    expect(await hashSecret("x-y-z-1-2-3")).toMatch(/^scrypt\$16384\$/);
  });

  it("still refuses a cost above 2^20", async () => {
    expect(await verifySecret("x", "scrypt$2097152$8$1$00$00")).toBe(false);
  });

  it("rejects malformed hashes", async () => {
    for (const bad of ["", "scrypt$1$8$1$00$00", "scrypt$16384$8$1$zz$zz", "abc", "scrypt$99999999$8$1$00$00"]) {
      expect(await verifySecret("x", bad)).toBe(false);
    }
  });
});

describe("admin invites", () => {
  it("accepts an admin invite: sets the password, voids other invites and sessions in one go", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const token = await createInvite(db, seed.adminId, now);
    const other = await createInvite(db, seed.adminId, now);
    const oldSession = await createSession(db, seed.adminId, now);
    expect(await peekAdminInvite(db, token, now)).toEqual({ name: expect.any(String), login: ADMIN.email });

    const r = await acceptAdminInvite(db, token, "pilot-2026!", now);
    expect(r).toMatchObject({ ok: true, login: ADMIN.email });
    if (!r.ok) return;
    expect(await getSessionUser(db, r.sessionToken, now)).toMatchObject({ role: "admin" });
    expect(await getSessionUser(db, oldSession, now)).toBeNull();
    expect(await acceptAdminInvite(db, other, "pilot-2027!", now)).toEqual({ ok: false, error: "used" });
    expect((await signInWithPassword(db, ADMIN.email, "pilot-2026!", now)).ok).toBe(true);
    expect(await signInWithPassword(db, ADMIN.email, ADMIN.password, now)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a weak password without using up the invite", async () => {
    const token = await createInvite(db, seed.adminId);
    expect(await acceptAdminInvite(db, token, "aaaaaaaaaa")).toEqual({ ok: false, error: "weak_password" });
    expect((await acceptAdminInvite(db, token, "pilot-2026!")).ok).toBe(true);
  });

  it("refuses a rep's invite on the admin route (invalid), leaving it usable", async () => {
    expect(await peekAdminInvite(db, seed.inviteToken)).toBeNull();
    expect(await acceptAdminInvite(db, seed.inviteToken, "pilot-2026!")).toEqual({ ok: false, error: "invalid" });
    expect((await userRow("ahmed")).passwordHash).toBeNull();
    expect((await acceptInvite(db, seed.inviteToken, "482915")).ok).toBe(true);
  });

  it("refuses an admin's invite on the rep route (invalid), leaving it usable", async () => {
    const token = await createInvite(db, seed.adminId);
    expect(await peekInvite(db, token)).toBeNull();
    expect(await acceptInvite(db, token, "482915")).toEqual({ ok: false, error: "invalid" });
    expect((await userRow(seed.adminId)).pinHash).toBeNull();
    expect((await acceptAdminInvite(db, token, "pilot-2026!")).ok).toBe(true);
  });

  it("refuses an owner's invite on the rep route and accepts it on the admin route", async () => {
    const token = await createInvite(db, seed.ownerId);
    expect(await acceptInvite(db, token, "482915")).toEqual({ ok: false, error: "invalid" });
    expect((await acceptAdminInvite(db, token, "pilot-2026!")).ok).toBe(true);
  });

  it("peekAdminInvite returns null for expired and used invites", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const token = await createInvite(db, seed.adminId, now);
    expect(await peekAdminInvite(db, token, new Date(now.getTime() + 8 * 86_400_000))).toBeNull();
    await acceptAdminInvite(db, token, "pilot-2026!", now);
    expect(await peekAdminInvite(db, token, now)).toBeNull();
  });
});

describe("roles", () => {
  const ctx = (role: "rep" | "supervisor" | "admin" | "owner") => ({
    db,
    companyId: "demo-co",
    userId: "u",
    role,
    locale: "ar" as const,
    timeZone: "Asia/Riyadh",
  });

  it("assertRole throws Forbidden outside the allowed roles", () => {
    expect(() => assertRole(ctx("admin"), ["admin"])).not.toThrow();
    expect(() => assertRole(ctx("rep"), ["admin"])).toThrow(Forbidden);
    expect(() => assertRole(ctx("owner"), ["admin"])).toThrow(Forbidden);
    expect(() => assertRole(ctx("admin"), ["rep", "supervisor"])).toThrow(Forbidden);
  });

  it("homeFor sends reps and supervisors to /app, admins and owners to /admin", () => {
    expect(homeFor("rep")).toBe("/app");
    expect(homeFor("supervisor")).toBe("/app");
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor("owner")).toBe("/admin");
  });
});

describe("signInPathFor", () => {
  it("sends PIN roles to /signin and password roles to /admin/signin", () => {
    expect(signInPathFor(["rep"])).toBe("/signin");
    expect(signInPathFor(["supervisor"])).toBe("/signin");
    expect(signInPathFor(["rep", "supervisor"])).toBe("/signin");
    expect(signInPathFor(["admin"])).toBe("/admin/signin");
    expect(signInPathFor(["owner"])).toBe("/admin/signin");
    expect(signInPathFor(["admin", "owner"])).toBe("/admin/signin");
  });

  it("requireRole(['supervisor']) sends a signed-out visitor to the PIN sign-in", async () => {
    expect(await redirectOf(requireRole(["supervisor"]))).toBe("/signin");
  });
});

describe("decoy hash", () => {
  it("is precomputed: the first unknown login in a fresh module costs one scrypt run, not two", async () => {
    vi.resetModules();
    const fresh = await import("./sessions");
    const before = h.scryptCalls;
    expect(await fresh.signInWithPassword(db, "nobody@demo.test", "whatever-password")).toEqual({ ok: false, error: "invalid" });
    expect(h.scryptCalls - before).toBe(1);
  });
});

describe("requireRole and the server actions (Review Focus 5, R10)", () => {
  const signInAs = async (userId: string) => {
    h.jar.set("session", { value: await createSession(db, userId) });
  };

  it("sends a visitor without a session to the right sign-in page", async () => {
    expect(await redirectOf(requireRole(["rep", "supervisor"]))).toBe("/signin");
    expect(await redirectOf(requireRole(["admin"]))).toBe("/admin/signin");
    expect(await redirectOf(requireRole(["owner"]))).toBe("/admin/signin");
  });

  it("sends a wrong role home and lets the right one through", async () => {
    await signInAs(seed.adminId);
    expect(await redirectOf(requireRole(["rep", "supervisor"]))).toBe("/admin");
    expect((await requireRole(["admin"])).userId).toBe(seed.adminId);
    await signInAs("ahmed");
    expect(await redirectOf(requireRole(["admin"]))).toBe("/app");
    expect((await requireRole(["rep", "supervisor"])).userId).toBe("ahmed");
  });

  it("refuses the rep's save-close action posted by an admin or an owner session; nothing is written", async () => {
    for (const userId of [seed.adminId, seed.ownerId]) {
      await signInAs(userId);
      const data = form({ date: "2026-11-14", "line.bev": "10", "line.food": "100", "line.coll": "100" });
      expect(await redirectOf(saveCloseAction({ errors: {} }, data))).toBe("/admin");
      expect(await db.select().from(s.dailyCloses).where(eq(s.dailyCloses.userId, userId))).toHaveLength(0);
    }
  });

  it("refuses the rep's language action posted by an admin session", async () => {
    await signInAs(seed.adminId);
    expect(await redirectOf(setLocaleAction(form({ locale: "en" })))).toBe("/admin");
    expect((await userRow(seed.adminId)).locale).toBe("ar");
  });

  it("the rep sign-out does not end an admin session, and the admin sign-out does not end a rep session", async () => {
    await signInAs(seed.adminId);
    const adminToken = h.jar.get("session")!.value;
    expect(await redirectOf(signOutAction())).toBe("/admin");
    expect(await getSessionUser(db, adminToken)).not.toBeNull();
    expect(await redirectOf(adminSignOutAction())).toBe("/admin/signin");
    expect(await getSessionUser(db, adminToken)).toBeNull();
    expect(h.jar.has("session")).toBe(false);

    await signInAs("ahmed");
    const repToken = h.jar.get("session")!.value;
    expect(await redirectOf(adminSignOutAction())).toBe("/app");
    expect(await getSessionUser(db, repToken)).not.toBeNull();
    expect(await redirectOf(signOutAction())).toBe("/signin");
    expect(await getSessionUser(db, repToken)).toBeNull();
  });

  it("admin sign-in sets an http-only, secure-in-production session cookie and goes to /admin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await redirectOf(adminSignInAction({}, form({ email: " Admin@Demo.test ", password: ADMIN.password })))).toBe(
      "/admin",
    );
    const cookie = h.jar.get("session")!;
    expect(cookie.opts).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
    expect((await getSessionUser(db, cookie.value))?.role).toBe("admin");
  });

  it("admin sign-in refuses a rep's credentials and returns locked once locked", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    expect(await adminSignInAction({}, form({ email: "ahmed", password: "482915" }))).toEqual({ error: "invalid" });
    for (let i = 0; i < 5; i++) await adminSignInAction({}, form({ email: ADMIN.email, password: `nope-${i}-xxxxx` }));
    expect(await adminSignInAction({}, form({ email: ADMIN.email, password: ADMIN.password }))).toEqual({ error: "locked" });
    expect(h.jar.has("session")).toBe(false);
  });

  it("the rep sign-in refuses the admin's credentials", async () => {
    expect(await signInAction({}, form({ login: ADMIN.email, pin: ADMIN.password }))).toEqual({ error: "invalid" });
  });

  it("the rep sign-in sets a secure last_login cookie in production", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    vi.stubEnv("NODE_ENV", "production");
    expect(await redirectOf(signInAction({}, form({ login: "ahmed", pin: "482915" })))).toBe("/app");
    expect(h.jar.get("last_login")?.opts).toMatchObject({ secure: true });
    expect(h.jar.get("session")?.opts).toMatchObject({ secure: true, httpOnly: true });
  });

  it("the admin invite action checks the confirmation, the password strength and the invite's audience", async () => {
    const token = await createInvite(db, seed.adminId);
    expect(await acceptAdminInviteAction({}, form({ token, password: "pilot-2026!", confirm: "pilot-2026?" }))).toEqual({
      error: "mismatch",
    });
    expect(await acceptAdminInviteAction({}, form({ token, password: "aaaaaaaaaa", confirm: "aaaaaaaaaa" }))).toEqual({
      error: "weak_password",
    });
    expect(
      await acceptAdminInviteAction({}, form({ token: seed.inviteToken, password: "pilot-2026!", confirm: "pilot-2026!" })),
    ).toEqual({ error: "invite_invalid" });
    expect(await redirectOf(acceptAdminInviteAction({}, form({ token, password: "pilot-2026!", confirm: "pilot-2026!" })))).toBe(
      "/admin",
    );
    expect((await getSessionUser(db, h.jar.get("session")!.value))?.userId).toBe(seed.adminId);
  });

  it("the rep invite action refuses an admin's invite", async () => {
    const token = await createInvite(db, seed.adminId);
    expect(await acceptInviteAction({}, form({ token, pin: "482915", confirm: "482915" }))).toEqual({
      error: "invite_invalid",
    });
  });
});

describe("sessions at the expiry instant", () => {
  it("a session whose expires_at equals now is neither returned nor renewed", async () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    const token = await createSession(db, seed.adminId, t0);
    const at = new Date(t0.getTime() + ADMIN_SESSION_TTL_MS);
    expect(await getSessionUser(db, token, at)).toBeNull();
    const [row] = await db.select().from(s.sessions).where(and(eq(s.sessions.userId, seed.adminId)));
    expect(row!.expiresAt.getTime()).toBe(at.getTime());
  });
});

describe("R24: session lifetime by role", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const t0 = new Date("2026-11-14T10:00:00Z");
  const expiryOf = async (userId: string) =>
    (await db.select().from(s.sessions).where(eq(s.sessions.userId, userId)))[0]!.expiresAt.getTime();

  it("an admin session lasts 7 days, a rep session 90", async () => {
    const adminToken = await createSession(db, seed.adminId, t0);
    const repToken = await createSession(db, seed.repId, t0);
    expect(await expiryOf(seed.adminId)).toBe(t0.getTime() + 7 * DAY);
    expect(await expiryOf(seed.repId)).toBe(t0.getTime() + 90 * DAY);
    expect(await getSessionUser(db, adminToken, new Date(t0.getTime() + 7 * DAY))).toBeNull();
    expect(await getSessionUser(db, repToken, new Date(t0.getTime() + 7 * DAY))).not.toBeNull();
    expect(await getSessionUser(db, repToken, new Date(t0.getTime() + 90 * DAY))).toBeNull();
  });

  it("the owner is a password role too", async () => {
    await createSession(db, seed.ownerId, t0);
    expect(await expiryOf(seed.ownerId)).toBe(t0.getTime() + 7 * DAY);
  });

  it("an admin session slides: used after 4 days it is renewed to 7 days from then", async () => {
    const token = await createSession(db, seed.adminId, t0);
    const day2 = new Date(t0.getTime() + 2 * DAY);
    await getSessionUser(db, token, day2); // 5 days left of 7: not yet renewed
    expect(await expiryOf(seed.adminId)).toBe(t0.getTime() + 7 * DAY);
    const day4 = new Date(t0.getTime() + 4 * DAY);
    await getSessionUser(db, token, day4); // 3 days left, under half: renewed
    expect(await expiryOf(seed.adminId)).toBe(day4.getTime() + 7 * DAY);
  });

  it("the cookie lives 7 days for an admin and a year for a rep", () => {
    expect(sessionCookieMaxAgeS("admin")).toBe(ADMIN_SESSION_COOKIE_MAX_AGE_S);
    expect(sessionCookieMaxAgeS("owner")).toBe(7 * 24 * 60 * 60);
    expect(sessionCookieMaxAgeS("rep")).toBe(SESSION_COOKIE_MAX_AGE_S);
    expect(sessionCookieMaxAgeS("supervisor")).toBe(365 * 24 * 60 * 60);
  });
});

describe("security headers", () => {
  it("sends frame, sniffing and referrer headers on every path, the invite rules coming after (B13)", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const value = (k: string) => all.headers.find((h) => h.key === k)?.value;
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(rules.indexOf(all)).toBeLessThan(rules.findIndex((r) => r.source === "/invite/:path*"));
  });

  it("sends Referrer-Policy: no-referrer on /invite/* and /admin/invite/*", async () => {
    const rules = await nextConfig.headers!();
    const policyFor = (source: string) =>
      rules.find((r) => r.source === source)?.headers.find((x) => x.key === "Referrer-Policy")?.value;
    expect(policyFor("/invite/:path*")).toBe("no-referrer");
    expect(policyFor("/admin/invite/:path*")).toBe("no-referrer");
  });
});
