import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import * as pin from "./pin";
import { hashSecret, verifySecret } from "./pin";
import { acceptInvite, createInvite, peekInvite } from "./invites";
import { createSession, destroySession, getSessionUser, signIn } from "./sessions";

vi.mock("./pin", async (orig) => {
  const actual = await orig<typeof import("./pin")>();
  return { ...actual, verifySecret: vi.fn(actual.verifySecret) };
});

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

describe("secrets", () => {
  it("verifies a secret and salts every hash", async () => {
    const a = await hashSecret("482915");
    const b = await hashSecret("482915");
    expect(await verifySecret("482915", a)).toBe(true);
    expect(await verifySecret("482916", a)).toBe(false);
    expect(a).not.toBe(b);
  });
});

describe("acceptInvite", () => {
  it("accepts the seeded invite and opens a session for Ahmed", async () => {
    const r = await acceptInvite(db, seed.inviteToken, "482915");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ctx = await getSessionUser(db, r.sessionToken);
    expect(ctx).toMatchObject({
      userId: "ahmed",
      companyId: seed.companyId,
      role: "rep",
      locale: "ar",
      timeZone: "Asia/Riyadh",
    });
  });

  it("refuses the same invite twice", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    expect(await acceptInvite(db, seed.inviteToken, "739104")).toEqual({ ok: false, error: "used" });
  });

  it("rejects weak PINs without using up the invite", async () => {
    for (const pin of ["111111", "123456", "12345", "1234567", "12345a"]) {
      expect(await acceptInvite(db, seed.inviteToken, pin)).toEqual({ ok: false, error: "weak_pin" });
    }
    expect((await acceptInvite(db, seed.inviteToken, "482915")).ok).toBe(true);
  });

  it("shows the rep's name and login before the invite is used", async () => {
    expect(await peekInvite(db, seed.inviteToken)).toEqual({ name: "أحمد", login: "ahmed" });
    expect(await peekInvite(db, "nope")).toBeNull();
  });

  it("peekInvite returns null for an expired invite and for a used invite (plan-1 regression)", async () => {
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await peekInvite(db, seed.inviteToken, later)).toBeNull();
    expect(await peekInvite(db, seed.inviteToken)).not.toBeNull();
    await acceptInvite(db, seed.inviteToken, "482915");
    expect(await peekInvite(db, seed.inviteToken)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await acceptInvite(db, "not-a-real-token", "482915")).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects an expired invite", async () => {
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await acceptInvite(db, seed.inviteToken, "482915", later)).toEqual({ ok: false, error: "expired" });
  });

  it("stores the invite token hashed and expiring in 7 days", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const token = await createInvite(db, "ahmed", now);
    const rows = await db.select().from(s.invites).where(eq(s.invites.userId, "ahmed"));
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    const row = rows.find((r) => r.expiresAt.getTime() === now.getTime() + 7 * 86_400_000);
    expect(row).toBeDefined();
    expect((await acceptInvite(db, token, "482915", now)).ok).toBe(true);
  });
});

describe("signIn", () => {
  beforeEach(async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
  });

  it("signs in with the right PIN", async () => {
    expect((await signIn(db, "ahmed", "482915")).ok).toBe(true);
  });

  it("returns invalid for a wrong PIN and for an unknown login alike", async () => {
    expect(await signIn(db, "ahmed", "000000")).toEqual({ ok: false, error: "invalid" });
    expect(await signIn(db, "nobody", "482915")).toEqual({ ok: false, error: "invalid" });
  });

  it("locks after five wrong PINs, even for the right one, then unlocks after 15 minutes", async () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    for (let i = 0; i < 5; i++) await signIn(db, "ahmed", "000000", t0);
    expect(await signIn(db, "ahmed", "482915", t0)).toEqual({ ok: false, error: "locked" });
    const t1 = new Date(t0.getTime() + 14 * 60_000);
    expect(await signIn(db, "ahmed", "482915", t1)).toEqual({ ok: false, error: "locked" });
    const t2 = new Date(t0.getTime() + 16 * 60_000);
    expect((await signIn(db, "ahmed", "482915", t2)).ok).toBe(true);
  });

  it("resets the failure counter on success", async () => {
    for (let i = 0; i < 4; i++) await signIn(db, "ahmed", "000000");
    expect((await signIn(db, "ahmed", "482915")).ok).toBe(true);
    for (let i = 0; i < 4; i++) await signIn(db, "ahmed", "000000");
    expect((await signIn(db, "ahmed", "482915")).ok).toBe(true);
  });
});

