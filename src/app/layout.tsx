import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { dirOf, type Locale } from "@/i18n/config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name") };
}

export default async function RootLayout({ children }: {
  children: React.ReactNode;
}) {
  const locale = (await getLocale()) as Locale;
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body
        className="min-h-dvh"
        style={locale === "ur" ? { fontFamily: "var(--font-urdu)" } : undefined}
      >
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
