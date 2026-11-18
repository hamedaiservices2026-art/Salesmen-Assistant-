"use server";

import { revalidatePath } from "next/cache";
import type { SchemeIssue } from "@/domain/commission";
import { previewScheme, publishScheme, saveDraft, type PreviewResult, type SaveDraftResult } from "@/server/admin/schemes";
import { requireRole } from "@/server/auth/guard";
import { currentDay } from "@/server/today";
import { parseYm } from "../targets/ym";

// The caller's company and role come from the session (`requireRole`); the form carries only the
// month, the typed components and the two concurrency tokens. The server functions check
// everything again and stay the authority.

const MAX_JSON = 400_000;
const shape = (path: string): { ok: false; issues: SchemeIssue[] } => ({ ok: false, issues: [{ path, code: "shape" }] });

function readComponents(form: FormData): { ok: true; value: unknown } | { ok: false } {
  const raw = form.get("components");
  if (typeof raw !== "string" || raw.length > MAX_JSON) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}
const token = (form: FormData, name: string): number => Number(form.get(name));

/** What one rep would see with these components as the month's plan (nothing is saved). */
export async function previewSchemeAction(form: FormData): Promise<PreviewResult> {
  const ctx = await requireRole(["admin"]);
  const ym = parseYm(String(form.get("ym") ?? ""));
  const components = readComponents(form);
  if (!ym || !components.ok) return shape("period");
  return previewScheme(ctx, {
    ...ym,
    components: components.value,
    repId: String(form.get("repId") ?? ""),
    today: currentDay(ctx.timeZone),
  });
}

export async function saveDraftAction(form: FormData): Promise<SaveDraftResult> {
  const ctx = await requireRole(["admin"]);
  const ym = parseYm(String(form.get("ym") ?? ""));
  const components = readComponents(form);
  if (!ym || !components.ok) return shape("period");
  const result = await saveDraft(ctx, {
    ...ym,
    components: components.value,
    expectedVersion: token(form, "expectedVersion"),
    expectedDraftRev: token(form, "expectedDraftRev"),
  });
  if (result.ok) revalidatePath("/admin/schemes");
  return result;
}

export type PublishActionResult =
  | { ok: true; version: number; /** The draft revision after the publish (it clears the draft and adds one). */ draftRev: number }
  | { ok: false; issues: SchemeIssue[] }
  | { ok: false; error: "stale" | "no_draft" };

export async function publishSchemeAction(form: FormData): Promise<PublishActionResult> {
  const ctx = await requireRole(["admin"]);
  const ym = parseYm(String(form.get("ym") ?? ""));
  if (!ym) return shape("period");
  const expectedDraftRev = token(form, "expectedDraftRev");
  const result = await publishScheme(ctx, { ...ym, expectedVersion: token(form, "expectedVersion"), expectedDraftRev });
  if (!result.ok) return result;
  revalidatePath("/admin/schemes");
  revalidatePath("/app/commission");
  // The publish's conditional write took the draft revision from `expectedDraftRev` to one more.
  return { ok: true, version: result.version, draftRev: expectedDraftRev + 1 };
}
