CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"mode" text DEFAULT 'quick' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_usage" (
	"credential_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	CONSTRAINT "credential_usage_credential_id_day_pk" PRIMARY KEY("credential_id","day")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"key_id" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"dek_nonce" text NOT NULL,
	"dek_tag" text NOT NULL,
	"nonce" text NOT NULL,
	"ciphertext" text NOT NULL,
	"tag" text NOT NULL,
	"fingerprint" text NOT NULL,
	"last4" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"plan" text,
	"expires_on" date,
	"budget_usd" numeric(12, 2),
	"budget_period" text,
	"budget_started_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"mode" text,
	"uncited" boolean DEFAULT false NOT NULL,
	"no_sources" boolean DEFAULT false NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"searches" text,
	"reasoning" text,
	"llm_model" text,
	"resolved_model" text,
	"upstream_provider" text,
	"search_requests" integer DEFAULT 0 NOT NULL,
	"search_failures" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(12, 6),
	"search_cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_slots" (
	"key" text PRIMARY KEY NOT NULL,
	"next_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"llm_model" text DEFAULT 'deepseek/deepseek-v4.1-flash' NOT NULL,
	"default_mode" text DEFAULT 'quick' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"domain" text,
	"snippet" text,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_data_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrap_nonce" text,
	"wrap_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_usage" ADD CONSTRAINT "credential_usage_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_data_keys" ADD CONSTRAINT "user_data_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_idx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "conversations_user_pinned_updated_idx" ON "conversations" USING btree ("user_id","pinned","updated_at","id");--> statement-breakpoint
CREATE INDEX "credential_usage_day_idx" ON "credential_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_user_kind_provider_idx" ON "credentials" USING btree ("user_id","kind","provider");--> statement-breakpoint
CREATE INDEX "credentials_user_idx" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "messages_user_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_streaming_per_conversation_idx" ON "messages" USING btree ("conversation_id") WHERE "status" = 'streaming';--> statement-breakpoint
CREATE INDEX "messages_streaming_created_idx" ON "messages" USING btree ("created_at") WHERE "status" = 'streaming';--> statement-breakpoint
CREATE INDEX "provider_slots_next_at_idx" ON "provider_slots" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_message_position_idx" ON "sources" USING btree ("message_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_idx" ON "users" USING btree ("google_sub");