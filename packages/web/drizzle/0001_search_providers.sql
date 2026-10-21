ALTER TABLE "messages" ADD COLUMN "search_provider" text DEFAULT 'brave' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_search_provider" text DEFAULT 'brave' NOT NULL;