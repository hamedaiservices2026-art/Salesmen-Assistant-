ALTER TABLE "holidays" ADD COLUMN "name" text;--> statement-breakpoint
DELETE FROM "holidays" a USING "holidays" b WHERE a."company_id" = b."company_id" AND a."date" = b."date" AND a."id" > b."id";--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_company_date" ON "holidays" USING btree ("company_id","date");
