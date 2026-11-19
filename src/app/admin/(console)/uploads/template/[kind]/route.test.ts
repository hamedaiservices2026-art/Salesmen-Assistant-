import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { GET } from "./route";

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
vi.mock("@/db/client", () => ({ getDb: async () => h.db }));

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  h.db = db;
  h.jar.clear();
  seed = await seedDemo(db);
});

const call = (kind: string) => GET(new Request("http://x/admin/uploads/template/" + kind), { params: Promise.resolve({ kind }) });

describe("GET /admin/uploads/template/[kind]", () => {
  it("an admin gets an attachment with the company's non-coverage lines", async () => {
    await db.insert(s.targetLines).values({
      id: "demo-co-cov", companyId: "demo-co", code: "cov", nameAr: "تغطية", nameEn: "", nameUr: "", unit: "outlets", kind: "coverage", sort: 9, active: true,
    });
    await db.insert(s.targetLines).values({
      id: "platform-secret", companyId: "platform", code: "secret", nameAr: "سري", nameEn: "", nameUr: "", unit: "cases", kind: "sales", sort: 1, active: true,
    });
    h.jar.set("session", await createSession(db, seed.adminId));
    const res = await call("daily");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="daily-template.xlsx"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const codes = wb.getWorksheet("الخطوط")!.getColumn(1).values.slice(2);
    expect(codes).toEqual(["bev", "food", "coll"]);
  });

  it("an unknown kind is 404 for an admin", async () => {
    h.jar.set("session", await createSession(db, seed.adminId));
    for (const kind of ["other", "TARGETS", "targets.xlsx", "..%2f"]) expect((await call(kind)).status).toBe(404);
  });

  it("no session and a rep session get no file", async () => {
    await expect(call("targets")).rejects.toBeInstanceOf(h.Redirect);
    h.jar.set("session", await createSession(db, "ahmed"));
    await expect(call("targets")).rejects.toBeInstanceOf(h.Redirect);
    h.jar.set("session", await createSession(db, seed.ownerId));
    await expect(call("targets")).rejects.toBeInstanceOf(h.Redirect);
  });
});
