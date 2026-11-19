"use server";

import { redirect } from "next/navigation";
import { isDailyLine } from "@/domain/lines";
import { requireCtx } from "@/server/auth/guard";
import { saveClose } from "@/server/repos/closes";
import { getMonthView } from "@/server/repos/month-view";
import { currentDay } from "@/server/today";
import { closeMonth, focusOn } from "./close-date";
import { parseCloseForm, returnIndexes } from "./parse-form";

export type CloseState = { errors: Record<string, string> };

/** Field names the form uses for the keys `saveClose` reports. */
function formFieldErrors(errors: Record<string, string>, kept: number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, code] of Object.entries(errors)) {
    const ret = /^returns\.(\d+)\.(\w+)$/.exec(key);
    if (ret) out[`ret.${kept[Number(ret[1])] ?? ret[1]}.${ret[2]}`] = code;
    else out[key.startsWith("lines.") ? `line.${key.slice(6)}` : key] = code;
  }
  return out;
}

export async function saveCloseAction(_prev: CloseState, data: FormData): Promise<CloseState> {
  const ctx = await requireCtx();
  const today = currentDay(ctx.timeZone);
  const posted = data.get("date");
  const date = typeof posted === "string" ? posted.trim() : "";
  const { year, month } = closeMonth(date, today);
  const view = await getMonthView(ctx, { year, month, today });

  const parsed = parseCloseForm(
    data,
    view.lines
      .filter(isDailyLine)
      .map((l) => ({ lineId: l.lineId, unit: l.unit, kind: l.kind, optional: l.createdOn > date })),
    focusOn(view.focus, date).map((f) => ({ id: f.id, unit: f.unit })),
  );
  if (!parsed.ok) return { errors: parsed.errors };

  const result = await saveClose(ctx, parsed.form, { today });
  if (!result.ok) return { errors: formFieldErrors(result.errors, returnIndexes(data)) };
  redirect("/app");
}
