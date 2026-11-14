import { getTranslations } from "next-intl/server";

export default async function AssistantPage() {
  const t = await getTranslations("assistant");
  return (
    <>
      <header className="bg-brand px-5 py-4 text-white">
        <h1 className="m-0 text-[18px] font-bold">{t("title")}</h1>
      </header>
      <main className="flex-1 px-5 py-6">
        <p className="m-0 text-base text-ink-2">{t("soon")}</p>
      </main>
    </>
  );
}
