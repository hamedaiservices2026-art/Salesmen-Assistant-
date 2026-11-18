import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { SCHEME_ISSUE_CODES, type Component } from "@/domain/commission";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { sampleScheme } from "@/domain/commission/sample-fixture";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getCommissionView } from "@/server/repos/commission";
import { getHistoryMonths } from "@/server/repos/history";
import { moveLine, saveLine, setLineActive } from "./lines";
import { repCtx } from "./rep-ctx";
import { updateDraftRow } from "./schemes-internal";
import { getSchemeEditor, previewScheme, publishComponents, publishScheme, saveDraft } from "./schemes";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const TODAY = "2026-11-14";
const NOV = { year: 2026, month: 11 };
const DEC = { year: 2026, month: 12 };

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const admin = () => ctxOf(seed.adminId, "admin");
const ahmed = () => ctxOf("ahmed", "rep");

async function otherAdmin(): Promise<Ctx> {
  await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "Other Admin", login: "admin@other.test" });
  return ctxOf("other-admin", "admin", "other-co");
}

/** Every scheme, scheme version and line row of both companies, so "nothing changed" is one comparison. */
async function snapshot() {
  const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemes: byId((await db.select().from(s.schemes)).map((r) => ({ ...r, updatedAt: null }))),
    versions: byId(await db.select().from(s.schemeVersions)),
    lines: byId((await db.select().from(s.targetLines)).map((r) => ({ ...r, updatedAt: null }))),
  };
}

/** `getSchemeEditor` for a valid period: the editor itself. */
async function ed(ctx: Ctx, p: { year: number; month: number }) {
  const e = await getSchemeEditor(ctx, p);
  if (!e.ok) throw new Error("invalid period");
  return e;
}

const schemeRow = async (companyId: string, p: { year: number; month: number }) =>
  (
    await db
      .select()
      .from(s.schemes)
      .where(and(eq(s.schemes.companyId, companyId), eq(s.schemes.year, p.year), eq(s.schemes.month, p.month)))
  )[0];

/** The sample scheme without the November-only mango bonus, valid in December. */
const decemberComponents = (): Component[] => sampleScheme.components.filter((c) => c.id !== "c_mango");

/** The sample scheme with `c_bev`'s 80% tier paying a different (synthetic) amount. */
function withBevTier80(amount: number): Component[] {
  return sampleScheme.components.map((c) =>
    c.id === "c_bev" && c.type === "tiered"
      ? { ...c, tiers: c.tiers.map((t) => (t.minPct === 80 ? { ...t, pay: { kind: "fixed" as const, amount } } : t)) }
      : c,
  );
}

describe("roles", () => {
  it("every scheme function refuses a rep, a supervisor, an owner and a repCtx context", async () => {
    const tagged = (await repCtx(admin(), "ahmed"))!;
    for (const ctx of [ahmed(), ctxOf("sami", "supervisor"), ctxOf(seed.ownerId, "owner", "platform"), tagged]) {
      await expect(getSchemeEditor(ctx, NOV)).rejects.toThrow(Forbidden);
      await expect(saveDraft(ctx, { ...NOV, components: [], expectedVersion: 1, expectedDraftRev: 0 })).rejects.toThrow(Forbidden);
      await expect(publishScheme(ctx, { ...NOV, expectedVersion: 1, expectedDraftRev: 0 })).rejects.toThrow(Forbidden);
      await expect(previewScheme(ctx, { ...NOV, components: [], repId: "ahmed", today: TODAY })).rejects.toThrow(Forbidden);
      await expect(db.transaction((tx) => publishComponents(tx as unknown as Db, ctx, "scheme-2026-11", [], 1))).rejects.toThrow(Forbidden);
    }
  });
});

