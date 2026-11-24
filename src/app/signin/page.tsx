import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LAST_LOGIN_COOKIE } from "@/server/auth/last-login";
import { AuthShell } from "@/ui/auth-shell";
import { ClearDrafts } from "@/ui/clear-drafts";
import { SignInForm } from "./signin-form";

export default async function SignInPage() {
  const t = await getTranslations("auth");
  const lastLogin = (await cookies()).get(LAST_LOGIN_COOKIE)?.value ?? "";
  return (
    <AuthShell title={t("signin.heading")}>
      <ClearDrafts />
      <SignInForm defaultLogin={lastLogin} />
    </AuthShell>
  );
}
