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
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
