import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "@/db/testing";
import { migratePglite } from "@/db/migrate";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { acceptAdminInvite, peekAdminInvite } from "@/server/auth/invites";
import { signInWithPassword } from "@/server/auth/sessions";
import { OWNER_CREATION_LOCK_KEY, createOwner } from "./bootstrap";
import {
  SETUP_FAIL_DELAY_MS,
  SETUP_LOCK_MS,
  SETUP_MAX_FAILURES,
  configuredSetupToken,
  isSetupOpen,
  setupFirstOwner,
  validOwnerName,
} from "./setup";
import { createFirstOwner } from "@/app/setup/actions";
import SetupPage from "@/app/setup/page";
import nextConfig from "../../../next.config";

const h = vi.hoisted(() => {
  class NotFound extends Error {
    constructor() {
      super("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  }
  return { NotFound, db: undefined as unknown };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new h.NotFound();
  },
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns?: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/db/client", () => ({ getDb: async () => h.db }));

const TOKEN = "t".repeat(20) + "0123456789abcdef"; // 36 characters
const ENV = { SETUP_TOKEN: TOKEN };
const NOW = new Date("2026-11-26T10:00:00Z");
const OWNER = { email: "Boss@Example.COM ", name: "  Owner Name " };
const noSleep = async () => {};

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  h.db = db;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function owners() {
  return db.select().from(s.users).where(eq(s.users.role, "owner"));
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Records, in order, the execute (as JSON) and select calls made inside db.transaction. */
function recordTransactionStatements(): string[] {
  const statements: string[] = [];
  const origTx = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(((fn: (tx: Db) => Promise<unknown>) =>
    origTx(async (tx) => {
      const exec = tx.execute.bind(tx);
      const select = tx.select.bind(tx);
      (tx as unknown as { execute: typeof exec }).execute = ((q: Parameters<typeof exec>[0]) => {
        statements.push(JSON.stringify(q));
        return exec(q);
      }) as typeof exec;
      (tx as unknown as { select: typeof select }).select = ((...a: Parameters<typeof select>) => {
        statements.push("select");
        return select(...a);
      }) as typeof select;
      return fn(tx as unknown as Db);
    })) as never);
  return statements;
}

const run = (token: string, now = NOW, env: Record<string, string | undefined> = ENV) =>
  setupFirstOwner(db, { token, ...OWNER }, { env, now, sleep: noSleep });

describe("configuredSetupToken", () => {
  it("is off when unset, empty or shorter than 32 characters", () => {
    expect(configuredSetupToken({})).toBeNull();
    expect(configuredSetupToken({ SETUP_TOKEN: "" })).toBeNull();
    expect(configuredSetupToken({ SETUP_TOKEN: "x".repeat(31) })).toBeNull();
    expect(configuredSetupToken({ SETUP_TOKEN: `  ${"x".repeat(31)}  ` })).toBeNull();
  });
  it("is on from 32 characters, trimmed", () => {
    expect(configuredSetupToken({ SETUP_TOKEN: "x".repeat(32) })).toBe("x".repeat(32));
    expect(configuredSetupToken({ SETUP_TOKEN: ` ${TOKEN}\n` })).toBe(TOKEN);
  });
});

describe("isSetupOpen", () => {
  it("is closed while the token is off or short", async () => {
    expect(await isSetupOpen(db, {})).toBe(false);
    expect(await isSetupOpen(db, { SETUP_TOKEN: "short-token" })).toBe(false);
    expect(await isSetupOpen(db, ENV)).toBe(true);
  });
  it("is closed once any owner exists, even an inactive one", async () => {
    await createOwner(db, { email: "x@y.test", name: "X" });
    await db.update(s.users).set({ active: false }).where(eq(s.users.role, "owner"));
    expect(await isSetupOpen(db, ENV)).toBe(false);
  });
});

describe("validOwnerName", () => {
  it("takes 1 to 100 plain characters, trimmed", () => {
    expect(validOwnerName("  عبدالله  ")).toBe("عبدالله");
    expect(validOwnerName("a".repeat(100))).toBe("a".repeat(100));
    expect(validOwnerName("a".repeat(101))).toBeNull();
    expect(validOwnerName("   ")).toBeNull();
  });
  it("refuses control and bidi characters", () => {
    for (const bad of ["a\u0000b", "a\nb", "a\u202Eb", "a\u2066b", "a\u200Fb", "a\u061Cb", "a\u2028b"]) {
      expect(validOwnerName(bad)).toBeNull();
    }
  });
});

describe("setupFirstOwner", () => {
  it("is closed while the token is off or short, and creates nothing", async () => {
    expect(await run(TOKEN, NOW, {})).toEqual({ status: "closed" });
    expect(await run("x".repeat(31), NOW, { SETUP_TOKEN: "x".repeat(31) })).toEqual({ status: "closed" });
    expect(await owners()).toHaveLength(0);
  });

  it("is closed once an owner exists (the demo seed has one)", async () => {
    await seedDemo(db);
    expect(await run(TOKEN)).toEqual({ status: "closed" });
  });

  it("creates the owner and an invite that sets his password and signs him in", async () => {
    const r = await run(` ${TOKEN} `);
    expect(r.status).toBe("created");
    if (r.status !== "created") return;
    expect(r.invitePath).toMatch(/^\/admin\/invite\/[A-Za-z0-9_-]{43}$/);
    const [owner] = await owners();
    expect(owner).toMatchObject({ login: "boss@example.com", name: "Owner Name", companyId: "platform", passwordHash: null });
    const token = r.invitePath.split("/").pop()!;
    // Only the hash is stored.
    const invites = await db.select().from(s.invites).where(eq(s.invites.userId, owner!.id));
    expect(invites).toHaveLength(1);
    expect(invites[0]!.tokenHash).not.toContain(token);
    expect(await peekAdminInvite(db, token)).toEqual({ name: "Owner Name", login: "boss@example.com" });
    const accepted = await acceptAdminInvite(db, token, "owner-pass-2026");
    expect(accepted.ok).toBe(true);
    const signedIn = await signInWithPassword(db, "boss@example.com", "owner-pass-2026");
    expect(signedIn.ok).toBe(true);
    // The page is gone for good, even with the token still set.
    expect(await run(TOKEN)).toEqual({ status: "closed" });
    expect(await isSetupOpen(db, ENV)).toBe(false);
  });

  it("refuses a bad email or name before it looks at the token", async () => {
    const opts = { env: ENV, now: NOW, sleep: noSleep };
    for (const email of ["", "no-at-sign", "a@b", "a b@c.de", `${"a".repeat(65)}@x.test`, `a@${"b".repeat(250)}.test`, "a\u202E@x.test"]) {
      expect(await setupFirstOwner(db, { token: TOKEN, email, name: "N" }, opts)).toEqual({ status: "invalid", field: "email" });
    }
    expect(await setupFirstOwner(db, { token: TOKEN, email: "a@b.test", name: "a\u202Eb" }, opts)).toEqual({
      status: "invalid",
      field: "name",
    });
    expect(await owners()).toHaveLength(0);
    const [row] = await db.select().from(s.setupAttempts);
    expect(row!.failures).toBe(0);
  });

  it("maps a taken email to the generic refusal", async () => {
    await db.insert(s.companies).values({ id: "c1", name: "Co", sellingWeekdays: [6, 0, 1, 2, 3, 4] });
    await db.insert(s.users).values({ id: "a1", companyId: "c1", role: "admin", name: "A", login: "boss@example.com" });
    expect(await run(TOKEN)).toEqual({ status: "refused" });
    expect(await owners()).toHaveLength(0);
  });

  it("answers a wrong token with the generic refusal after the delay", async () => {
    const sleep = vi.fn(async () => {});
    const r = await setupFirstOwner(db, { token: TOKEN.slice(0, -1) + "X", ...OWNER }, { env: ENV, now: NOW, sleep });
    expect(r).toEqual({ status: "refused" });
    expect(sleep).toHaveBeenCalledWith(SETUP_FAIL_DELAY_MS);
    expect(SETUP_FAIL_DELAY_MS).toBeGreaterThanOrEqual(900);
    expect(await owners()).toHaveLength(0);
  });

  it("locks after five wrong tries: even the right token is refused unchecked, until the window passes", async () => {
    expect(SETUP_MAX_FAILURES).toBe(5);
    expect(SETUP_LOCK_MS).toBe(15 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      expect(await run("wrong-token", new Date(NOW.getTime() + i * 60_000))).toEqual({ status: "refused" });
    }
    const sleep = vi.fn(async () => {});
    const at = new Date(NOW.getTime() + 5 * 60_000);
    expect(await setupFirstOwner(db, { token: TOKEN, ...OWNER }, { env: ENV, now: at, sleep })).toEqual({ status: "refused" });
    expect(sleep).toHaveBeenCalledWith(SETUP_FAIL_DELAY_MS);
    expect(await run(TOKEN, new Date(NOW.getTime() + 4 * 60_000 + SETUP_LOCK_MS - 1000))).toEqual({ status: "refused" });
    expect(await owners()).toHaveLength(0);
    // The fifth failure was at +4 min; the lock ends 15 minutes later.
    const r = await run(TOKEN, new Date(NOW.getTime() + 4 * 60_000 + SETUP_LOCK_MS));
    expect(r.status).toBe("created");
  });

  it("counts wrong tries in a 15-minute window: four, then four more after the window, do not lock", async () => {
    for (let i = 0; i < 4; i++) await run("wrong-token", NOW);
    const later = new Date(NOW.getTime() + SETUP_LOCK_MS + 1000);
    for (let i = 0; i < 4; i++) await run("wrong-token", later);
    expect((await run(TOKEN, later)).status).toBe("created");
  });

  it("lets at most five of many parallel wrong tries reach the comparison", async () => {
    await Promise.all(Array.from({ length: 12 }, () => run("wrong-token")));
    const [row] = await db.select().from(s.setupAttempts);
    expect(row!.lockedUntil).not.toBeNull();
    expect(await run(TOKEN)).toEqual({ status: "refused" });
  });

  it("never hands the driver a raw Date (postgres-js cannot serialize one in a raw sql parameter)", async () => {
    // PGlite accepts a Date where postgres-js (production) throws ERR_INVALID_ARG_TYPE, so record
    // every parameter the queries carry and require strings for times.
    const params: unknown[] = [];
    const logged = drizzle(new PGlite(), { schema: s, logger: { logQuery: (_q, p) => params.push(...p) } });
    await migratePglite(logged as never);
    const ldb = logged as unknown as Db;
    const go = (token: string, now: Date) => setupFirstOwner(ldb, { token, ...OWNER }, { env: ENV, now, sleep: noSleep });
    params.length = 0;
    for (let i = 0; i < SETUP_MAX_FAILURES; i++) expect(await go("wrong-token", NOW)).toEqual({ status: "refused" });
    expect(await go(TOKEN, NOW)).toEqual({ status: "refused" });
    expect((await go(TOKEN, new Date(NOW.getTime() + SETUP_LOCK_MS))).status).toBe("created");
    expect(params.length).toBeGreaterThan(0);
    expect(params.filter((p) => p instanceof Date)).toEqual([]);
  });

  it("recreates the counter row if it was deleted", async () => {
    await db.delete(s.setupAttempts);
    expect(await run("wrong-token")).toEqual({ status: "refused" });
    const [row] = await db.select().from(s.setupAttempts);
    expect(row!.failures).toBe(1);
  });

  it("two concurrent submissions with the right token create exactly one owner", async () => {
    const results = await Promise.all([
      setupFirstOwner(db, { token: TOKEN, email: "one@x.test", name: "One" }, { env: ENV, now: NOW, sleep: noSleep }),
      setupFirstOwner(db, { token: TOKEN, email: "two@x.test", name: "Two" }, { env: ENV, now: NOW, sleep: noSleep }),
      setupFirstOwner(db, { token: TOKEN, email: "one@x.test", name: "One" }, { env: ENV, now: NOW, sleep: noSleep }),
    ]);
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(await owners()).toHaveLength(1);
    expect(await db.select().from(s.invites)).toHaveLength(1);
  });

  it("takes the advisory lock inside the transaction before it re-checks for an owner", async () => {
    const statements: string[] = [];
    const origTx = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(((fn: (tx: Db) => Promise<unknown>) =>
      origTx(async (tx) => {
        const exec = tx.execute.bind(tx);
        const select = tx.select.bind(tx);
        (tx as unknown as { execute: typeof exec }).execute = ((q: Parameters<typeof exec>[0]) => {
          statements.push(JSON.stringify(q));
          return exec(q);
        }) as typeof exec;
        (tx as unknown as { select: typeof select }).select = ((...a: Parameters<typeof select>) => {
          statements.push("select");
          return select(...a);
        }) as typeof select;
        return fn(tx as unknown as Db);
      })) as never);
    expect((await run(TOKEN)).status).toBe("created");
    expect(statements[0]).toMatch(/pg_advisory_xact_lock/);
    expect(statements[0]).toContain(String(OWNER_CREATION_LOCK_KEY));
    expect(statements[1]).toBe("select");
  });

  it("admin:create-owner takes the same owner-creation lock first, so it cannot race /setup", async () => {
    const statements = recordTransactionStatements();
    await createOwner(db, { email: "cli@x.test", name: "Cli" });
    expect(statements[0]).toMatch(/pg_advisory_xact_lock/);
    expect(statements[0]).toContain(String(OWNER_CREATION_LOCK_KEY));
  });

  it("an owner made by admin:create-owner closes /setup, even after /setup passed its first owner check", async () => {
    // /setup's early check sees no owner; the CLI then creates one before /setup's transaction:
    // the re-check under the lock refuses instead of making a second owner.
    const origTx = db.transaction.bind(db);
    let injected = false;
    vi.spyOn(db, "transaction").mockImplementation(((fn: (tx: Db) => Promise<unknown>) => {
      if (injected) return origTx(fn as never);
      injected = true;
      return createOwner(db, { email: "cli@x.test", name: "Cli" }).then(() => origTx(fn as never));
    }) as never);
    expect(await run(TOKEN)).toEqual({ status: "refused" });
    expect((await owners()).map((o) => o.login)).toEqual(["cli@x.test"]);
  });
});

describe("createFirstOwner (server action)", () => {
  it("answers 404 (notFound) while off, and once an owner exists", async () => {
    vi.stubEnv("SETUP_TOKEN", "");
    await expect(createFirstOwner({}, form({ token: TOKEN, ...OWNER }))).rejects.toBeInstanceOf(h.NotFound);
    vi.stubEnv("SETUP_TOKEN", "short");
    await expect(createFirstOwner({}, form({ token: "short", ...OWNER }))).rejects.toBeInstanceOf(h.NotFound);
    vi.stubEnv("SETUP_TOKEN", TOKEN);
    await createOwner(db, { email: "x@y.test", name: "X" });
    await expect(createFirstOwner({}, form({ token: TOKEN, ...OWNER }))).rejects.toBeInstanceOf(h.NotFound);
  });

  it("a wrong token waits about a second and returns only the generic error", async () => {
    vi.stubEnv("SETUP_TOKEN", TOKEN);
    const started = Date.now();
    const state = await createFirstOwner({}, form({ token: "nope", ...OWNER }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(SETUP_FAIL_DELAY_MS - 50);
    expect(state).toEqual({ error: "refused", values: { email: OWNER.email, name: OWNER.name } });
  });

  it("returns the invite path once, then 404s; nothing secret reaches the console", async () => {
    vi.stubEnv("SETUP_TOKEN", TOKEN);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const state = await createFirstOwner({}, form({ token: TOKEN, ...OWNER }));
    expect(state.invitePath).toMatch(/^\/admin\/invite\/\S{43}$/);
    expect(state).not.toHaveProperty("values");
    await expect(createFirstOwner({}, form({ token: TOKEN, ...OWNER }))).rejects.toBeInstanceOf(h.NotFound);
    await expect(SetupPage()).rejects.toBeInstanceOf(h.NotFound);
    const inviteToken = state.invitePath!.split("/").pop()!;
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const text = call.map(String).join(" ");
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(inviteToken);
      }
    }
  });
});

describe("/setup page", () => {
  it("404s while off or once an owner exists, and renders while open", async () => {
    vi.stubEnv("SETUP_TOKEN", "");
    await expect(SetupPage()).rejects.toBeInstanceOf(h.NotFound);
    vi.stubEnv("SETUP_TOKEN", TOKEN);
    const page = await SetupPage();
    expect(page).toBeTruthy();
    // The page never puts the configured token into what it renders.
    expect(JSON.stringify(page)).not.toContain(TOKEN);
    await seedDemo(db);
    await expect(SetupPage()).rejects.toBeInstanceOf(h.NotFound);
  });

  it("adds no /setup-only header rule, so a closed /setup 404 carries the headers of any unknown route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.filter((r) => r.source.startsWith("/setup"))).toEqual([]);
  });

  it("asks search engines not to index the open page (noindex in its metadata, not in a header)", async () => {
    const mod = await import("@/app/setup/page");
    expect(mod.metadata).toMatchObject({ robots: { index: false, follow: false } });
  });
});

describe("existing paths are unaffected", () => {
  it("the demo seed still loads and still has its owner", async () => {
    const seed = await seedDemo(db);
    expect(seed).toBeTruthy();
    expect(await owners()).toHaveLength(1);
  });

  it("admin:create-owner still creates an owner and, run again, issues a fresh invite", async () => {
    const first = await createOwner(db, { email: "Owner@X.test", name: "O" });
    const again = await createOwner(db, { email: "owner@x.test", name: "O" });
    expect(first.inviteToken).not.toBe(again.inviteToken);
    expect(await peekAdminInvite(db, first.inviteToken)).toBeNull();
    expect(await peekAdminInvite(db, again.inviteToken)).toEqual({ name: "O", login: "owner@x.test" });
    expect(await owners()).toHaveLength(1);
  });

  it("migration 0019 holds exactly one counter row", async () => {
    const r = (await db.execute(sql`select id, failures from setup_attempts`)) as unknown as { rows: unknown[] };
    expect(r.rows).toEqual([{ id: 1, failures: 0 }]);
    await expect(db.execute(sql`insert into setup_attempts (id) values (2)`)).rejects.toThrow();
  });
});
