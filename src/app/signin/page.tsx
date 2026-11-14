import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/ui/auth-shell";
import { SignInForm } from "./signin-form";

export default async function SignInPage() {
  const t = await getTranslations("auth");
  return (
    <AuthShell title={t("signin.heading")}>
      <SignInForm />
    </AuthShell>
  );
}
