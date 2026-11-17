import { getTranslations } from "next-intl/server";

/** Admin sign-in and invite pages: a centred white card on the canvas, with the rep sign-in's type. */
export async function AdminAuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  const t = await getTranslations("app");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <main className="w-full max-w-md rounded-xl border border-line bg-white px-8 py-8">
        <p className="mb-6 text-lg font-semibold text-brand">{t("name")}</p>
        <h1 className="mb-6 text-2xl font-semibold text-ink">{title}</h1>
        {children}
      </main>
    </div>
  );
}
