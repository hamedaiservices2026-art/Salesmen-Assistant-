import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { peekInvite } from "@/server/auth/invites";
import { AuthShell } from "@/ui/auth-shell";
import { InviteForm } from "./invite-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const invite = await peekInvite(await getDb(), token);
  if (!invite) {
    return (
      <AuthShell title={t("signin.heading")}>
        <p role="alert" className="rounded-lg bg-alert-tint px-4 py-3 text-base text-alert">
          {t("errors.invite_invalid")}
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={t("invite.heading", { name: invite.name })}>
      <p className="m-0 mb-5 text-lg text-ink-2">
        {t("invite.yourLogin")}{" "}
        <strong dir="ltr" className="select-all text-2xl text-ink">
          {invite.login}
        </strong>
      </p>
      <InviteForm token={token} />
    </AuthShell>
  );
}