describe("getSchemeEditor", () => {
  it("shows the seeded November scheme as version 1 with its migrated history and the month's refs", async () => {
    const e = await ed(admin(), NOV);
    expect(e).toMatchObject({ schemeId: "scheme-2026-11", version: 1, draftRev: 0, draft: null, issuesInPublished: [] });
    expect(e.published).toEqual(sampleScheme.components);
    expect(e.refs).toEqual({
      lines: [
        { id: "bev", unit: "cases", kind: "sales" },
        { id: "food", unit: "value", kind: "sales" },
        { id: "coll", unit: "value", kind: "collection" },
      ],
      focus: [
        { id: "cola", startsOn: "2026-11-01", endsOn: "2026-11-30" },
        { id: "mango", startsOn: "2026-11-01", endsOn: "2026-11-20" },
      ],
      period: { start: "2026-11-01", end: "2026-11-30" },
    });
    expect(e.reps.map((r) => r.id).sort()).toEqual(["ahmed", "khaled", "omar", "sami", "yousef"]);
    expect(e.history).toEqual([{ version: 1, at: expect.any(Date), byName: null }]);
  });

  it("a month with nothing yet: no scheme, version 0, refs without November's focus items", async () => {
    const e = await ed(admin(), DEC);
    expect(e).toMatchObject({ schemeId: null, version: 0, draftRev: 0, published: null, draft: null, history: [], issuesInPublished: [] });
    expect(e.refs.focus).toEqual([]);
    expect(e.refs.period).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("saveDraft and publishScheme", () => {
  it("draft then publish for December 2026: version 1, and Ahmed's December commission uses it", async () => {
    const saved = await saveDraft(admin(), { ...DEC, components: decemberComponents(), expectedVersion: 0, expectedDraftRev: 0 });
    expect(saved).toEqual({ ok: true, draftRev: 1 });

    // A draft-only row: empty published components, default name, invisible to reps.
    expect(await schemeRow("demo-co", DEC)).toMatchObject({
      name: "ديسمبر 2026",
      components: [],
      published: false,
      version: 0,
      draftRev: 1,
      draft: decemberComponents(),
    });
    expect((await getCommissionView(ahmed(), { ...DEC, today: "2026-12-05" })).scheme).toBeNull();

    expect(await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 1 })).toEqual({ ok: true, version: 1 });
    const row = (await schemeRow("demo-co", DEC))!;
    expect(row).toMatchObject({ published: true, version: 1, draft: null, publishedBy: seed.adminId, components: decemberComponents() });
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.draftRev).toBeGreaterThan(1);

    const view = await getCommissionView(ahmed(), { ...DEC, today: "2026-12-05" });
    expect(view.scheme).toEqual({ id: row.id, name: "ديسمبر 2026", components: decemberComponents() });
    expect(view.actual.results.map((r) => r.componentId)).toEqual(["c_bev", "c_food", "c_coll"]);

    const e = await ed(admin(), DEC);
    expect(e).toMatchObject({ version: 1, draft: null, published: decemberComponents() });
    expect(e.history).toEqual([{ version: 1, at: expect.any(Date), byName: "مدير العرض" }]);
  });

  it("publishing again with expectedVersion 0 is stale and the version stays 1 (Review Focus 4)", async () => {
    await saveDraft(admin(), { ...DEC, components: decemberComponents(), expectedVersion: 0, expectedDraftRev: 0 });
    expect((await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 1 })).ok).toBe(true);
    const before = await snapshot();
    expect(await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 1 })).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);
    expect((await schemeRow("demo-co", DEC))!.version).toBe(1);
  });

  it("saveDraft with expectedVersion 0 after version 1 is stale and stores nothing", async () => {
    const before = await snapshot();
    expect(await saveDraft(admin(), { ...NOV, components: withBevTier80(1), expectedVersion: 0, expectedDraftRev: 0 })).toEqual({
      ok: false,
      error: "stale",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("two admins saving the same draft revision: the second is stale and the first draft stays (Review Focus 4)", async () => {
    await db.insert(s.users).values({ id: "admin-2", companyId: "demo-co", role: "admin", name: "مدير تاني", login: "admin2@demo.test" });
    const second = ctxOf("admin-2", "admin");
    expect(await saveDraft(admin(), { ...NOV, components: withBevTier80(111), expectedVersion: 1, expectedDraftRev: 0 })).toEqual({
      ok: true,
      draftRev: 1,
    });
    const before = await snapshot();
    expect(await saveDraft(second, { ...NOV, components: withBevTier80(222), expectedVersion: 1, expectedDraftRev: 0 })).toEqual({
      ok: false,
      error: "stale",
    });
    expect(await snapshot()).toEqual(before);
    expect((await ed(second, NOV)).draft).toEqual(withBevTier80(111));

    // The first save of a month that has no row yet: the second admin's first save is stale too.
    expect((await saveDraft(admin(), { ...DEC, components: [], expectedVersion: 0, expectedDraftRev: 0 })).ok).toBe(true);
    expect(await saveDraft(second, { ...DEC, components: decemberComponents(), expectedVersion: 0, expectedDraftRev: 0 })).toEqual({
      ok: false,
      error: "stale",
    });
    expect((await schemeRow("demo-co", DEC))!.draft).toEqual([]);
  });

  it("publishing a draft revision someone has since replaced is stale and changes nothing", async () => {
    await saveDraft(admin(), { ...NOV, components: withBevTier80(111), expectedVersion: 1, expectedDraftRev: 0 });
    await saveDraft(admin(), { ...NOV, components: withBevTier80(222), expectedVersion: 1, expectedDraftRev: 1 });
    const before = await snapshot();
    expect(await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 1 })).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);
  });

  it("publishing with no draft is no_draft; with no row at all, a wrong expectation is stale", async () => {
    expect(await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({ ok: false, error: "no_draft" });
    expect(await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 0 })).toEqual({ ok: false, error: "no_draft" });
    expect(await publishScheme(admin(), { ...DEC, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({ ok: false, error: "stale" });
    expect(await saveDraft(admin(), { ...DEC, components: [], expectedVersion: 0, expectedDraftRev: 3 })).toEqual({ ok: false, error: "stale" });
    expect(await schemeRow("demo-co", DEC)).toBeUndefined();
  });

  it("an invalid draft is not stored: its issues come back and nothing changes", async () => {
    const before = await snapshot();
    const bad = sampleScheme.components.map((c) => (c.id === "c_coll" ? { ...c, lineId: "zzz" } : c));
    expect(await saveDraft(admin(), { ...NOV, components: bad, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({
      ok: false,
      issues: [{ path: "components.2.lineId", code: "unknown_line" }],
    });
    expect(await saveDraft(admin(), { ...NOV, components: "nope", expectedVersion: 1, expectedDraftRev: 0 })).toEqual({
      ok: false,
      issues: [{ path: "components", code: "shape" }],
    });
    expect(await saveDraft(admin(), { year: 2026, month: 13, components: [], expectedVersion: 0, expectedDraftRev: 0 })).toEqual({
      ok: false,
      issues: [{ path: "period", code: "shape" }],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("republishing November mid-month with c_bev's tiers changed: Ahmed's projection changes at once and version 2 is logged", async () => {
    // Projected bev at 14 Nov: 1140 × 26 ÷ 11 = 2695 (89%), the 80% tier: 150 000; food 97 855; coll 100 000.
    expect((await getCommissionView(ahmed(), { ...NOV, today: TODAY })).projected.total).toBe(347_855);

    const changed = withBevTier80(200_000);
    expect(await saveDraft(admin(), { ...NOV, components: changed, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({ ok: true, draftRev: 1 });
    // A saved draft does not reach the rep.
    expect((await getCommissionView(ahmed(), { ...NOV, today: TODAY })).projected.total).toBe(347_855);
    expect(await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 1 })).toEqual({ ok: true, version: 2 });

    const view = await getCommissionView(ahmed(), { ...NOV, today: TODAY });
    expect(view.projected.total).toBe(397_855); // 200 000 + 97 855 + 100 000
    expect(view.projected.results.find((r) => r.componentId === "c_bev")).toMatchObject({ amount: 200_000, reason: "tier" });
    expect(view.actual.total).toBe(41_400);

    const versions = await db.select().from(s.schemeVersions).where(eq(s.schemeVersions.schemeId, "scheme-2026-11"));
    expect(versions.map((v) => [v.version, v.publishedBy]).sort()).toEqual([
      [1, null],
      [2, seed.adminId],
    ]);
    expect(versions.find((v) => v.version === 2)!.components).toEqual(changed);
    expect((await ed(admin(), NOV)).history.map((h) => [h.version, h.byName])).toEqual([
      [2, "مدير العرض"],
      [1, null],
    ]);
  });
});

describe("a published scheme naming a line that is later deactivated (Review Focus 3)", () => {
  it("Ahmed's commission still evaluates (c_coll no_target) and the editor flags the line before the next publish", async () => {
    expect(await setLineActive(admin(), "coll", false)).toEqual({ ok: true });

    const view = await getCommissionView(ahmed(), { ...NOV, today: TODAY });
    expect(view.actual.results.find((r) => r.componentId === "c_coll")).toMatchObject({ amount: 0, reason: "no_target" });
    expect(view.actual.total).toBe(41_400);

    const e = await ed(admin(), NOV);
    expect(e.issuesInPublished).toContainEqual({ path: "components.2.lineId", code: "unknown_line" });
    expect(e.issuesInPublished).toContainEqual({ path: "components.4.condition.lineId", code: "unknown_line" });
    expect(e.refs.lines.map((l) => l.id)).toEqual(["bev", "food"]);

    const r = await saveDraft(admin(), { ...NOV, components: sampleScheme.components, expectedVersion: 1, expectedDraftRev: 0 });
    expect(r.ok).toBe(false);
    expect(!r.ok && "issues" in r && r.issues).toContainEqual({ path: "components.2.lineId", code: "unknown_line" });
  });
});

describe("lines named by a scheme are in use", () => {
  async function newLine() {
    const r = await saveLine(admin(), { code: "juice", nameAr: "عصير", nameEn: "Juice", nameUr: "جوس", unit: "cases", kind: "sales", sort: 9, active: true });
    if (!r.ok) throw new Error("line not created");
    return r.id;
  }
  const juiceTier = (lineId: string): Component => ({
    id: "c_juice",
    type: "tiered",
    label: "شرائح العصير",
    lineId,
    tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 1000 } }],
  });
  const reshape = (id: string) =>
    saveLine(admin(), { id, code: "juice", nameAr: "عصير", nameEn: "Juice", nameUr: "جوس", unit: "value", kind: "sales", sort: 9, active: true });

  it("a line named only by a published scheme refuses a shape change but can still be renamed or deactivated", async () => {
    const id = await newLine();
    await saveDraft(admin(), { ...DEC, components: [juiceTier(id)], expectedVersion: 0, expectedDraftRev: 0 });
    expect((await publishScheme(admin(), { ...DEC, expectedVersion: 0, expectedDraftRev: 1 })).ok).toBe(true);
    expect(await reshape(id)).toEqual({ ok: false, errors: { unit: "in_use" } });
    expect(
      (await saveLine(admin(), { id, code: "juice", nameAr: "عصير طازج", nameEn: "Juice", nameUr: "جوس", unit: "cases", kind: "sales", sort: 9, active: true })).ok,
    ).toBe(true);
    expect(await setLineActive(admin(), id, false)).toEqual({ ok: true });
  });

  it("a line named only by a saved draft is in use too", async () => {
    const id = await newLine();
    expect(await reshape(id)).toEqual({ ok: true, id }); // nothing names it yet
    await saveLine(admin(), { id, code: "juice", nameAr: "عصير", nameEn: "Juice", nameUr: "جوس", unit: "cases", kind: "sales", sort: 9, active: true });
    expect((await saveDraft(admin(), { ...DEC, components: [juiceTier(id)], expectedVersion: 0, expectedDraftRev: 0 })).ok).toBe(true);
    expect(await reshape(id)).toEqual({ ok: false, errors: { unit: "in_use" } });
  });

  it("per_case on a line validated against its current shape", async () => {
    const id = await newLine();
    await reshape(id); // now a value line
    const perCase: Component = { id: "c_j", type: "per_unit", label: "لكل كرتونة", lineId: id, rate: { kind: "per_case", amount: 100 } };
    expect(await saveDraft(admin(), { ...DEC, components: [perCase], expectedVersion: 0, expectedDraftRev: 0 })).toEqual({
      ok: false,
      issues: [{ path: "components.0.rate", code: "per_case_needs_cases" }],
    });
  });
});

describe("previewScheme", () => {
  it("Ahmed with the sample components: actual total 41 400", async () => {
    const p = await previewScheme(admin(), { ...NOV, components: sampleScheme.components, repId: "ahmed", today: TODAY });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.actual.total).toBe(41_400);
    expect(p.projected.total).toBe(347_855);
  });

  it("equals what Ahmed sees once the same components are published", async () => {
    const changed = withBevTier80(200_000);
    const preview = await previewScheme(admin(), { ...NOV, components: changed, repId: "ahmed", today: TODAY });
    await saveDraft(admin(), { ...NOV, components: changed, expectedVersion: 1, expectedDraftRev: 0 });
    await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 1 });
    const view = await getCommissionView(ahmed(), { ...NOV, today: TODAY });
    expect(preview).toEqual({ ok: true, actual: view.actual, projected: view.projected, atFullTarget: view.atFullTarget, nearest: view.nearest });
    expect(view.projected.total).toBe(397_855);
  });

  it("invalid components return their issues; nothing is written", async () => {
    const before = await snapshot();
    expect(await previewScheme(admin(), { ...NOV, components: [{ id: "x" }], repId: "ahmed", today: TODAY })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "shape" })] });
    expect(await previewScheme(admin(), { ...NOV, components: sampleScheme.components, repId: "ahmed", today: "14/11/2026" })).toEqual({
      ok: false,
      issues: [{ path: "today", code: "shape" }],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("a rep of another company, an unknown id or a non-rep is not_found (Review Focus 1)", async () => {
    const args = { ...NOV, components: sampleScheme.components, today: TODAY };
    expect(await previewScheme(admin(), { ...args, repId: "other-rep" })).toEqual({ ok: false, error: "not_found" });
    expect(await previewScheme(admin(), { ...args, repId: "nobody" })).toEqual({ ok: false, error: "not_found" });
    expect(await previewScheme(admin(), { ...args, repId: seed.ownerId })).toEqual({ ok: false, error: "not_found" });
    const other = await otherAdmin();
    expect(await previewScheme(other, { ...args, repId: "ahmed" })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("another company (Review Focus 1)", () => {
  it("an admin of another company neither sees nor changes the demo company's scheme", async () => {
    const other = await otherAdmin();
    const before = await snapshot();

    expect(await ed(other, NOV)).toMatchObject({ schemeId: null, version: 0, published: null, history: [] });
    // The demo scheme's version 1 is not his: publishing at version 1 finds nothing of his.
    expect(await publishScheme(other, { ...NOV, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({ ok: false, error: "stale" });
    // Lines and focus items of the demo company are unknown to him.
    expect(await saveDraft(other, { ...NOV, components: sampleScheme.components, expectedVersion: 0, expectedDraftRev: 0 })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { path: "components.0.lineId", code: "unknown_line" },
        { path: "components.3.condition.focusItemId", code: "unknown_focus" },
      ]),
    });
    // And the demo admin cannot name the other company's line.
    const forged: Component[] = [{ id: "c_x", type: "tiered", label: "x", lineId: "other-line", tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 1 } }] }];
    expect(await saveDraft(admin(), { ...NOV, components: forged, expectedVersion: 1, expectedDraftRev: 0 })).toEqual({
      ok: false,
      issues: [{ path: "components.0.lineId", code: "unknown_line" }],
    });
    // publishComponents with the demo scheme's id from the other company: stale, nothing written.
    expect(await db.transaction((tx) => publishComponents(tx as unknown as Db, other, "scheme-2026-11", [], 1))).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);

    // His own November draft and publish touch only his company.
    const own: Component[] = [{ id: "c_o", type: "tiered", label: "مبيعات", lineId: "other-line", tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 1 } }] }];
    expect(await saveDraft(other, { ...NOV, components: own, expectedVersion: 0, expectedDraftRev: 0 })).toEqual({ ok: true, draftRev: 1 });
    expect(await publishScheme(other, { ...NOV, expectedVersion: 0, expectedDraftRev: 1 })).toEqual({ ok: true, version: 1 });
    const after = await snapshot();
    expect(after.schemes.filter((r) => r.companyId === "demo-co")).toEqual(before.schemes.filter((r) => r.companyId === "demo-co"));
    expect(after.versions.filter((r) => r.companyId === "demo-co")).toEqual(before.versions.filter((r) => r.companyId === "demo-co"));
    expect((await ed(admin(), NOV)).history).toHaveLength(1);
  });
});

describe("error copy", () => {
  it("every issue code and error the editor can get has a message in ar, en and ur", () => {
    for (const catalog of [ar, en, ur]) {
      const errors = (catalog.admin as unknown as { schemes: { errors: Record<string, string> } }).schemes.errors;
      for (const code of [...SCHEME_ISSUE_CODES, "stale", "not_found", "no_draft", "invalid_period"]) expect(errors[code]?.trim()).toBeTruthy();
    }
  });
});

describe("publishComponents", () => {
  it("publishes without touching an open draft unless asked to clear it", async () => {
    await saveDraft(admin(), { ...NOV, components: withBevTier80(111), expectedVersion: 1, expectedDraftRev: 0 });
    const r = await db.transaction((tx) => publishComponents(tx as unknown as Db, admin(), "scheme-2026-11", withBevTier80(5), 1));
    expect(r).toEqual({ ok: true, version: 2 });
    const row = (await schemeRow("demo-co", NOV))!;
    expect(row).toMatchObject({ version: 2, draft: withBevTier80(111), draftRev: 1, components: withBevTier80(5), publishedBy: seed.adminId });
    // The open draft was made against version 1, so it can no longer be published.
    expect(await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 1 })).toEqual({ ok: false, error: "stale" });
  });
});

