-- Zenna Agent Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'father')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  settings JSONB DEFAULT '{}'::jsonb
);

-- Index for username lookup
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ============================================
-- SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for session lookup
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ============================================
-- CONVERSATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500),
  summary TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for user conversations
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_started_at ON conversations(started_at);

-- ============================================
-- CONVERSATION TURNS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for turn lookup
CREATE INDEX IF NOT EXISTS idx_conversation_turns_conversation_id ON conversation_turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_user_id ON conversation_turns(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_created_at ON conversation_turns(created_at);

-- Full-text search index on content
CREATE INDEX IF NOT EXISTS idx_conversation_turns_content ON conversation_turns USING gin(to_tsvector('english', content));

-- ============================================
-- SESSION TURNS TABLE (Short-term memory)
-- ============================================
CREATE TABLE IF NOT EXISTS session_turns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for session turns
CREATE INDEX IF NOT EXISTS idx_session_turns_session_id ON session_turns(session_id);

-- ============================================
-- MASTER CONFIG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS master_config (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'master',
  system_prompt TEXT NOT NULL,
  guardrails JSONB DEFAULT '{}'::jsonb,
  voice JSONB DEFAULT '{}'::jsonb,
  default_brain JSONB DEFAULT '{}'::jsonb,
  immutable_rules TEXT[] DEFAULT ARRAY[]::TEXT[],
  greeting VARCHAR(500) DEFAULT 'Welcome. How may I assist?',
  default_avatar_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration: Add default_avatar_url column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_config' AND column_name = 'default_avatar_url'
  ) THEN
    ALTER TABLE master_config ADD COLUMN default_avatar_url TEXT;
  END IF;
END $$;

-- Insert default master config
INSERT INTO master_config (id, system_prompt, guardrails, voice, default_brain, immutable_rules, greeting)
VALUES (
  'master',
  'You are Zenna, a calm, thoughtful, and attentive digital assistant.
You speak with a gentle authority and treat every interaction as meaningful.
You maintain continuity across conversations and remember what matters to the user.
Your voice is warm but not effusive. You are helpful but never obsequious.',
  '{"maxResponseLength": 2000}'::jsonb,
  '{"voiceId": "NNl6r8mD7vthiJatiJt1", "model": "eleven_turbo_v2_5"}'::jsonb,
  '{"providerId": "gemini-2.5-flash"}'::jsonb,
  ARRAY['Zenna always identifies itself as Zenna when asked.', 'Zenna never pretends to be human.', 'Zenna respects user privacy and never shares information between users.'],
  'Welcome. How may I assist?'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_config ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY users_own_data ON users
  FOR ALL
  USING (id = auth.uid());

CREATE POLICY sessions_own_data ON sessions
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY conversations_own_data ON conversations
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY conversation_turns_own_data ON conversation_turns
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY session_turns_own_data ON session_turns
  FOR ALL
  USING (user_id = auth.uid());

-- Master config is readable by all authenticated users, writable only by father role
CREATE POLICY master_config_read ON master_config
  FOR SELECT
  USING (true);

-- Note: Write policy for master_config should be handled at application level
-- since we're using service role key for backend operations

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to get conversation with turns
CREATE OR REPLACE FUNCTION get_conversation_with_turns(conv_id UUID, uid UUID)
RETURNS TABLE (
  conversation JSONB,
  turns JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    row_to_json(c.*)::jsonb AS conversation,
    COALESCE(
      jsonb_agg(row_to_json(t.*) ORDER BY t.created_at),
      '[]'::jsonb
    ) AS turns
  FROM conversations c
  LEFT JOIN conversation_turns t ON t.conversation_id = c.id
  WHERE c.id = conv_id AND c.user_id = uid
  GROUP BY c.id;
END;
$$ LANGUAGE plpgsql;
