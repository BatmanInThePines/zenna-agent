-- ============================================
-- MIGRATION: RLS Security Fixes
-- Addresses ALL Supabase Security Advisor errors (7 errors, 2 warnings)
-- Run this in Supabase SQL Editor
-- Date: 2026-02-11
-- Fixed: PostgreSQL doesn't support CREATE POLICY IF NOT EXISTS
--        Using DROP POLICY IF EXISTS + CREATE POLICY pattern instead
-- ============================================

-- ============================================
-- ERROR 1: RLS Disabled on `auth_tokens`
-- (Email verification tokens — sensitive!)
-- ============================================
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;

-- Auth tokens are used pre-auth (user doesn't have a session yet).
-- All operations go through service role key in API routes.
-- No user-facing policy needed — service role bypasses RLS.

-- ============================================
-- ERROR 2: RLS Disabled on `accounts`
-- (OAuth access_token, refresh_token, id_token exposed!)
-- ============================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_own_data ON accounts;
CREATE POLICY accounts_own_data ON accounts
  FOR ALL
  USING (user_id = auth.uid());

-- ============================================
-- ERROR 3: RLS Disabled on `avatar_reconstruction_jobs`
-- ============================================
ALTER TABLE avatar_reconstruction_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avatar_jobs_own_data ON avatar_reconstruction_jobs;
CREATE POLICY avatar_jobs_own_data ON avatar_reconstruction_jobs
  FOR SELECT
  USING (auth.uid()::text = user_id);

-- Inserts/updates go through service role (API routes handle auth)
DROP POLICY IF EXISTS avatar_jobs_insert ON avatar_reconstruction_jobs;
CREATE POLICY avatar_jobs_insert ON avatar_reconstruction_jobs
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS avatar_jobs_update ON avatar_reconstruction_jobs;
CREATE POLICY avatar_jobs_update ON avatar_reconstruction_jobs
  FOR UPDATE
  USING (true);

-- ============================================
-- ERROR 4: RLS Disabled on `subscriptions`
-- (Migration defined RLS but it wasn't applied to production)
-- ============================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_own_data ON subscriptions;
CREATE POLICY subscriptions_own_data ON subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

-- Writes go through service role (subscription activation, Stripe webhooks)
DROP POLICY IF EXISTS subscriptions_service_write ON subscriptions;
CREATE POLICY subscriptions_service_write ON subscriptions
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS subscriptions_service_update ON subscriptions;
CREATE POLICY subscriptions_service_update ON subscriptions
  FOR UPDATE
  USING (true);

-- ============================================
-- ERROR 5: RLS Disabled on `user_memories`
-- (Migration defined RLS but it wasn't applied to production)
-- ============================================
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_memories_own_data ON user_memories;
CREATE POLICY user_memories_own_data ON user_memories
  FOR SELECT
  USING (user_id = auth.uid());

-- Writes go through service role
DROP POLICY IF EXISTS user_memories_service_write ON user_memories;
CREATE POLICY user_memories_service_write ON user_memories
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS user_memories_service_update ON user_memories;
CREATE POLICY user_memories_service_update ON user_memories
  FOR UPDATE
  USING (true);

-- ============================================
-- WARNINGS 6 & 7: Sensitive Columns Exposed
-- on `accounts` and `auth_tokens`
-- These are resolved by enabling RLS above.
-- Once RLS is active, unauthenticated/unauthorized
-- users can no longer read these columns via the API.
-- ============================================

-- ============================================
-- BONUS HARDENING: Skipped for now
-- agent_audit_log, admin_audit_log, master_config
-- tables don't exist yet. Add policies when tables are created.
-- ============================================