describe("the conditional writes themselves (what holds when another transaction commits after the pre-check)", () => {
  const inTx = <T,>(f: (tx: Db) => Promise<T>) => db.transaction((tx) => f(tx as unknown as Db));

  it("publishComponents with a wrong version is stale: no row, no version log, nothing changes", async () => {
    await saveDraft(admin(), { ...NOV, components: withBevTier80(111), expectedVersion: 1, expectedDraftRev: 0 });
    const before = await snapshot();
    expect(await inTx((tx) => publishComponents(tx, admin(), "scheme-2026-11", withBevTier80(5), 0))).toEqual({ ok: false, error: "stale" });
    expect(await inTx((tx) => publishComponents(tx, admin(), "scheme-2026-11", withBevTier80(5), 2))).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);
  });

  it("publishComponents that clears the draft with a wrong draft revision is stale and leaves the draft", async () => {
    await saveDraft(admin(), { ...NOV, components: withBevTier80(111), expectedVersion: 1, expectedDraftRev: 0 });
    const before = await snapshot();
    const wrong = await inTx((tx) =>
      publishComponents(tx, admin(), "scheme-2026-11", withBevTier80(111), 1, { clearDraft: true, expectedDraftRev: 0 }),
    );
    expect(wrong).toEqual({ ok: false, error: "stale" });
    expect(await snapshot()).toEqual(before);
    expect((await schemeRow("demo-co", NOV))!.draft).toEqual(withBevTier80(111));
    // control: the right revision publishes and clears
    const right = await inTx((tx) =>
      publishComponents(tx, admin(), "scheme-2026-11", withBevTier80(111), 1, { clearDraft: true, expectedDraftRev: 1 }),
    );
    expect(right).toEqual({ ok: true, version: 2 });
    expect((await schemeRow("demo-co", NOV))!.draft).toBeNull();
  });

  it("the draft write misses on a wrong version or a wrong draft revision, and hits on the right pair", async () => {
    const before = await snapshot();
    expect(await inTx((tx) => updateDraftRow(tx, admin(), "scheme-2026-11", withBevTier80(9), 0, 0))).toBeNull();
    expect(await inTx((tx) => updateDraftRow(tx, admin(), "scheme-2026-11", withBevTier80(9), 1, 7))).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(await inTx((tx) => updateDraftRow(tx, admin(), "scheme-2026-11", withBevTier80(9), 1, 0))).toEqual({ draftRev: 1 });
    expect((await schemeRow("demo-co", NOV))!.draft).toEqual(withBevTier80(9));
    // and another company's admin cannot reach the row at all
    const other = await otherAdmin();
    expect(await inTx((tx) => updateDraftRow(tx, other, "scheme-2026-11", [], 1, 1))).toBeNull();
  });
});

