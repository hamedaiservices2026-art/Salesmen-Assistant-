import { getDb } from "./client";
import { findCompany, seedPilotStructure } from "./pilot";

/** The argument is a company id; the company's exact name works too, since the console shows names, not ids. */
async function main() {
  const wanted = process.argv.slice(2).join(" ").trim();
  if (!wanted) {
    console.error("Usage: pnpm db:pilot <companyId>   (or the exact company name, in quotes)");
    process.exit(2);
  }
  const db = await getDb();
  const found = await findCompany(db, wanted);
  if (!found.ok) {
    console.error(`${found.reason === "none" ? "No company" : "More than one company"} matches "${wanted}". Nothing was changed.`);
    for (const c of found.known) console.error(`  ${c.id}  ${c.name}`);
    process.exit(1);
  }
  await seedPilotStructure(db, found.id);
  console.log(`Pilot lines and the November 2026 draft scheme are in place for "${found.name}". Complete and publish the scheme in /admin/schemes.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
