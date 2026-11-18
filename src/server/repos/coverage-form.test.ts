import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { parseCoverageForm, saveCoverageForm } from "./coverage-form";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("parseCoverageForm", () => {
  it("reads Western and Arabic-Indic digits and separators into whole counts", () => {
    expect(parseCoverageForm(form({ repId: "ahmed", lineId: "cov", covered: "١٠٢", total: "1,200", asOf: " 2026-11-10 " }))).toEqual({
      ok: true,
      input: { repId: "ahmed", lineId: "cov", covered: 102, total: 1200, asOf: "2026-11-10" },
    });
  });

  it("flags a blank or non-numeric count as invalid instead of saving 0", () => {
    expect(parseCoverageForm(form({ repId: "ahmed", lineId: "cov", covered: "", total: "abc", asOf: "2026-11-10" }))).toEqual({
      ok: false,
      errors: { covered: "invalid", total: "invalid" },
    });
    expect(parseCoverageForm(form({ repId: "ahmed", lineId: "cov", covered: "1.5", total: "10", asOf: "2026-11-10" }))).toMatchObject({
      ok: false,
      errors: { covered: "invalid" },
    });
  });
});

describe("saveCoverageForm", () => {
  let db: Db;
  const ctx = (userId: string, role: Ctx["role"]): Ctx => ({ db, companyId: "demo-co", userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
  beforeEach(async () => {
    db = await createTestDb();
    await seedDemo(db);
    await db.insert(s.targetLines).values({
      id: "cov", companyId: "demo-co", code: "cov", nameAr: "ت", nameEn: "C", nameUr: "ک", unit: "outlets", kind: "coverage", sort: 4,
    });
  });
  const data = (repId: string, covered = "50") => form({ repId, lineId: "cov", covered, total: "120", asOf: "2026-11-10" });

  it("saves and reports the line", async () => {
    expect(await saveCoverageForm(ctx("sami", "supervisor"), data("ahmed"), { today: "2026-11-14" })).toEqual({ errors: {}, saved: "cov" });
  });

  it("with `own`, ignores the posted rep id and writes for the signed-in rep", async () => {
    await saveCoverageForm(ctx("ahmed", "rep"), data("khaled"), { today: "2026-11-14", own: true });
    expect((await db.select().from(s.coverageUpdates)).map((r) => r.userId)).toEqual(["ahmed"]);
  });

  it("returns the field errors, and not_found for a rep the caller may not update", async () => {
    expect(await saveCoverageForm(ctx("sami", "supervisor"), data("omar"), { today: "2026-11-14" })).toEqual({ errors: { repId: "not_found" } });
    expect(await saveCoverageForm(ctx("sami", "supervisor"), data("ahmed", "130"), { today: "2026-11-14" })).toEqual({
      errors: { covered: "covered_above_total" },
    });
    expect(await db.select().from(s.coverageUpdates)).toEqual([]);
  });
});