describe("sessions", () => {
  it("stops working once destroyed", async () => {
    const token = await createSession(db, "ahmed");
    expect(await getSessionUser(db, token)).not.toBeNull();
    await destroySession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it("expires after 90 days and is stored hashed", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const token = await createSession(db, "ahmed", now);
    const rows = await db.select().from(s.sessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    expect(await getSessionUser(db, token, new Date(now.getTime() + 89 * 86_400_000))).not.toBeNull();
    const other = await createSession(db, "ahmed", now);
    expect(await getSessionUser(db, other, new Date(now.getTime() + 91 * 86_400_000))).toBeNull();
  });

  it("renews its expiry only once less than half the lifetime remains", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const token = await createSession(db, "ahmed", now);
    const expiry = async () => (await db.select().from(s.sessions).where(eq(s.sessions.userId, "ahmed")))[0]!.expiresAt;
    const first = await expiry();
    await getSessionUser(db, token, new Date(now.getTime() + 40 * 86_400_000)); // 50 days left: untouched
    expect((await expiry()).getTime()).toBe(first.getTime());
    const later = new Date(now.getTime() + 50 * 86_400_000); // 40 days left: renewed
    await getSessionUser(db, token, later);
    expect((await expiry()).getTime()).toBe(later.getTime() + 90 * 86_400_000);
    expect(await getSessionUser(db, token, new Date(now.getTime() + 130 * 86_400_000))).not.toBeNull();
  });

  it("rejects unknown tokens", async () => {
    expect(await getSessionUser(db, "nope")).toBeNull();
  });
});

describe("lockout under concurrency", () => {
  beforeEach(async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    vi.mocked(pin.verifySecret).mockClear();
  });

  it("checks at most five PINs in a burst and never signs in once locked", async () => {
    const pins = ["000001", "000002", "000003", "000004", "000005", "000006", "000007", "482915", "000009", "000010"];
    const results = await Promise.all(pins.map((p) => signIn(db, "ahmed", p)));
    expect(vi.mocked(pin.verifySecret).mock.calls.length).toBeLessThanOrEqual(5);
    expect(results.every((r) => !r.ok)).toBe(true);
    const [user] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(user!.lockedUntil).not.toBeNull();
    const sessions = await db.select().from(s.sessions).where(eq(s.sessions.userId, "ahmed"));
    expect(sessions.length).toBe(1); // only the one from accepting the invite
    expect(await signIn(db, "ahmed", "482915")).toEqual({ ok: false, error: "locked" });
  });

  it("does not let a correct PIN clear an existing lock", async () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    for (let i = 0; i < 5; i++) await signIn(db, "ahmed", "000000", t0);
    const [a, b] = await Promise.all([signIn(db, "ahmed", "482915", t0), signIn(db, "ahmed", "482915", t0)]);
    expect(a).toEqual({ ok: false, error: "locked" });
    expect(b).toEqual({ ok: false, error: "locked" });
    const [user] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(user!.lockedUntil).not.toBeNull();
  });
});

