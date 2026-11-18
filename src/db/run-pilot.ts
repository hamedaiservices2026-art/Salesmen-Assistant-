import { eq, ne } from "drizzle-orm";
import { getDb } from "./client";
import { seedPilotStructure } from "./pilot";
import * as s from "./schema";

/** The argument is a company id; the company's exact name works too, since the console shows names, not ids. */
async function main() {
  const wanted = process.argv.slice(2).join(" ").trim();
  if (!wanted) {
    console.error('Usage: pnpm db:pilot <companyId>   (or the exact company name, in quotes)');
    process.exit(2);
  }
  const db = await getDb();
  let matches = await db.select({ id: s.companies.id, name: s.companies.name }).from(s.companies).where(eq(s.companies.id, wanted));
  if (matches.length === 0) matches = await db.select({ id: s.companies.id, name: s.companies.name }).from(s.companies).where(eq(s.companies.name, wanted));
  if (matches.length !== 1) {
    const known = await db.select({ id: s.companies.id, name: s.companies.name }).from(s.companies).where(ne(s.companies.id, "platform"));
    console.error(`${matches.length === 0 ? "No company" : "More than one company"} matches "${wanted}". Nothing was changed.`);
    for (const c of known) console.error(`  ${c.id}  ${c.name}`);
    process.exit(1);
  }
  const [company] = matches;
  await seedPilotStructure(db, company!.id);
  console.log(`Pilot lines and the November 2026 draft scheme are in place for "${company!.name}". Complete and publish the scheme in /admin/schemes.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
