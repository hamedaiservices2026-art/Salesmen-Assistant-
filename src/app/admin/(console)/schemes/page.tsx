import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import * as s from "@/db/schema";
import { lineName } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { listAllLines } from "@/server/admin/lines";
import { getSchemeEditor } from "@/server/admin/schemes";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { currentDay } from "@/server/today";
import { PageHeader } from "@/ui/admin/PageHeader";
import type { FormRefs } from "@/ui/admin/scheme-form";
import { INTL_TAG } from "@/ui/intl-tag";
import { unitLabel } from "@/ui/unit-label";
import { componentLabel } from "@/domain/commission";
import { formatYm, inRange, parseYm, shiftMonth, type Ym } from "../targets/ym";
import { SchemeEditor } from "./scheme-editor";

const navLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[14px] font-semibold text-brand hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const tabBase =
  "inline-flex min-h-11 items-center rounded-[10px] px-4 text-[14.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function SchemesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, tAll, locale, prefs, { ym: ymParam }] = await Promise.all([
    getTranslations("admin.schemes"),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getCompanyPrefs(ctx),
    searchParams,
  ]);
  const today = currentDay(prefs.timeZone);
  const current: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  // A malformed month falls back to the company's current one.
  const period = parseYm(ymParam) ?? current;
  const editor = await getSchemeEditor(ctx, period);
  if (!editor.ok) throw new Error("invalid period after parseYm");

  const [allLines, focusRows] = await Promise.all([
    listAllLines(ctx),
    editor.refs.focus.length === 0
      ? Promise.resolve([])
      : ctx.db
          .select({ id: s.focusItems.id, name: s.focusItems.name, unit: s.focusItems.unit })
          .from(s.focusItems)
          .where(
            and(
              eq(s.focusItems.companyId, ctx.companyId),
              inArray(s.focusItems.id, editor.refs.focus.map((f) => f.id)),
            ),
          ),
  ]);
  const active = new Set(editor.refs.lines.map((l) => l.id));
  const lines = allLines.filter((l) => active.has(l.lineId)).map((l) => ({ id: l.lineId, name: lineName(l, locale), unit: l.unit }));
  const focusUnit = new Map(focusRows.map((f) => [f.id, f.unit as Unit]));
  const focus = focusRows.map((f) => ({ id: f.id, name: f.name, unit: f.unit as Unit }));
  const refs: FormRefs = {
    lines: editor.refs.lines,
    focus: editor.refs.focus.map((f) => ({ ...f, unit: focusUnit.get(f.id) })),
    period: editor.refs.period,
  };

  const intl = INTL_TAG[locale];
  const monthName = (p: Ym) =>
    new Intl.DateTimeFormat(`${intl}-u-nu-latn`, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(p.year, p.month - 1, 1)),
    );
  const stamp = new Intl.DateTimeFormat(`${intl}-u-nu-latn`, { dateStyle: "medium", timeZone: ctx.timeZone });
  const newest = editor.history[0];
  const latest = newest ? { version: newest.version, byName: newest.byName, at: stamp.format(newest.at) } : null;
  const unitLabels: Record<Unit, string> = {
    cases: unitLabel(tAll, "cases", prefs.currency),
    value: unitLabel(tAll, "value", prefs.currency),
    outlets: unitLabel(tAll, "outlets", prefs.currency),
  };

  // The published plan's own problems, named by its parts (they may differ from the draft being edited).
  const publishedProblems = editor.issuesInPublished.map((i) => {
    const at = /^components\.(\d+)/.exec(i.path)?.[1];
    const c = at === undefined ? undefined : editor.published?.[Number(at)];
    const message = t(`errors.${i.code}`);
    return c ? `${componentLabel(c, locale)}: ${message}` : message;
  });

  const prev = shiftMonth(period, -1);
  const next = shiftMonth(period, 1);
  const flip = "rtl:-scale-x-100";
  const ymText = formatYm(period);

  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <nav aria-label={t("monthNav")} className="flex items-center gap-2.5">
            {inRange(prev) ? (
              <Link href={`/admin/schemes?ym=${formatYm(prev)}`} className={navLink} aria-label={t("prevMonth")}>
                <ChevronLeft size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
            <span className="min-w-36 text-center text-[15px] font-bold text-ink">{monthName(period)}</span>
            {inRange(next) ? (
              <Link href={`/admin/schemes?ym=${formatYm(next)}`} className={navLink} aria-label={t("nextMonth")}>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
          </nav>
        }
      />
      <nav aria-label={t("tabs.label")} className="flex flex-wrap gap-2 border-b border-line pb-3">
        <span aria-current="page" className={`${tabBase} bg-brand text-white`}>
          {t("tabs.commission")}
        </span>
        <Link href="/admin/incentives" className={`${tabBase} border border-line bg-white text-brand hover:bg-brand-tint`}>
          {t("tabs.incentives")}
        </Link>
        <Link href="/admin/focus" className={`${tabBase} border border-line bg-white text-brand hover:bg-brand-tint`}>
          {t("tabs.focus")}
        </Link>
      </nav>
      {publishedProblems.length > 0 && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-[14px] bg-alert-tint px-5 py-3.5 text-alert">
          <p className="m-0 flex items-center gap-2 text-[14.5px] font-bold">
            <CircleAlert size={20} strokeWidth={1.8} aria-hidden />
            {t("publishedIssues.title")}
          </p>
          <p className="m-0 text-[13.5px]">{t("publishedIssues.body")}</p>
          <ul className="m-0 list-none p-0 text-[13.5px]">
            {publishedProblems.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <SchemeEditor
        key={`${ymText}`}
        ym={ymText}
        initial={editor.draft ?? editor.published ?? []}
        hasDraft={editor.draft !== null}
        version={editor.version}
        draftRev={editor.draftRev}
        latest={latest}
        refs={refs}
        lines={lines}
        focus={focus}
        reps={editor.reps}
        currencyLabel={unitLabels.value}
        unitLabels={unitLabels}
      />
    </main>
  );
}
