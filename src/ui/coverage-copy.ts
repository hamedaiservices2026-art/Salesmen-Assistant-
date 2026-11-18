import { coveragePct } from "@/domain/coverage";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Wraps a name so a right-to-left sentence keeps it intact whatever its script. */
export const isolate = (name: string): string => `⁨${name}⁩`;

/** A left-to-right run (a percent such as `50%`) inside a right-to-left sentence, so the sign stays after the digits. */
const ltr = (text: string): string => `⁦${text}⁩`;

/** The two lines that describe a coverage update: the figures and who updated it when (`dateText` already formatted). */
export function coverageSummary(
  t: Translate,
  info: { covered: number; total: number; enteredByName: string },
  dateText: string,
): { figures: string; lastUpdate: string } {
  return {
    figures: t("figures", { covered: info.covered, total: info.total, pct: ltr(`${coveragePct(info) ?? 0}%`) }),
    lastUpdate: t("lastUpdate", { date: dateText, name: isolate(info.enteredByName) }),
  };
}

/** "You need {more} more customers to reach {nextPct}%". */
export function coverageNeedText(t: Translate, need: { more: number; nextPct: number }): string {
  return t("need", { more: need.more, nextPct: ltr(`${need.nextPct}%`) });
}
