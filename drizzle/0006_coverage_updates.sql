CREATE TABLE "coverage_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"line_id" text NOT NULL,
	"covered" integer NOT NULL,
	"total" integer NOT NULL,
	"as_of" date NOT NULL,
	"entered_by" text NOT NULL,
	"entered_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_updates_counts" CHECK ("coverage_updates"."total" >= 1 AND "coverage_updates"."covered" >= 0 AND "coverage_updates"."covered" <= "coverage_updates"."total")
);
--> statement-breakpoint
ALTER TABLE "coverage_updates" ADD CONSTRAINT "coverage_updates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_updates" ADD CONSTRAINT "coverage_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_updates" ADD CONSTRAINT "coverage_updates_line_id_target_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."target_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_updates" ADD CONSTRAINT "coverage_updates_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coverage_updates_user_line_as_of" ON "coverage_updates" USING btree ("user_id","line_id","as_of");