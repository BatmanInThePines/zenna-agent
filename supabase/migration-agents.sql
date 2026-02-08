-- ============================================
-- MIGRATION: OpenClaw BOT Workforce Architecture
-- Adds AI agent support as first-class platform members
-- ============================================

-- ============================================
-- 1. USER MODEL EXPANSION
-- ============================================

-- User type classification: human, worker_agent, architect_agent
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'human';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'users_user_type_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_user_type_check
      CHECK (user_type IN ('human', 'worker_agent', 'architect_agent'));
  END IF;
END $$;

-- Autonomy level: 0 = manual, 5 = assisted, 10 = fully autonomous
ALTER TABLE users ADD COLUMN IF NOT EXISTS autonomy_level INTEGER DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'users_autonomy_level_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_autonomy_level_check
      CHECK (autonomy_level BETWEEN 0 AND 10);
  END IF;
END $$;

-- Sprint and backlog access flags
ALTER TABLE users ADD COLUMN IF NOT EXISTS sprint_assignment_access BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backlog_write_access BOOLEAN DEFAULT FALSE;

-- Memory scope restriction (which scopes this user can read/write)
-- Default: ['companion'] for human users
ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_scope VARCHAR(50)[] DEFAULT ARRAY['companion']::VARCHAR[];

-- GOD mode: cross-user memory mining (Father-grantable only)
ALTER TABLE users ADD COLUMN IF NOT EXISTS god_mode BOOLEAN DEFAULT FALSE;

-- Indexes for agent queries
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_god_mode ON users(god_mode) WHERE god_mode = true;

-- ============================================
-- 2. AGENT AUDIT LOG
-- ============================================

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  tool_name VARCHAR(100),
  input JSONB DEFAULT '{}'::jsonb,
  result_summary TEXT,
  memory_scope VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_agent_id ON agent_audit_log(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_action ON agent_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON agent_audit_log(created_at);

-- Enable RLS
ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;

-- Audit log readable by admins only (application-level enforcement via service role key)
CREATE POLICY IF NOT EXISTS agent_audit_log_read ON agent_audit_log
  FOR SELECT
  USING (true);
