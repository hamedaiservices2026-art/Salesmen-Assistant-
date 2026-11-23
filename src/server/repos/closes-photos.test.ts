import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { saveUpload } from "@/server/files/files";
import { localStore } from "@/server/files/local-store";
import { getClose, saveClose } from "./closes";

// The photo is valid when the close is checked, but gone by the time it is attached (the sweep or a
// removal got in between). `attachFiles` then reports it; this stands in for that race (R70).
const race = vi.hoisted(() => ({ missing: [] as string[] }));
vi.mock("@/server/files/files", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/files/files")>();
  return {
    ...real,
    attachFiles: async (...args: Parameters<typeof real.attachFiles>) => {
      const r = await real.attachFiles(...args);
      return { missing: [...r.missing, ...race.missing] };
    },
  };
});

let db: Db;
let root: string;
beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
  root = await mkdtemp(path.join(tmpdir(), "close-race-"));
  race.missing = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ahmed = (): Ctx => ({ db, companyId: "demo-co", userId: "ahmed", role: "rep", locale: "ar", timeZone: "Asia/Riyadh" });

describe("saveClose when a photo disappears between the check and the attach (R70)", () => {
  it("rolls everything back and names the photo as expired: never a silent loss", async () => {
    const jpeg = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer());
    const up = await saveUpload(ahmed(), { kind: "return", date: "2026-11-14", bytes: jpeg }, { store: localStore(root), today: "2026-11-14" });
    if (!up.ok) throw new Error(up.error);
    race.missing = [up.id];
    const form = {
      date: "2026-11-14",
      lines: { bev: 120, food: 800_000, coll: 2_000_000 },
      focus: {},
      cashSales: 100_000,
      creditSales: 0,
      collections: 0,
      expenses: 0,
      loaded: 0,
      sold: 0,
      returned: 0,
      returns: [{ description: "كولا", quantity: 3, reason: "expired" as const, photos: [up.id] }],
      note: "",
    };
    expect(await saveClose(ahmed(), form, { today: "2026-11-14" })).toEqual({
      ok: false,
      errors: { "returns.0.photos": "expired", [`photo.${up.id}`]: "expired" },
    });
    expect(await getClose(ahmed(), "2026-11-14")).toBeNull();
    const [row] = await db.select().from(s.files).where(eq(s.files.id, up.id));
    expect(row!.closeId).toBeNull();
  });
});
