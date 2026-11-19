import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getCommissionView } from "@/server/repos/commission";
import { LIST_MAX, listNotifications, markAllRead, unreadCount } from "@/server/repos/notifications";
import { createIncentive, listIncentives, type IncentiveInput } from "./incentives";
import { saveFocusItem } from "./focus";
import { publishScheme, saveDraft } from "./schemes";
import { repCtx } from "./rep-ctx";

let db: Db;
let seed: SeedResult;
let cocktail: string;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
  const r = await saveFocusItem(admin(), {
    name: "كوكتيل",
    unit: "cases",
    target: 300,
    startsOn: "2026-11-01",
    endsOn: "2026-11-30",
    repIds: ["ahmed", "khaled"],
  });
  if (!r.ok) throw new Error("focus item");
  cocktail = r.id;
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co", locale: Ctx["locale"] = "ar"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale,
  timeZone: "Asia/Riyadh",
});
const admin = () => ctxOf(seed.adminId, "admin");
const rep = (id: string, locale: Ctx["locale"] = "ar") => ctxOf(id, "rep", "demo-co", locale);
const NOV = { year: 2026, month: 11 };

const input = (over: Partial<IncentiveInput> = {}): IncentiveInput => ({
  ...NOV,
  label: { ar: "حافز الكوكتيل" },
  explanation: { ar: "بيع 300 كرتونة كوكتيل قبل آخر الشهر" },
  amount: 50000,
  condition: { kind: "focus_at_least", focusItemId: cocktail, min: 300 },
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
  expectedVersion: 1,
  ...over,
});

async function snapshot() {
  const schemes = (await db.select().from(s.schemes)).map((r) => ({ ...r, updatedAt: null }));
  const versions = await db.select().from(s.schemeVersions);
  const notes = await db.select().from(s.notifications);
  return { schemes, versions: versions.length, notes: notes.length };
}

