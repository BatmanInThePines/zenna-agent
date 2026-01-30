-- ============================================
-- ZENNA PHASE 2: USER MANAGEMENT SYSTEM
-- Run this migration after schema.sql
-- ============================================

-- ============================================
-- UPDATE USERS TABLE FOR OAUTH
-- ============================================

-- Add new columns to users table for OAuth support
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMP WITH TIME ZONE;

-- Update role column to support new roles
-- Note: This changes 'father' to 'admin' terminology
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'admin', 'admin-support'));

-- Create index for email lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);

-- ============================================
-- SUBSCRIPTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier VARCHAR(20) NOT NULL CHECK (tier IN ('trial', 'standard', 'pro', 'platinum')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired', 'cancelled', 'archived')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  trial_warning_sent BOOLEAN DEFAULT FALSE,
  trial_warning_sent_at TIMESTAMP WITH TIME ZONE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  hardware_bundle BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure only one active subscription per user
  CONSTRAINT unique_active_subscription UNIQUE (user_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- Indexes for subscription lookup
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);

-- Enable RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can see their own subscriptions
CREATE POLICY subscriptions_own_data ON subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- USER SESSIONS TRACKING (Daily Session Limits)
-- ============================================
CREATE TABLE IF NOT EXISTS user_session_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date DATE DEFAULT CURRENT_DATE,
  session_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One record per user per day
  CONSTRAINT unique_user_session_date UNIQUE (user_id, session_date)
);

-- Index for session tracking lookup
CREATE INDEX IF NOT EXISTS idx_user_session_tracking_user_date ON user_session_tracking(user_id, session_date);

-- Enable RLS
ALTER TABLE user_session_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_session_tracking_own_data ON user_session_tracking
  FOR ALL
  USING (user_id = auth.uid());

-- ============================================
-- USER MEMORIES METADATA
-- ============================================
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_location VARCHAR(50) DEFAULT 'active' CHECK (storage_location IN ('active', 'archived')),
  memory_size_mb DECIMAL(10,2) DEFAULT 0,
  memory_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  archived_at TIMESTAMP WITH TIME ZONE
);

-- Index for memory lookup
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_storage_location ON user_memories(storage_location);

-- Enable RLS
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_memories_own_data ON user_memories
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- CSAT (Customer Satisfaction) SCORES
-- ============================================
CREATE TABLE IF NOT EXISTS user_csat (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score DECIMAL(3,2) CHECK (score >= 0 AND score <= 5),
  feedback TEXT,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for CSAT lookup
CREATE INDEX IF NOT EXISTS idx_user_csat_user_id ON user_csat(user_id);
CREATE INDEX IF NOT EXISTS idx_user_csat_score ON user_csat(score);
CREATE INDEX IF NOT EXISTS idx_user_csat_recorded_at ON user_csat(recorded_at);

-- Enable RLS
ALTER TABLE user_csat ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_csat_own_data ON user_csat
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- CONSUMPTION METRICS
-- ============================================
CREATE TABLE IF NOT EXISTS user_consumption (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_date DATE DEFAULT CURRENT_DATE,
  api_calls INTEGER DEFAULT 0,
  tokens_used BIGINT DEFAULT 0,
  research_queries INTEGER DEFAULT 0,
  smart_home_commands INTEGER DEFAULT 0,
  tts_characters INTEGER DEFAULT 0,
  asr_minutes DECIMAL(10,2) DEFAULT 0,
  memory_operations INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One record per user per day
  CONSTRAINT unique_user_consumption_date UNIQUE (user_id, metric_date)
);

-- Index for consumption lookup
CREATE INDEX IF NOT EXISTS idx_user_consumption_user_date ON user_consumption(user_id, metric_date);

-- Enable RLS
ALTER TABLE user_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_consumption_own_data ON user_consumption
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- DATA EXPORT REQUESTS
-- ============================================
CREATE TABLE IF NOT EXISTS data_export_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'downloaded', 'expired')),
  file_path TEXT,
  file_size_mb DECIMAL(10,2),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ready_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
  downloaded_at TIMESTAMP WITH TIME ZONE
);

-- Index for export request lookup
CREATE INDEX IF NOT EXISTS idx_data_export_requests_user_id ON data_export_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_token ON data_export_requests(token);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_status ON data_export_requests(status);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_expires_at ON data_export_requests(expires_at);

-- Enable RLS
ALTER TABLE data_export_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_export_requests_own_data ON data_export_requests
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- ADMIN AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  admin_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_email VARCHAR(255),
  details JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for audit log lookup
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_user ON admin_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at);

-- Enable RLS (only admins can see audit logs)
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- NEXTAUTH.JS TABLES
-- ============================================

