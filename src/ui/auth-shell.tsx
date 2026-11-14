import { getTranslations } from "next-intl/server";

/** Blue header band with the product name above a white body, shared by the auth pages. */
export async function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = await getTranslations("app");
  return (
    <div className="min-h-dvh bg-white">
      <header className="bg-brand px-4 py-4 text-white">
        <p className="text-lg font-semibold">{t("name")}</p>
      </header>
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-ink">{title}</h1>
        {children}
      </main>
    </div>
  );
}
