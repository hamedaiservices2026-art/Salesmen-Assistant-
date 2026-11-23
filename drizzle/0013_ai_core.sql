CREATE TABLE "ai_counters" (
	"scope" text NOT NULL,
	"bucket" text NOT NULL,
	"kind" text NOT NULL,
	"company_id" text,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_counters_scope_bucket_kind_pk" PRIMARY KEY("scope","bucket","kind")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"feature" text NOT NULL,
	"provider" text,
	"model" text,
	"outcome" text NOT NULL,
	"attempts" integer NOT NULL,
	"fallback" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"topic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_notice_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ai_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_counters" ADD CONSTRAINT "ai_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_counters_updated" ON "ai_counters" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ai_usage_company_created" ON "ai_usage" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created" ON "ai_usage" USING btree ("created_at");