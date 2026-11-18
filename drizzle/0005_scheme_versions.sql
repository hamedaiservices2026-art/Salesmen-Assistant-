CREATE TABLE "scheme_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"scheme_id" text NOT NULL,
	"version" integer NOT NULL,
	"components" jsonb NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "draft_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schemes" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "scheme_versions" ADD CONSTRAINT "scheme_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_versions" ADD CONSTRAINT "scheme_versions_scheme_id_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheme_versions" ADD CONSTRAINT "scheme_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheme_versions_scheme_version" ON "scheme_versions" USING btree ("scheme_id","version");--> statement-breakpoint
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill (hand-written): every scheme already published becomes version 1, logged once with no publisher.
UPDATE "schemes" SET "version" = 1, "published_at" = "updated_at" WHERE "published" = true;--> statement-breakpoint
INSERT INTO "scheme_versions" ("id", "company_id", "scheme_id", "version", "components", "published_by", "published_at")
SELECT "id" || '-v1', "company_id", "id", 1, "components", NULL, "updated_at" FROM "schemes" WHERE "published" = true;