-- Accounts table for OAuth provider accounts
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  provider_account_id VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type VARCHAR(255),
  scope VARCHAR(255),
  id_token TEXT,
  session_state VARCHAR(255),

  CONSTRAINT unique_provider_account UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- Verification tokens for email verification
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  expires TIMESTAMP WITH TIME ZONE NOT NULL,

  CONSTRAINT unique_verification_token UNIQUE (identifier, token)
);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to check if user has exceeded daily session limit
CREATE OR REPLACE FUNCTION check_session_limit(uid UUID, tier VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  current_count INTEGER;
  max_sessions INTEGER;
BEGIN
  -- Set max sessions based on tier
  CASE tier
    WHEN 'trial' THEN max_sessions := 12;
    WHEN 'standard' THEN max_sessions := 50;
    WHEN 'pro' THEN max_sessions := 100;
    WHEN 'platinum' THEN max_sessions := -1; -- Unlimited
    ELSE max_sessions := 12;
  END CASE;

  -- Get current session count for today
  SELECT COALESCE(session_count, 0) INTO current_count
  FROM user_session_tracking
  WHERE user_id = uid AND session_date = CURRENT_DATE;

  -- Unlimited check
  IF max_sessions = -1 THEN
    RETURN TRUE;
  END IF;

  RETURN current_count < max_sessions;
END;
$$ LANGUAGE plpgsql;

-- Function to increment session count
CREATE OR REPLACE FUNCTION increment_session_count(uid UUID)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  INSERT INTO user_session_tracking (user_id, session_date, session_count)
  VALUES (uid, CURRENT_DATE, 1)
  ON CONFLICT (user_id, session_date)
  DO UPDATE SET
    session_count = user_session_tracking.session_count + 1,
    updated_at = NOW()
  RETURNING session_count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's average CSAT score
CREATE OR REPLACE FUNCTION get_user_csat_average(uid UUID)
RETURNS DECIMAL AS $$
DECLARE
  avg_score DECIMAL;
BEGIN
  SELECT AVG(score) INTO avg_score
  FROM user_csat
  WHERE user_id = uid;

  RETURN COALESCE(avg_score, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to check trial expiration and send warnings
CREATE OR REPLACE FUNCTION check_trial_status(uid UUID)
RETURNS JSONB AS $$
DECLARE
  sub RECORD;
  days_remaining INTEGER;
  result JSONB;
BEGIN
  SELECT * INTO sub
  FROM subscriptions
  WHERE user_id = uid AND tier = 'trial' AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '{"status": "no_trial"}'::jsonb;
  END IF;

  days_remaining := EXTRACT(DAY FROM (sub.expires_at - NOW()));

  result := jsonb_build_object(
    'status', sub.status,
    'days_remaining', days_remaining,
    'expires_at', sub.expires_at,
    'warning_sent', sub.trial_warning_sent,
    'should_warn', days_remaining <= 10 AND NOT sub.trial_warning_sent,
    'should_block', days_remaining < 0
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to archive user data
CREATE OR REPLACE FUNCTION archive_user_data(uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Update user memories to archived status
  UPDATE user_memories
  SET storage_location = 'archived', archived_at = NOW(), updated_at = NOW()
  WHERE user_id = uid;

  -- Update subscription status
  UPDATE subscriptions
  SET status = 'archived', updated_at = NOW()
  WHERE user_id = uid AND status = 'active';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to restore user from archive
CREATE OR REPLACE FUNCTION restore_user_data(uid UUID, restore_memories BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN AS $$
BEGIN
  -- Optionally restore memories
  IF restore_memories THEN
    UPDATE user_memories
    SET storage_location = 'active', archived_at = NULL, updated_at = NOW()
    WHERE user_id = uid;
  END IF;

  -- Restore subscription (keep memories decision separate)
  UPDATE subscriptions
  SET status = 'active', updated_at = NOW()
  WHERE user_id = uid AND status = 'archived';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_consumption_updated_at ON user_consumption;
CREATE TRIGGER update_user_consumption_updated_at
  BEFORE UPDATE ON user_consumption
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON TABLE subscriptions IS 'User subscription tiers: trial (90 days free), standard, pro, platinum';
COMMENT ON TABLE user_session_tracking IS 'Tracks daily session counts for rate limiting';
COMMENT ON TABLE user_csat IS 'Customer satisfaction scores (0-5 scale, industry standard >= 3.5)';
COMMENT ON TABLE user_consumption IS 'Daily consumption metrics for billing and analytics';
COMMENT ON TABLE data_export_requests IS 'Self-service data export requests (24h expiry)';
COMMENT ON TABLE admin_audit_log IS 'Audit trail for admin actions (role changes, suspensions, etc.)';

COMMENT ON COLUMN subscriptions.tier IS 'trial: 90 days free, 12 sessions/day | standard: one-time | pro: one-time | platinum: monthly';
COMMENT ON COLUMN subscriptions.hardware_bundle IS 'Whether user purchased Local Zenna hardware bundle';
COMMENT ON COLUMN user_csat.score IS 'CSAT score 0-5, scores below 3.5 shown in red (below industry standard)';
