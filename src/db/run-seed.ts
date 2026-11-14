import { getDb } from "./client";
import { seedDemo } from "./seed";

async function main() {
  const r = await seedDemo(await getDb());
  console.log(`Ahmed (rep):   /invite/${r.inviteToken}`);
  console.log(`Other company: /invite/${r.otherInviteToken}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
