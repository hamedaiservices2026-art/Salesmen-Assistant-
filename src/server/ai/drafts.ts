import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { ISODate } from "@/domain/calendar";
import { isFileId } from "@/domain/files";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { assertOwnContext } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

/** A receipt is valid this long after it is made (Global Constraints: draft and receipt lifetime). */
export const RECEIPT_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const SWEEP_BATCH = 1000;

export type DraftSource = "photo" | "voice";

/**
 * Records that the caller was handed a draft for `date`, read from a photo (with its report file)
 * or a voice note. Returns the receipt id (32 hex characters). The receipt holds no extracted
 * value; it only lets the confirmed close be stamped with its source.
 */
export async function createDraftReceipt(
  ctx: Ctx,
  input: { date: ISODate; source: DraftSource; fileId: string | null },
  now: Date = new Date(),
): Promise<string> {
  assertOwnContext(ctx);
  const id = randomBytes(16).toString("hex");
  await ctx.db.insert(s.aiDrafts).values({
    id,
    companyId: ctx.companyId,
    userId: ctx.userId,
    date: input.date,
    source: input.source,
    fileId: input.fileId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + RECEIPT_HOURS * HOUR_MS),
  });
  return id;
}

/**
 * Uses the caller's receipt `id` for his close on `date`, inside the caller's transaction `tx`.
 * One conditional UPDATE: it matches only an unused, unexpired receipt of the caller's company and
 * user for that very date, so a receipt cannot be replayed, borrowed by another rep or company, or
 * used on another day; of two saves racing with one receipt only one gets it. Anything else
 * (unknown, malformed, someone else's, expired, used, another date) is null, the same for all.
 */
export async function consumeDraftReceipt(
  tx: Db,
  ctx: Ctx,
  input: { id: string; date: ISODate },
  now: Date,
): Promise<{ source: DraftSource; fileId: string | null } | null> {
  assertOwnContext(ctx);
  if (!isFileId(input.id)) return null;
  const [hit] = await tx
    .update(s.aiDrafts)
    .set({ usedAt: now })
    .where(
      and(
        eq(s.aiDrafts.id, input.id),
        eq(s.aiDrafts.companyId, ctx.companyId),
        eq(s.aiDrafts.userId, ctx.userId),
        eq(s.aiDrafts.date, input.date),
        isNull(s.aiDrafts.usedAt),
        gt(s.aiDrafts.expiresAt, now),
      ),
    )
    .returning({ source: s.aiDrafts.source, fileId: s.aiDrafts.fileId });
  return hit ? { source: hit.source, fileId: hit.fileId } : null;
}

/**
 * Deletes receipts that expired at least 24 hours ago (R59), at most 1000 per call, and returns the
 * number deleted (R28). System maintenance: across companies by design. Runs before the photo
 * sweep (R28); `file_id` is ON DELETE SET NULL in any case.
 */
export async function sweepDrafts(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RECEIPT_HOURS * HOUR_MS);
  const batch = db.select({ id: s.aiDrafts.id }).from(s.aiDrafts).where(lte(s.aiDrafts.expiresAt, cutoff)).limit(SWEEP_BATCH);
  const deleted = await db.delete(s.aiDrafts).where(inArray(s.aiDrafts.id, batch)).returning({ id: s.aiDrafts.id });
  return deleted.length;
}
