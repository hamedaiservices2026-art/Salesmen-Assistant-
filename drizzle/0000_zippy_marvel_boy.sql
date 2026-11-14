CREATE TABLE "close_focus" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"close_id" text NOT NULL,
	"focus_item_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "close_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"close_id" text NOT NULL,
	"line_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"default_locale" text DEFAULT 'ar' NOT NULL,
	"selling_weekdays" integer[] NOT NULL,
	"week_starts_on" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_closes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cash_sales" bigint DEFAULT 0 NOT NULL,
	"credit_sales" bigint DEFAULT 0 NOT NULL,
	"collections" bigint DEFAULT 0 NOT NULL,
	"expenses" bigint DEFAULT 0 NOT NULL,
	"loaded" bigint DEFAULT 0 NOT NULL,
	"sold" bigint DEFAULT 0 NOT NULL,
	"returned" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"focus_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"target" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"close_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schemes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"components" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "target_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"line_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"supervisor_id" text,
	"pin_hash" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "close_focus" ADD CONSTRAINT "close_focus_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_focus" ADD CONSTRAINT "close_focus_close_id_daily_closes_id_fk" FOREIGN KEY ("close_id") REFERENCES "public"."daily_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_focus" ADD CONSTRAINT "close_focus_focus_item_id_focus_items_id_fk" FOREIGN KEY ("focus_item_id") REFERENCES "public"."focus_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_lines" ADD CONSTRAINT "close_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_lines" ADD CONSTRAINT "close_lines_close_id_daily_closes_id_fk" FOREIGN KEY ("close_id") REFERENCES "public"."daily_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "close_lines" ADD CONSTRAINT "close_lines_line_id_target_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."target_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_assignments" ADD CONSTRAINT "focus_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_assignments" ADD CONSTRAINT "focus_assignments_focus_item_id_focus_items_id_fk" FOREIGN KEY ("focus_item_id") REFERENCES "public"."focus_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_assignments" ADD CONSTRAINT "focus_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_items" ADD CONSTRAINT "focus_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_close_id_daily_closes_id_fk" FOREIGN KEY ("close_id") REFERENCES "public"."daily_closes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_lines" ADD CONSTRAINT "target_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_line_id_target_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."target_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "close_focus_close_item" ON "close_focus" USING btree ("close_id","focus_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "close_lines_close_line" ON "close_lines" USING btree ("close_id","line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_closes_user_date" ON "daily_closes" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_assignments_item_user" ON "focus_assignments" USING btree ("focus_item_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schemes_company_period" ON "schemes" USING btree ("company_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_user_period_line" ON "targets" USING btree ("user_id","year","month","line_id");