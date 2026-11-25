CREATE TABLE "assistant_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"verdict" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_messages_company_user_created" ON "assistant_messages" USING btree ("company_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_created" ON "assistant_messages" USING btree ("created_at");