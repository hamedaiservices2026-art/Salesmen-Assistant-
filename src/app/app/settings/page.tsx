import { Check } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES, LOCALE_ENDONYM } from "@/i18n/config";
import { SignOutForm } from "@/ui/components/SignOutForm";
import { signOutAction } from "@/app/(auth-actions)/actions";
import { AI_NOTICE_VERSION } from "@/server/ai/availability";
import { aiNoticeAccepted } from "@/server/ai/consent";
import { requireCtx } from "@/server/auth/guard";
import { AiNotice } from "@/ui/components/AiNotice";
import { getLogin } from "@/server/repos/profile";
import { setLocaleAction } from "./actions";
import { ChangePinForm } from "./change-pin-form";


export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [t, locale, login, aiAccepted] = await Promise.all([
    getTranslations("settings"),
    getLocale(),
    getLogin(ctx),
    aiNoticeAccepted(ctx),
  ]);
  return (
    <>
      <header className="bg-brand px-5 py-4 text-white">
        <h1 className="m-0 text-[18px] font-bold">{t("title")}</h1>
      </header>
      <main className="flex flex-1 flex-col gap-6 px-5 pb-4 pt-[18px]">
        <section aria-labelledby="lang-title" className="flex flex-col gap-2.5">
          <h2 id="lang-title" className="m-0 text-[15px] font-bold">
            {t("languageTitle")}
          </h2>
          <form action={setLocaleAction}>
            <ul
              aria-label={t("languageLabel")}
              className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-line p-0"
            >
              {LOCALES.map((code) => {
                const current = code === locale;
                return (
                  <li
                    key={code}
                    className="border-b border-line-soft last:border-b-0"
                  >
                    <button
                      type="submit"
                      name="locale"
                      value={code}
                      lang={code}
                      aria-current={current ? "true" : undefined}
                      className={
                        "flex min-h-[52px] w-full items-center justify-between gap-3 border-0 px-4 text-start text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink " +
                        (current
                          ? "bg-brand-tint font-bold text-brand"
                          : "bg-white font-medium text-ink")
                      }
                    >
                      {LOCALE_ENDONYM[code]}
                      {current && (
                        <Check aria-hidden="true" size={22} strokeWidth={2} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </form>
        </section>
        <section aria-labelledby="pin-title" className="flex flex-col gap-2.5">
          <h2 id="pin-title" className="m-0 text-[15px] font-bold">
            {t("pin.title")}
          </h2>
          <ChangePinForm />
        </section>
        <section aria-labelledby="ai-title" className="flex flex-col gap-2.5">
          <h2 id="ai-title" className={`m-0 text-[15px] font-bold ${locale === "ur" ? "leading-[2.2]" : ""}`}>
            {t("ai.title")}
          </h2>
          <AiNotice accepted={aiAccepted} version={AI_NOTICE_VERSION} />
        </section>
        <SignOutForm action={signOutAction} className="flex flex-col gap-2">
          <p className="m-0 flex flex-wrap items-baseline gap-2 text-[15px]">
            <span className="text-ink-2">{t("loginLabel")}</span>
            <strong dir="ltr" className="select-all text-[18px]">
              {login}
            </strong>
          </p>
          <button
            type="submit"
            className="flex min-h-[52px] items-center justify-center rounded-xl border border-line bg-white text-base font-bold text-ink hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {t("signOut")}
          </button>
          <p className="m-0 text-[13px] text-ink-2">{t("signOutNote")}</p>
        </SignOutForm>
      </main>
    </>
  );
}
