import { getDb } from "./client";
import { createOwner } from "@/server/admin/bootstrap";
import { invitePath } from "@/server/auth/invites";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!email || !name) {
    console.error("Usage: pnpm admin:create-owner <email> <name>");
    process.exit(2);
  }
  const { inviteToken } = await createOwner(await getDb(), { email, name });
  console.log(`Owner invite (open on the deployed site, valid 7 days): ${invitePath("owner", inviteToken)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
