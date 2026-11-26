-- Row-level security for account data. The app connects as beamling_app and sets app.user_id per
-- transaction (asUser in lib/server/db.ts). RLS is not forced, so the owner and its SECURITY DEFINER
-- functions still see every row.

-- Owners of sources and credential usage, so their policies need no join.
ALTER TABLE "credential_usage" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "credential_usage" u SET "user_id" = c."user_id" FROM "credentials" c WHERE c."id" = u."credential_id";--> statement-breakpoint
ALTER TABLE "credential_usage" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "sources" s SET "user_id" = m."user_id" FROM "messages" m WHERE m."id" = s."message_id";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_usage" ADD CONSTRAINT "credential_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_usage_user_idx" ON "credential_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sources_user_idx" ON "sources" USING btree ("user_id");--> statement-breakpoint

-- No login here: scripts/migrate.mjs enables it with DATABASE_APP_PASSWORD, or the operator does.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beamling_app') THEN
    CREATE ROLE beamling_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO beamling_app', current_database());
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO beamling_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beamling_app;--> statement-breakpoint
-- Readiness counts applied migrations; nothing else may touch the ledger.
REVOKE INSERT, UPDATE, DELETE ON "beamling_migrations" FROM beamling_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO beamling_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beamling_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO beamling_app;--> statement-breakpoint

-- set_config(..., true) leaves '' after the transaction, hence nullif.
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "conversations" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "messages" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "sources" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "credentials" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "credential_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "credential_usage" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "settings" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "user_data_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_rows" ON "user_data_keys" TO beamling_app
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

-- Cross-account operations: narrow, no content returned.
CREATE FUNCTION beamling_streaming_answers(fresh_seconds integer)
RETURNS TABLE (total integer, deeper integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer, (count(*) FILTER (WHERE mode = 'deeper'))::integer
  FROM messages
  WHERE status = 'streaming'
    AND (fresh_seconds IS NULL OR created_at > clock_timestamp() - make_interval(secs => fresh_seconds))
$$;--> statement-breakpoint

CREATE FUNCTION beamling_answer_should_stop(answer_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce((SELECT stop_requested OR status <> 'streaming' FROM messages WHERE id = answer_id), true)
$$;--> statement-breakpoint

CREATE FUNCTION beamling_interrupt_answers(answer_ids uuid[], stale_seconds integer, code text, message text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE messages SET status = 'error', error_code = code, error_message = message
  WHERE status = 'streaming'
    AND CASE
      WHEN answer_ids IS NOT NULL THEN id = ANY (answer_ids)
      ELSE created_at <= clock_timestamp() - make_interval(secs => stale_seconds)
    END
$$;--> statement-breakpoint

CREATE FUNCTION beamling_delete_expired_conversations(retention_days integer, batch integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH deleted AS (
    DELETE FROM conversations
    WHERE id IN (
      SELECT id FROM conversations
      WHERE updated_at < clock_timestamp() - make_interval(days => retention_days)
      LIMIT batch
    )
    RETURNING 1
  )
  SELECT count(*)::integer FROM deleted
$$;--> statement-breakpoint

CREATE FUNCTION beamling_delete_empty_conversations()
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  DELETE FROM conversations c
  WHERE c.updated_at < clock_timestamp() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION beamling_streaming_answers(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION beamling_answer_should_stop(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION beamling_interrupt_answers(uuid[], integer, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION beamling_delete_expired_conversations(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION beamling_delete_empty_conversations() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION beamling_streaming_answers(integer) TO beamling_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION beamling_answer_should_stop(uuid) TO beamling_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION beamling_interrupt_answers(uuid[], integer, text, text) TO beamling_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION beamling_delete_expired_conversations(integer, integer) TO beamling_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION beamling_delete_empty_conversations() TO beamling_app;
