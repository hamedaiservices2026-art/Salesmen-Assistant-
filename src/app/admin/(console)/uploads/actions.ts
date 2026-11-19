"use server";

import { revalidatePath } from "next/cache";
import type { RowError } from "@/domain/import/rows";
import { STORED_ERRORS, processUpload, readUploadFile, rejectUpload, singleFlight, type UploadResult } from "@/server/admin/uploads";
import { requireRole } from "@/server/auth/guard";
import type { ReadError, SheetKind } from "@/server/import/xlsx";

export type UploadState = {
  kind?: SheetKind;
  filename?: string;
  /** The request never reached the apply step. */
  failure?: "no_file" | "busy" | "failed" | "bad_kind";
  result?: {
    applied: boolean;
    rows: number;
    /** The full count; `errors` holds at most the first 200. */
    errorCount: number;
    errors: RowError[];
    readError?: ReadError;
    missing?: string[];
    duplicates?: string[];
  };
};

const isKind = (k: unknown): k is SheetKind => k === "targets" || k === "daily";

// The caller's company, role and id come from the session, never from the form. The file is checked
// against the size limit before its bytes are read, and one admin runs one upload at a time.
export async function uploadAction(_prev: UploadState, form: FormData): Promise<UploadState> {
  const ctx = await requireRole(["admin"]);
  const kind = form.get("kind");
  if (!isKind(kind)) return { failure: "bad_kind" };
  const file = form.get("file");
  if (!(file instanceof File) || file.name === "") return { kind, failure: "no_file" };

  let outcome;
  try {
    outcome = await singleFlight(`${ctx.companyId}|${ctx.userId}`, async (): Promise<UploadResult> => {
      const read = await readUploadFile(file);
      if (!read.ok) return rejectUpload(ctx, { kind, filename: file.name }, read.error);
      return processUpload(ctx, { kind, filename: file.name, data: read.data });
    });
  } catch {
    return { kind, filename: file.name, failure: "failed" };
  }
  if (outcome.busy) return { kind, filename: file.name, failure: "busy" };
  const r = outcome.value;
  revalidatePath("/admin/uploads");
  if (r.applied) {
    revalidatePath("/admin/targets");
    revalidatePath("/admin");
  }
  return {
    kind,
    filename: file.name,
    result: {
      applied: r.applied,
      rows: r.rows,
      errorCount: r.errors.length,
      errors: r.errors.slice(0, STORED_ERRORS),
      ...(r.readError ? { readError: r.readError } : {}),
      ...(r.missing ? { missing: r.missing } : {}),
      ...(r.duplicates ? { duplicates: r.duplicates } : {}),
    },
  };
}
