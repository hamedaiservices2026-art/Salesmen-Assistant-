import { getDb } from "./client";
import { seedDemo } from "./seed";
import { seedRefusal } from "./seed-guard";

async function main() {
  const refusal = seedRefusal(process.env);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const r = await seedDemo(await getDb());
  console.log(`Ahmed (rep):   /invite/${r.inviteToken}`);
  console.log(`Other company: /invite/${r.otherInviteToken}`);
  // Demo-only accounts; their passwords are in src/db/seed.ts and are not printed here.
  console.log("Admin (demo):  /admin/signin  admin@demo.test");
  console.log("Owner (demo):  /admin/signin  owner@platform.test");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
