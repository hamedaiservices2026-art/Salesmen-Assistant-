CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"close_id" text,
	"return_pos" integer,
	"attached_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_close_id_daily_closes_id_fk" FOREIGN KEY ("close_id") REFERENCES "public"."daily_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_company_user_date" ON "files" USING btree ("company_id","user_id","date");--> statement-breakpoint
CREATE INDEX "files_close" ON "files" USING btree ("close_id");