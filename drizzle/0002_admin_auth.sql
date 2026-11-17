ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: stale-counter recovery now reads failed_at; rows with failures keep their old recovery clock.
UPDATE "users" SET "failed_at" = "updated_at" WHERE "failed_attempts" > 0;
