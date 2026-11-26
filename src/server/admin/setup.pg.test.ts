import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { insertOwnerWithInvite, createOwner, lockOwnerCreation } from "./bootstrap";
import { setupFirstOwner } from "./setup";

/**
 * The /setup lockout and the owner-creation lock on REAL Postgres through postgres-js (the
 * production driver), with a pool of separate connections. PGlite runs one connection and accepts
 * things postgres-js does not, so these properties can only be shown here.
 *
 * Skipped unless TEST_DATABASE_URL is set. It deletes every user and invite, so the database name
 * must end in `_test`, e.g. TEST_DATABASE_URL=postgres://postgres:pg@127.0.0.1:5432/setup_test.
 */
const url = process.env.TEST_DATABASE_URL;
const TOKEN = "r".repeat(40);
const ENV = { SETUP_TOKEN: TOKEN };
const noSleep = async () => {};

describe.skipIf(!url)("/setup on real Postgres (TEST_DATABASE_URL)", () => {
  let db: Db;
  let end: () => Promise<void>;

  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must name a database ending in _test");
    const [{ drizzle }, { default: postgres }, { migratePostgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
      import("@/db/migrate"),
    ]);
    await migratePostgres(url!);
    const client = postgres(url!, { prepare: false, max: 10, onnotice: () => {} });
    db = drizzle(client, { schema: s }) as unknown as Db;
    end = () => client.end({ timeout: 5 });
  });

  afterAll(async () => {
    await end?.();
  });

  beforeEach(async () => {
    await db.execute(sql`delete from invites`);
    await db.execute(sql`delete from users`);
    await db.execute(sql`update setup_attempts set failures = 0, window_started_at = null, locked_until = null`);
  });

  const go = (token: string, email: string) => setupFirstOwner(db, { token, email, name: "N" }, { env: ENV, sleep: noSleep });
  const owners = () => db.select().from(s.users).where(eq(s.users.role, "owner"));
  const attempts = async () => (await db.select().from(s.setupAttempts))[0]!;

  it("counts parallel wrong tries without losing one", async () => {
    await Promise.all(Array.from({ length: 4 }, (_, i) => go("wrong", `w${i}@x.test`)));
    expect((await attempts()).failures).toBe(4);
  });

  it("a burst of 30 parallel wrong tries locks the page; the right token is then refused", async () => {
    const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => go("wrong", `w${i}@x.test`)));
    expect(burst.every((r) => r.status === "refused")).toBe(true);
    expect((await attempts()).lockedUntil).not.toBeNull();
    expect(await go(TOKEN, "ok@x.test")).toEqual({ status: "refused" });
    expect(await owners()).toHaveLength(0);
  });

  it("ten parallel right-token submissions on separate connections create exactly one owner", async () => {
    const race = await Promise.all(Array.from({ length: 10 }, (_, i) => go(TOKEN, `o${i}@x.test`)));
    expect(race.filter((r) => r.status === "created")).toHaveLength(1);
    expect(await owners()).toHaveLength(1);
  });

  it("waits for an owner creation that holds the lock, then refuses", async () => {
    let committedAt = 0;
    const held = db.transaction(async (tx) => {
      await lockOwnerCreation(tx as unknown as Db);
      await insertOwnerWithInvite(tx as unknown as Db, "cli@x.test", "Cli");
      await new Promise((r) => setTimeout(r, 1000));
      committedAt = Date.now();
    });
    await new Promise((r) => setTimeout(r, 150));
    const setup = go(TOKEN, "web@x.test").then((r) => ({ r, at: Date.now() }));
    await held;
    const { r, at } = await setup;
    expect(at).toBeGreaterThanOrEqual(committedAt);
    expect(r).toEqual({ status: "refused" });
    expect((await owners()).map((o) => o.login)).toEqual(["cli@x.test"]);
  });

  it("admin:create-owner racing /setup: at most one owner comes from /setup", async () => {
    const mixed = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => go(TOKEN, `m${i}@x.test`)),
      createOwner(db, { email: "cli@x.test", name: "Cli" }).then(() => ({ status: "cli" as const })),
    ]);
    const made = mixed.filter((m) => m.status === "created").length;
    expect(made).toBeLessThanOrEqual(1);
    expect(await owners()).toHaveLength(made + 1);
  });
});
