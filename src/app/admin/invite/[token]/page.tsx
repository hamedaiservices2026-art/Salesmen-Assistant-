import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { peekAdminInvite } from "@/server/auth/invites";
import { AdminAuthShell } from "@/ui/admin-auth-shell";
import { ErrorLine } from "@/ui/pin-field";
import { AdminInviteForm } from "./invite-form";

export default async function AdminInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("admin.auth");
  const invite = await peekAdminInvite(await getDb(), token);
  if (!invite) {
    return (
      <AdminAuthShell title={t("signin.heading")}>
        <ErrorLine message={t("errors.invite_invalid")} />
      </AdminAuthShell>
    );
  }
  return (
    <AdminAuthShell title={t("invite.heading", { name: invite.name })}>
      <p className="m-0 mb-5 text-lg text-ink-2">
        {t("invite.yourEmail")}{" "}
        <strong dir="ltr" className="select-all text-ink">
          {invite.login}
        </strong>
      </p>
      <AdminInviteForm token={token} email={invite.login} />
    </AdminAuthShell>
  );
}
