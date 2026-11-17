import { invitePath } from "@/server/auth/invites";
import { getDb } from "./client";
import { seedDemo } from "./seed";
import { seedRefusal } from "./seed-guard";

async function main() {
  const refusal = seedRefusal(process.env);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const deployed = Boolean(process.env.DATABASE_URL);
  const r = await seedDemo(await getDb(), { deployed });
  console.log(`Ahmed (rep):   /invite/${r.inviteToken}`);
  console.log(`Other company: /invite/${r.otherInviteToken}`);
  console.log(`Sami (supervisor): /invite/${r.supervisorInviteToken}`);
  if (deployed) {
    // No demo password exists on a deployed database; each link sets the account's own.
    if (r.adminInviteToken) console.log(`Admin (demo):  ${invitePath("admin", r.adminInviteToken)}`);
    if (r.ownerInviteToken) console.log(`Owner (demo):  ${invitePath("owner", r.ownerInviteToken)}`);
  } else {
    // Local demo accounts; their passwords are in src/db/seed.ts and are not printed here.
    console.log("Admin (demo):  /admin/signin  admin@demo.test");
    console.log("Owner (demo):  /admin/signin  owner@platform.test");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
