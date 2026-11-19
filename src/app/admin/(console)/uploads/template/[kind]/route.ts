import { isDailyLine } from "@/domain/lines";
import { requireRole } from "@/server/auth/guard";
import { loadLines } from "@/server/repos/month-data";
import { buildTemplate, type SheetKind } from "@/server/import/xlsx";

const FILES: Record<SheetKind, string> = { targets: "targets-template.xlsx", daily: "daily-template.xlsx" };
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const isKind = (k: string): k is SheetKind => k === "targets" || k === "daily";

/**
 * The upload template, admin only. A caller who is not a signed-in admin is redirected by `requireRole`
 * before anything is read; the lines sheet lists only the caller's own company's active lines
 * (coverage lines have their own page).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }): Promise<Response> {
  const ctx = await requireRole(["admin"]);
  const { kind } = await params;
  if (!isKind(kind)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const lines = (await loadLines(ctx)).filter(isDailyLine);
  const file = await buildTemplate(kind, lines.map((l) => ({ code: l.code, nameAr: l.nameAr, unit: l.unit })));
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="${FILES[kind]}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
