ALTER TABLE "messages" ADD COLUMN "stop_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "messages" SET "status" = 'error', "error_code" = 'INTERRUPTED', "error_message" = 'The answer was interrupted.' WHERE "status" = 'streaming';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_streaming_per_conversation_idx" ON "messages" USING btree ("conversation_id") WHERE "status" = 'streaming';--> statement-breakpoint
CREATE INDEX "messages_streaming_created_idx" ON "messages" USING btree ("created_at") WHERE "status" = 'streaming';--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");