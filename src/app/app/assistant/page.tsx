import { getTranslations } from "next-intl/server";

// The assistant's server action (Task 17) runs on this page: provider calls need up to 60 s (R33).
export const maxDuration = 60;

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