describe("lock order with moveLine", () => {
  it("moveLine locks the company's lines in id order and the renumbering is unchanged", async () => {
    const proto = Object.getPrototypeOf(db.select().from(s.targetLines));
    const original = proto.for;
    const locks: { sql: string; params: unknown[] }[] = [];
    const spy = vi.spyOn(proto, "for").mockImplementation(function (this: { toSQL(): { sql: string; params: unknown[] } }, ...args: unknown[]) {
      const q = original.apply(this, args);
      locks.push(q.toSQL());
      return q;
    });
    try {
      expect(await moveLine(admin(), "coll", "up")).toEqual({ ok: true });
    } finally {
      spy.mockRestore();
    }
    const lock = locks.find((q) => /for update/i.test(q.sql) && q.sql.includes('"target_lines"'));
    expect(lock).toBeDefined();
    expect(lock!.sql).toMatch(/order by "target_lines"\."id"(\s+asc)?\s+for update/i);
    expect(lock!.sql).not.toMatch(/"target_lines"\."sort"/);
    const rows = await db.select().from(s.targetLines).where(eq(s.targetLines.companyId, "demo-co"));
    expect(rows.sort((a, b) => a.sort - b.sort).map((r) => r.code)).toEqual(["bev", "coll", "food"]);
  });
});

