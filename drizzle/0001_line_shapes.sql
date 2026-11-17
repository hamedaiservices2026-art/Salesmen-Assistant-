ALTER TABLE "companies" ADD COLUMN "behind_pct" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "target_lines" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "target_lines" ADD COLUMN "name_ur" text;--> statement-breakpoint
UPDATE "target_lines" SET "code" = "id", "name_ur" = "name_ar";--> statement-breakpoint
ALTER TABLE "target_lines" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "target_lines" ALTER COLUMN "name_ur" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "target_lines_company_code" ON "target_lines" USING btree ("company_id","code");
