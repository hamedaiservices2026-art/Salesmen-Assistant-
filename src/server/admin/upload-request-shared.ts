import type { RowError } from "@/domain/import/rows";
import type { ReadError, SheetKind } from "@/server/import/xlsx";

/** The columns of each sheet kind, in the order of the template. Client-safe: the upload card shows them too. */
export const COLUMNS: Record<SheetKind, readonly string[]> = {
  targets: ["login", "year", "month", "line", "amount"],
  daily: ["login", "date", "line", "amount"],
};

export const isKind = (k: unknown): k is SheetKind => k === "targets" || k === "daily";

/** The browser sends this header with every upload; a plain cross-site form post cannot. */
export const REQUESTED_WITH = "upload";

export type UploadResponse = {
  kind?: SheetKind;
  filename?: string;
  /** The request never reached the apply step. */
  failure?: "no_file" | "busy" | "failed" | "bad_kind" | "too_large" | "forbidden" | "bad_request";
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

/**
 * What the browser does with the upload endpoint's reply: parse it, or show a failure. A 413 comes from
 * the platform in front of the app (the file is over its limit) and an error page is not JSON; neither
 * may reach `res.json()`.
 */
export function replyKind(status: number, contentType: string | null): "json" | "too_large" | "failed" {
  if (status === 413) return "too_large";
  return (contentType ?? "").toLowerCase().includes("application/json") ? "json" : "failed";
}
