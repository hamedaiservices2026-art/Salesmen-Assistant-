import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { assignSupervisorAction, createUserAction, issueInviteAction, setActiveAction } from "./actions";

const h = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
    }
  }
  return { Redirect, db: undefined as unknown, jar: new Map<string, string>() };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new h.Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/db/client", () => ({ getDb: async () => h.db }));

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  h.db = db;
  h.jar.clear();
  seed = await seedDemo(db);
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const signInAs = async (userId: string) => {
  h.jar.set("session", await createSession(db, userId));
};
const redirectOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof h.Redirect) return e.url;
    throw e;
  }
};
const userRow = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0]!;

describe("user actions (Review Focus 1 and 5)", () => {
  it("an admin creates a rep and gets the invite path; the company comes from the session", async () => {
    await signInAs(seed.adminId);
    const r = await createUserAction({}, form({ name: "ماجد", login: " Majed.K ", role: "rep", supervisorId: "", locale: "", companyId: "other-co" }));
    expect(r.created?.invitePath).toMatch(/^\/invite\/[\w-]+$/);
    expect(await db.select().from(s.users).where(eq(s.users.login, "majed.k"))).toMatchObject([{ companyId: "demo-co" }]);
    const a = await createUserAction({}, form({ name: "مدير", login: "boss3@demo.test", role: "admin", supervisorId: "", locale: "en" }));
    expect(a.created?.invitePath).toMatch(/^\/admin\/invite\//);
    expect(await createUserAction({}, form({ name: "x", login: "valid.one", role: "owner" }))).toMatchObject({ errors: { role: "invalid" } });
  });

  it("a forged id of another company is not_found and changes nothing", async () => {
    await signInAs(seed.adminId);
    await createSession(db, "other-rep");
    const invitesBefore = (await db.select().from(s.invites)).length;
    expect(await issueInviteAction({}, form({ userId: "other-rep" }))).toEqual({ error: "not_found" });
    expect(await setActiveAction({}, form({ userId: "other-rep", active: "false" }))).toEqual({ error: "not_found" });
    expect(await assignSupervisorAction({}, form({ repId: "other-rep", supervisorId: "sami" }))).toEqual({ error: "not_found" });
    expect((await userRow("other-rep")).active).toBe(true);
    expect((await userRow("other-rep")).supervisorId).toBeNull();
    expect((await db.select().from(s.invites)).length).toBe(invitesBefore);
    expect(await db.select().from(s.sessions).where(eq(s.sessions.userId, "other-rep"))).toHaveLength(1);
  });

  it("issues a link, refuses to stop himself, and assigns a supervisor", async () => {
    await signInAs(seed.adminId);
    const link = await issueInviteAction({}, form({ userId: "omar" }));
    expect(link.link).toMatchObject({ userId: "omar" });
    expect(link.link?.invitePath).toMatch(/^\/invite\//);
    expect(await setActiveAction({}, form({ userId: seed.adminId, active: "false" }))).toEqual({ error: "self" });
    expect(await assignSupervisorAction({}, form({ repId: "omar", supervisorId: "sami" }))).toEqual({});
    expect((await userRow("omar")).supervisorId).toBe("sami");
    expect(await assignSupervisorAction({}, form({ repId: "omar", supervisorId: "" }))).toEqual({});
    expect((await userRow("omar")).supervisorId).toBeNull();
  });

  it("a rep or a supervisor session posting an action is redirected to /app, and nothing changes", async () => {
    for (const who of ["ahmed", "sami"]) {
      h.jar.clear();
      await signInAs(who);
      expect(await redirectOf(setActiveAction({}, form({ userId: "omar", active: "false" })))).toBe("/app");
      expect(await redirectOf(issueInviteAction({}, form({ userId: "omar" })))).toBe("/app");
      expect(await redirectOf(createUserAction({}, form({ name: "x", login: "valid.one", role: "rep" })))).toBe("/app");
      expect(await redirectOf(assignSupervisorAction({}, form({ repId: "omar", supervisorId: "sami" })))).toBe("/app");
    }
    expect((await userRow("omar")).active).toBe(true);
    expect((await userRow("omar")).supervisorId).toBeNull();
    expect(await db.select().from(s.users).where(eq(s.users.login, "valid.one"))).toHaveLength(0);
  });

  it("no session goes to the admin sign-in", async () => {
    expect(await redirectOf(setActiveAction({}, form({ userId: "omar", active: "false" })))).toBe("/admin/signin");
  });
});