describe("minor rulings", () => {
  it("getSchemeEditor with an invalid month answers invalid_period instead of throwing", async () => {
    expect(await getSchemeEditor(admin(), { year: 2026, month: 13 })).toEqual({ ok: false, error: "invalid_period" });
    expect(await getSchemeEditor(admin(), { year: 1999, month: 1 })).toEqual({ ok: false, error: "invalid_period" });
  });

  it("a focus item that is no longer in the month shows as unknown_focus in issuesInPublished", async () => {
    await db.update(s.focusItems).set({ startsOn: "2027-01-01", endsOn: "2027-01-31" }).where(eq(s.focusItems.id, "mango"));
    const e = await ed(admin(), NOV);
    expect(e.issuesInPublished).toEqual([{ path: "components.3.condition.focusItemId", code: "unknown_focus" }]);
    // the rep's screen still renders
    expect((await getCommissionView(ahmed(), { ...NOV, today: TODAY })).actual.total).toBe(41_400);
  });

  it("republishing November leaves October's history commission unchanged and changes November's", async () => {
    await db.insert(s.targets).values({ id: "t-oct", companyId: "demo-co", userId: "ahmed", year: 2026, month: 10, lineId: "bev", amount: 1000 });
    await db.insert(s.dailyCloses).values({ id: "close-oct", companyId: "demo-co", userId: "ahmed", date: "2026-10-05", status: "confirmed", source: "manual", sold: 900, loaded: 900 });
    await db.insert(s.closeLines).values({ id: "cl-oct", companyId: "demo-co", closeId: "close-oct", lineId: "bev", amount: 900 });
    const octScheme: Component[] = [{ id: "o_bev", type: "tiered", label: "شرائح أكتوبر", lineId: "bev", tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 4242 } }] }];
    await db.insert(s.schemes).values({ id: "scheme-2026-10", companyId: "demo-co", name: "أكتوبر 2026", year: 2026, month: 10, components: octScheme, published: true, version: 1 });

    const commissions = async () => Object.fromEntries((await getHistoryMonths(ahmed(), { today: TODAY })).map((m) => [m.month, m.commission]));
    const before = await commissions();
    expect(before).toEqual({ 10: 4242, 11: 41_400 });

    await saveDraft(admin(), { ...NOV, components: withBevTier80(200_000), expectedVersion: 1, expectedDraftRev: 0 });
    await publishScheme(admin(), { ...NOV, expectedVersion: 1, expectedDraftRev: 1 });
    const after = await commissions();
    expect(after[10]).toBe(4242);
    expect(after[11]).toBe(41_400); // actual so far is below every bev tier, so the change only shows in the projection
    expect((await getCommissionView(ahmed(), { ...NOV, today: TODAY })).projected.total).toBe(397_855);
  });
});