describe("createIncentive", () => {
  it("publishes version 2 and notifies the two reps the focus item is assigned to", async () => {
    const r = await createIncentive(admin(), input());
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.notified).toBe(2);
    expect(r.componentId).toMatch(/^inc_[0-9a-z]{6}$/);

    const [scheme] = await db.select().from(s.schemes).where(and(eq(s.schemes.companyId, "demo-co"), eq(s.schemes.month, 11)));
    expect(scheme!.version).toBe(2);
    expect(scheme!.publishedBy).toBe(seed.adminId);
    expect(scheme!.components.find((c) => c.id === r.componentId)).toMatchObject({ type: "bonus", amount: 50000, label: "حافز الكوكتيل" });
    const versions = await db.select().from(s.schemeVersions).where(eq(s.schemeVersions.schemeId, scheme!.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);

    const view = await getCommissionView(rep("ahmed"), { ...NOV, today: "2026-11-14" });
    const result = view.actual.results.find((x) => x.componentId === r.componentId);
    expect(result).toMatchObject({ reason: "bonus_not_met", amount: 0 });

    expect(await unreadCount(rep("ahmed"))).toBe(1);
    expect(await unreadCount(rep("khaled"))).toBe(1);
    expect(await unreadCount(rep("omar"))).toBe(0);
    await markAllRead(rep("ahmed"));
    expect(await unreadCount(rep("ahmed"))).toBe(0);
    expect(await unreadCount(rep("khaled"))).toBe(1);

    expect(await listIncentives(admin(), NOV)).toEqual([
      { componentId: r.componentId, label: "حافز الكوكتيل", amount: 50000, startsOn: "2026-11-01", endsOn: "2026-11-30", notified: 2, seen: 1 },
    ]);
  });

  it("refuses a repeated expectedVersion as stale and writes nothing", async () => {
    expect((await createIncentive(admin(), input())).ok).toBe(true);
    const before = await snapshot();
    expect(await createIncentive(admin(), input())).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);
  });

  it("lets exactly one of two concurrent calls with the same expectedVersion win", async () => {
    const results = await Promise.all([
      createIncentive(admin(), input({ label: { ar: "أ" } })),
      createIncentive(admin(), input({ label: { ar: "ب" } })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "stale" }]);
    const [scheme] = await db.select().from(s.schemes).where(and(eq(s.schemes.companyId, "demo-co"), eq(s.schemes.month, 11)));
    expect(scheme!.version).toBe(2);
    expect(await db.select().from(s.notifications)).toHaveLength(2);
    expect((await listIncentives(admin(), NOV)).map((r) => r.notified)).toEqual([2]);
  });

  it("is no_published_scheme for a month without one, and for a month that only has a draft", async () => {
    expect(await createIncentive(admin(), input({ year: 2026, month: 12, expectedVersion: 0 }))).toEqual({
      ok: false,
      error: "no_published_scheme",
    });
    await db.insert(s.schemes).values({ id: "draft-dec", companyId: "demo-co", name: "d", year: 2026, month: 12, components: [], draft: [], published: false });
    expect(await createIncentive(admin(), input({ year: 2026, month: 12, expectedVersion: 0 }))).toEqual({
      ok: false,
      error: "no_published_scheme",
    });
    expect(await db.select().from(s.notifications)).toHaveLength(0);
  });

  it("notifies every active rep and supervisor with a target that month when the condition names a line", async () => {
    const r = await createIncentive(
      admin(),
      input({ condition: { kind: "line_pct_at_least", lineId: "bev", minPct: 100 }, label: { ar: "حافز المشروبات", en: "Drinks", ur: "مشروبات" } }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.notified).toBe(4); // ahmed, khaled, omar, yousef hold November targets
    expect(await unreadCount(rep("omar"))).toBe(1);
    expect(await unreadCount(ctxOf("other-rep", "rep", "other-co"))).toBe(0);
    expect((await listNotifications(rep("omar", "en")))[0]!.title).toBe("Drinks");
    expect((await listNotifications(rep("omar", "ur")))[0]!.title).toBe("مشروبات");
  });

  it("skips inactive reps and never reaches another company", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "khaled"));
    // The seed's other-co rep holds a November target there; a stray assignment row must not reach him either.
    await db.insert(s.focusAssignments).values({ id: "fa-x", companyId: "demo-co", focusItemId: cocktail, userId: "other-rep" });
    const r = await createIncentive(admin(), input());
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.notified).toBe(1);
    expect(await unreadCount(ctxOf("other-rep", "rep", "other-co"))).toBe(0);
    expect(await db.select().from(s.notifications).where(eq(s.notifications.userId, "other-rep"))).toHaveLength(0);
  });

  it("does not bring in an admin of another company: the scheme is the caller's only", async () => {
    await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "O", login: "o@other" });
    const before = await snapshot();
    const r = await createIncentive(ctxOf("other-admin", "admin", "other-co"), input());
    expect(r).toEqual({ ok: false, error: "no_published_scheme" });
    expect(await snapshot()).toEqual(before);
  });

  it("returns field errors for blank or too long text, bad amounts and dates, and writes nothing", async () => {
    const before = await snapshot();
    const r = await createIncentive(
      admin(),
      input({
        label: { ar: "  ", en: "x".repeat(81) },
        explanation: { ar: "ي".repeat(501) },
        amount: 1e11 + 1,
        startsOn: "2026-13-01",
      }),
    );
    expect(r).toEqual({
      ok: false,
      errors: { label: "required", labelEn: "too_long", explanation: "too_long", amount: "invalid", startsOn: "invalid" },
    });
    for (const amount of [0, -5, 1.5, Number.NaN]) {
      expect(await createIncentive(admin(), input({ amount }))).toMatchObject({ ok: false, errors: { amount: "invalid" } });
    }
    expect(await createIncentive(admin(), input({ endsOn: "2026-10-01" }))).toMatchObject({ errors: { endsOn: "window_order" } });
    expect(await snapshot()).toEqual(before);
  });

  it("returns scheme issues, writing nothing, when the window does not match the focus item or a line is unknown", async () => {
    const before = await snapshot();
    const a = await createIncentive(admin(), input({ endsOn: "2026-11-20" }));
    expect(a).toMatchObject({ ok: false, issues: [{ code: "focus_window_mismatch" }] });
    const b = await createIncentive(admin(), input({ condition: { kind: "line_pct_at_least", lineId: "nope", minPct: 100 } }));
    expect(b).toMatchObject({ ok: false, issues: [{ code: "unknown_line" }] });
    expect(await snapshot()).toEqual(before);
  });

  it("stores the text as written, with no markup handling, and falls back to Arabic", async () => {
    await createIncentive(admin(), input({ explanation: { ar: "<b>x</b> & y" } }));
    const [n] = await listNotifications(rep("ahmed", "en"));
    expect(n!.body).toBe("<b>x</b> & y");
    expect(n!.title).toBe("حافز الكوكتيل");
  });

  it("is for admins only", async () => {
    await expect(createIncentive(rep("ahmed"), input())).rejects.toBeInstanceOf(Forbidden);
    await expect(createIncentive(ctxOf("sami", "supervisor"), input())).rejects.toBeInstanceOf(Forbidden);
    await expect(listIncentives(rep("ahmed"), NOV)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("createIncentive with an open draft", () => {
  const novRow = async () => (await db.select().from(s.schemes).where(and(eq(s.schemes.companyId, "demo-co"), eq(s.schemes.month, 11))))[0]!;
  async function openDraft() {
    const row = await novRow();
    const r = await saveDraft(admin(), { ...NOV, components: row.components, expectedVersion: row.version, expectedDraftRev: row.draftRev });
    if (!r.ok) throw new Error("draft");
    return r.draftRev;
  }

  it("appends the incentive to the draft and advances draft_rev", async () => {
    const rev = await openDraft();
    const r = await createIncentive(admin(), input());
    if (!r.ok) throw new Error(JSON.stringify(r));
    const row = await novRow();
    expect(row.draft!.map((c) => c.id)).toContain(r.componentId);
    expect(row.draft!.filter((c) => c.id === r.componentId)).toHaveLength(1);
    expect(row.draftRev).toBeGreaterThan(rev);
  });

  it("makes the editor's old draft save stale", async () => {
    const rev = await openDraft();
    const before = await novRow();
    await createIncentive(admin(), input());
    const r = await saveDraft(admin(), { ...NOV, components: before.components, expectedVersion: 1, expectedDraftRev: rev });
    expect(r).toEqual({ ok: false, error: "stale" });
  });

  it("keeps the incentive when the reloaded draft is published", async () => {
    await openDraft();
    const made = await createIncentive(admin(), input());
    if (!made.ok) throw new Error("create");
    const row = await novRow();
    const pub = await publishScheme(admin(), { ...NOV, expectedVersion: row.version, expectedDraftRev: row.draftRev });
    expect(pub.ok).toBe(true);
    expect((await novRow()).components.map((c) => c.id)).toContain(made.componentId);
    const view = await getCommissionView(rep("ahmed"), { ...NOV, today: "2026-11-14" });
    expect(view.actual.results.map((x) => x.componentId)).toContain(made.componentId);
  });

  it("leaves a null draft null", async () => {
    await createIncentive(admin(), input());
    const row = await novRow();
    expect(row.draft).toBeNull();
    expect(row.draftRev).toBe(0);
  });

  it("refuses the whole call when the draft cannot take the incentive", async () => {
    const row = await novRow();
    const full = Array.from({ length: 50 }, (_, i) => ({ ...row.components.find((c) => c.type === "bonus")!, id: `x${i}` }));
    await db.update(s.schemes).set({ draft: full as never, draftRev: 1 }).where(eq(s.schemes.id, row.id));
    const before = await snapshot();
    const r = await createIncentive(admin(), input());
    expect(r).toMatchObject({ ok: false, issues: expect.any(Array) });
    expect(await snapshot()).toEqual(before);
  });
});

describe("notifications of a rep", () => {
  it("marks only the ids it is given", async () => {
    await createIncentive(admin(), input());
    await createIncentive(admin(), input({ label: { ar: "تاني" }, expectedVersion: 2 }));
    const [newest, older] = await listNotifications(rep("ahmed"));
    await markAllRead(rep("ahmed"), [older!.id]);
    expect(await unreadCount(rep("ahmed"))).toBe(1);
    expect((await listNotifications(rep("ahmed"))).find((n) => n.id === newest!.id)!.read).toBe(false);
    await markAllRead(rep("ahmed"), []);
    expect(await unreadCount(rep("ahmed"))).toBe(1);
  });

  it("does not mark another user's id", async () => {
    await createIncentive(admin(), input());
    const [k] = await listNotifications(rep("khaled"));
    await markAllRead(rep("ahmed"), [k!.id]);
    expect(await unreadCount(rep("khaled"))).toBe(1);
  });

  it("stores ref as schemeId:componentId", async () => {
    const r = await createIncentive(admin(), input());
    if (!r.ok) throw new Error("create");
    const [scheme] = await db.select().from(s.schemes).where(and(eq(s.schemes.companyId, "demo-co"), eq(s.schemes.month, 11)));
    const [n] = await db.select().from(s.notifications);
    expect(n!.ref).toBe(`${scheme!.id}:${r.componentId}`);
  });

  it("lists newest first, own rows only", async () => {
    await createIncentive(admin(), input());
    await createIncentive(admin(), input({ label: { ar: "تاني" }, expectedVersion: 2 }));
    const mine = await listNotifications(rep("ahmed"));
    expect(mine.map((n) => n.title)).toEqual(["تاني", "حافز الكوكتيل"]);
    expect(mine.every((n) => n.kind === "incentive" && !n.read)).toBe(true);
    expect(await listNotifications(rep("omar"))).toEqual([]);
  });

  it("does not read or mark another company's row even with a forged same user id", async () => {
    await createIncentive(admin(), input());
    const foreign = ctxOf("ahmed", "rep", "other-co");
    expect(await unreadCount(foreign)).toBe(0);
    expect(await listNotifications(foreign)).toEqual([]);
    await markAllRead(foreign);
    expect(await unreadCount(rep("ahmed"))).toBe(1);
  });

  it("refuses markAllRead from the read-only context an admin gets for a rep", async () => {
    await createIncentive(admin(), input());
    const acting = await repCtx(admin(), "ahmed");
    if (!acting) throw new Error("repCtx");
    expect(await unreadCount(acting)).toBe(1);
    await expect(markAllRead(acting)).rejects.toBeInstanceOf(Forbidden);
    expect(await unreadCount(rep("ahmed"))).toBe(1);
  });
});

describe("incentive catalogs", () => {
  const keysOf = (o: unknown, p = ""): string[] =>
    typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => keysOf(v, `${p}${k}.`)) : [p];
  it("have the same keys in ar, en and ur", () => {
    for (const ns of ["notifications", "admin.incentives", "admin.nav.incentives", "home.notificationsUnread"]) {
      const pick = (m: Record<string, unknown>) => ns.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m);
      const a = keysOf(pick(ar)).sort();
      expect(a.length).toBeGreaterThan(0);
      expect(keysOf(pick(en)).sort()).toEqual(a);
      expect(keysOf(pick(ur)).sort()).toEqual(a);
    }
  });
});

describe("B9: a full notification list clears the bell", () => {
  it("with 105 unread, marking what the page rendered (plus everything at or before the oldest shown) leaves none unread", async () => {
    const base = Date.parse("2026-11-01T00:00:00Z");
    await db.insert(s.notifications).values(
      Array.from({ length: 105 }, (_, i) => ({
        id: `n-${String(i).padStart(3, "0")}`,
        companyId: "demo-co",
        userId: "ahmed",
        kind: "incentive" as const,
        title: { ar: "t" },
        body: { ar: "b" },
        createdAt: new Date(base + i * 60_000),
      })),
    );
    const items = await listNotifications(rep("ahmed"));
    expect(items).toHaveLength(LIST_MAX);
    expect(await unreadCount(rep("ahmed"))).toBe(105);
    // What the page did before: only the rendered ids.
    await markAllRead(rep("ahmed"), items.map((n) => n.id));
    expect(await unreadCount(rep("ahmed"))).toBe(5);
    // What it does now.
    await db.update(s.notifications).set({ readAt: null });
    await markAllRead(rep("ahmed"), items.map((n) => n.id), { upTo: items[items.length - 1]!.createdAt });
    expect(await unreadCount(rep("ahmed"))).toBe(0);
  });

  it("never touches another rep's notifications", async () => {
    await createIncentive(admin(), input());
    await markAllRead(rep("ahmed"), [], { upTo: new Date("2100-01-01T00:00:00Z") });
    expect(await unreadCount(rep("khaled"))).toBe(1);
  });
});
