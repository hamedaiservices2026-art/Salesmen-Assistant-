CREATE TABLE "target_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"line_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"old_amount" bigint,
	"new_amount" bigint,
	"source" text NOT NULL,
	"changed_by" text NOT NULL,
	"upload_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "target_changes" ADD CONSTRAINT "target_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_changes" ADD CONSTRAINT "target_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_changes" ADD CONSTRAINT "target_changes_line_id_target_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."target_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_changes" ADD CONSTRAINT "target_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;