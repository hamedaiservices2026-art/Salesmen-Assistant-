import type { RowError } from "@/domain/import/rows";
import type { ReadError, SheetKind } from "@/server/import/xlsx";

/** The browser sends this header with every upload; a plain cross-site form post cannot. */
export const REQUESTED_WITH = "upload";

export type UploadResponse = {
  kind?: SheetKind;
  filename?: string;
  /** The request never reached the apply step. */
  failure?: "no_file" | "busy" | "failed" | "bad_kind" | "too_large" | "forbidden";
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