describe("a counter stuck at the limit", () => {
  beforeEach(async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
  });
  const t0 = new Date("2026-11-14T10:00:00Z");
  // Recovery reads failed_at (written by every reservation); updated_at is "now" so that an
  // unrelated edit to the user (an admin renaming him) cannot delay or speed up recovery.
  const stick = (minutesAgo: number, updatedAt: Date = t0) =>
    db
      .update(s.users)
      .set({ failedAttempts: 5, lockedUntil: null, failedAt: new Date(t0.getTime() - minutesAgo * 60_000), updatedAt })
      .where(eq(s.users.id, "ahmed"));

  it("lets the right PIN in once the lock window has passed (failed_at 16 minutes ago, updated_at now)", async () => {
    await stick(16);
    const r = await signIn(db, "ahmed", "482915", t0);
    expect(r.ok).toBe(true);
    const [user] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(user!.failedAttempts).toBe(0);
  });

  it("stays locked inside the window (5 minutes)", async () => {
    await stick(5);
    expect(await signIn(db, "ahmed", "482915", t0)).toEqual({ ok: false, error: "locked" });
  });

  it("stays locked when failed_at is recent even if updated_at is old", async () => {
    await stick(5, new Date(t0.getTime() - 60 * 60_000));
    expect(await signIn(db, "ahmed", "482915", t0)).toEqual({ ok: false, error: "locked" });
  });

  it("records failed_at on every reservation and clears it on success", async () => {
    await signIn(db, "ahmed", "000000", t0);
    const [after] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(after!.failedAt?.getTime()).toBe(t0.getTime());
    await signIn(db, "ahmed", "482915", t0);
    const [cleared] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(cleared!.failedAt).toBeNull();
    expect(cleared!.failedAttempts).toBe(0);
  });

  it("restarts the count at 1 after a wrong PIN past the window", async () => {
    await stick(16);
    expect(await signIn(db, "ahmed", "000000", t0)).toEqual({ ok: false, error: "invalid" });
    const [user] = await db.select().from(s.users).where(eq(s.users.id, "ahmed"));
    expect(user!.failedAttempts).toBe(1);
  });

  it("refuses a reserved correct PIN when parallel failures set a lock meanwhile", async () => {
    vi.mocked(pin.verifySecret).mockImplementationOnce(async () => {
      await db
        .update(s.users)
        .set({ failedAttempts: 0, lockedUntil: new Date(t0.getTime() + 15 * 60_000) })
        .where(eq(s.users.id, "ahmed"));
      return true;
    });
    const before = (await db.select().from(s.sessions).where(eq(s.sessions.userId, "ahmed"))).length;
    expect(await signIn(db, "ahmed", "482915", t0)).toEqual({ ok: false, error: "locked" });
    const after = (await db.select().from(s.sessions).where(eq(s.sessions.userId, "ahmed"))).length;
    expect(after).toBe(before);
  });
});

describe("invite acceptance side effects", () => {
  it("voids the user's other invites and existing sessions", async () => {
    const other = await createInvite(db, "ahmed");
    const oldSession = await createSession(db, "ahmed");
    expect((await acceptInvite(db, seed.inviteToken, "482915")).ok).toBe(true);
    expect(await getSessionUser(db, oldSession)).toBeNull();
    expect(await acceptInvite(db, other, "739104")).toEqual({ ok: false, error: "used" });
  });

  it("leaves the invite unused if the flow fails midway", async () => {
    const real = db.transaction.bind(db);
    // Make the session insert fail by removing the users row's FK target mid-way: simulate via a broken db.
    const broken = Object.create(db) as Db;
    broken.transaction = (async (fn: (tx: never) => Promise<unknown>) =>
      real(async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, prop, recv) {
            if (prop === "insert") throw new Error("boom");
            return Reflect.get(target, prop, recv);
          },
        });
        return fn(proxy as never);
      })) as never;
    await expect(acceptInvite(broken, seed.inviteToken, "482915")).rejects.toThrow("boom");
    expect((await acceptInvite(db, seed.inviteToken, "482915")).ok).toBe(true);
  });
});

describe("input normalisation", () => {
  it("signs in with a capitalised, padded login", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    expect((await signIn(db, " Ahmed ", "482915")).ok).toBe(true);
  });

  it("treats Arabic-Indic and Persian digits as Western digits", async () => {
    expect((await acceptInvite(db, seed.inviteToken, "٤٨٢٩١٥")).ok).toBe(true);
    expect((await signIn(db, "ahmed", "482915")).ok).toBe(true);
    expect((await signIn(db, "ahmed", "۴۸۲۹۱۵")).ok).toBe(true);
  });

  it("accepts a Western PIN then signs in with Arabic-Indic digits", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    expect((await signIn(db, "ahmed", "٤٨٢٩١٥")).ok).toBe(true);
  });

  it("still rejects weak PINs typed in Arabic-Indic digits", async () => {
    expect(await acceptInvite(db, seed.inviteToken, "١١١١١١")).toEqual({ ok: false, error: "weak_pin" });
  });
});

describe("inactive users", () => {
  it("cannot sign in and their sessions stop working", async () => {
    await acceptInvite(db, seed.inviteToken, "482915");
    const token = await createSession(db, "ahmed");
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "ahmed"));
    expect(await signIn(db, "ahmed", "482915")).toEqual({ ok: false, error: "invalid" });
    expect(await getSessionUser(db, token)).toBeNull();
  });
});
