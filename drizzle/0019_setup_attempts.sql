CREATE TABLE "setup_attempts" (
	"id" integer PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	CONSTRAINT "setup_attempts_single_row" CHECK ("setup_attempts"."id" = 1)
);
--> statement-breakpoint
INSERT INTO "setup_attempts" ("id") VALUES (1) ON CONFLICT DO NOTHING;
