import { getTranslations } from "next-intl/server";
import type { Topic } from "@/domain/assistant/topics";
import type { AskSummary } from "@/server/admin/ask-summary";
import { Card } from "./Card";

/** "What reps ask about": topics and how many reps asked, never who. A topic reaches this card only after the server's threshold. */
export async function AskCard({ summary, lead = "" }: { summary: AskSummary; lead?: string }) {
  const t = await getTranslations("admin.ask");
  return (
    <Card title={t("title")} className={`flex flex-col gap-1 pb-4 ${lead}`}>
      <p className="m-0 px-5 pb-1 text-[13.5px] text-ink-2">{t("subtitle")}</p>
      {summary.state === "too_few" ? (
        <p className="m-0 px-5 py-2 text-[14.5px] text-ink-2">{t("tooFew")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col px-5 p-0">
          {summary.topics.map((row) => (
            <li key={row.topic} className="flex min-h-11 items-center justify-between gap-3 border-t border-line-soft py-2 text-[14.5px]">
              <span>{t(`topic.${row.topic as Exclude<Topic, "other">}`)}</span>
              <span className="whitespace-nowrap font-bold tabular-nums">{t("reps", { reps: row.reps })}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="m-0 px-5 pt-1 text-[12.5px] text-muted">{t("note")}</p>
    </Card>
  );
}
