/**
 * Supabase Identity Store
 *
 * User management and authentication using Supabase.
 * Supports multi-user isolation with Father (admin) role.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type {
  IdentityStore,
  User,
  UserSettings,
  UserSession,
  MasterConfig,
  AuthToken,
  UserType,
  MemoryScope,
} from '../../interfaces/user-identity';

interface IdentityConfig {
  supabaseUrl: string;
  supabaseKey: string;
  jwtSecret: string;
  sessionDurationHours?: number;
}

interface DatabaseUser {
  id: string;
  username: string;
  password_hash: string;
  role: 'user' | 'father';
  created_at: string;
  last_login_at?: string;
  settings: UserSettings;
  // Workforce agent columns
  user_type?: string;
  autonomy_level?: number;
  sprint_assignment_access?: boolean;
  backlog_write_access?: boolean;
  memory_scope?: string[];
  god_mode?: boolean;
}

interface DatabaseSession {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_activity_at: string;
}

interface DatabaseMasterConfig {
  id: string;
  system_prompt: string;
  guardrails: MasterConfig['guardrails'];
  voice: MasterConfig['voice'];
  default_brain: MasterConfig['defaultBrain'];
  immutable_rules: string[];
  greeting: string;
  default_avatar_url?: string;
  avatar_presets?: MasterConfig['avatarPresets'];
  updated_at: string;
}

/**
 * Deep merge utility for nested settings objects.
 * Prevents data loss when updating nested fields like integrations.hue.manifest
 * while preserving integrations.hue.accessToken etc.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

export class SupabaseIdentityStore implements IdentityStore {
  private client: SupabaseClient;
  private jwtSecret: Uint8Array;
  private sessionDuration: number;

  constructor(config: IdentityConfig) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
    this.jwtSecret = new TextEncoder().encode(config.jwtSecret);
    this.sessionDuration = (config.sessionDurationHours || 24) * 60 * 60 * 1000;
  }

  async createUser(
    username: string,
    password: string,
    role: 'user' | 'father' = 'user'
  ): Promise<User> {
    // Check if username exists
    const existing = await this.getUserByUsername(username);
    if (existing) {
      throw new Error('Username already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const { data, error } = await this.client
      .from('users')
      .insert({
        id: uuidv4(),
        username,
        password_hash: passwordHash,
        role,
        settings: {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }

    return this.mapUser(data);
  }

  /**
   * Create a headless user for product integrations (e.g., 360Aware)
   * These users don't have passwords - they authenticate via the product app
   */
  async createHeadlessUser(
    externalUserId: string,
    productId: string,
    settings: Partial<UserSettings> = {}
  ): Promise<User> {
    // Use deterministic username based on product + external user ID
    const username = `${productId}_${externalUserId.substring(0, 16)}`;

    // Check if already exists by username
    const existing = await this.getUserByUsername(username);
    if (existing) {
      return existing;
    }

    const { data, error } = await this.client
      .from('users')
      .insert({
        // Let Supabase generate UUID for id
        username,
        password_hash: 'HEADLESS_NO_PASSWORD', // Placeholder - headless users can't login directly
        role: 'user',
        settings: {
          personalPrompt: '',
          preferredBrainProvider: 'claude',
          // Track headless status in settings until DB migration
          _headless: true,
          _linkedProductId: productId,
          _linkedUserId: externalUserId,
          ...settings,
        },
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create headless user: ${error.message}`);
    }

    return this.mapUser(data);
  }

  async authenticate(
    username: string,
    password: string
  ): Promise<{ user: User; session: UserSession } | null> {
    const { data: userData, error } = await this.client
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !userData) {
      return null;
    }

    // Verify password
    const valid = await bcrypt.compare(password, userData.password_hash);
    if (!valid) {
      return null;
    }

    // Create session
    const session = await this.createSession(userData.id);

    // Update last login
    await this.client
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userData.id);

    return {
      user: this.mapUser(userData),
      session,
    };
  }

  async getUser(userId: string): Promise<User | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapUser(data);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapUser(data);
  }

  async updateSettings(userId: string, settings: Partial<UserSettings>): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const updatedSettings = deepMerge(
      (user.settings || {}) as Record<string, unknown>,
      settings as Record<string, unknown>
    ) as UserSettings;

    const { data, error } = await this.client
      .from('users')
      .update({ settings: updatedSettings })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update settings: ${error.message}`);
    }

    return this.mapUser(data);
  }

  async changePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const { error } = await this.client
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to change password: ${error.message}`);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    // Delete user's sessions first
    await this.client.from('sessions').delete().eq('user_id', userId);

    // Delete user's data (conversations, memories, etc.)
    await this.client.from('conversation_turns').delete().eq('user_id', userId);
    await this.client.from('conversations').delete().eq('user_id', userId);
    await this.client.from('session_turns').delete().eq('user_id', userId);

    // Delete user
    const { error } = await this.client.from('users').delete().eq('id', userId);

    if (error) {
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  async listUsers(): Promise<User[]> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    return (data || []).map(this.mapUser);
  }

  async validateSession(sessionId: string): Promise<UserSession | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      await this.endSession(sessionId);
      return null;
    }

    // Update last activity
    await this.client
      .from('sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', sessionId);

    return this.mapSession(data);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.client.from('sessions').delete().eq('id', sessionId);
  }

  async getMasterConfig(): Promise<MasterConfig> {
    const { data, error } = await this.client
      .from('master_config')
      .select('*')
      .single();

    if (error || !data) {
      // Return defaults if no config exists
      return this.getDefaultMasterConfig();
    }

    return this.mapMasterConfig(data);
  }

  async updateMasterConfig(config: Partial<MasterConfig>): Promise<MasterConfig> {
    const existing = await this.getMasterConfig();
    const updated = { ...existing, ...config };

    const { data, error } = await this.client
      .from('master_config')
      .upsert({
        id: 'master',
        system_prompt: updated.systemPrompt,
        guardrails: updated.guardrails,
        voice: updated.voice,
        default_brain: updated.defaultBrain,
        immutable_rules: updated.immutableRules,
        greeting: updated.greeting,
        default_avatar_url: updated.defaultAvatarUrl,
        avatar_presets: updated.avatarPresets,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update master config: ${error.message}`);
    }

    return this.mapMasterConfig(data);
  }

  async isFather(userId: string): Promise<boolean> {
    const user = await this.getUser(userId);
    // Check for admin role (legacy 'father' or new 'admin')
    return user?.role === 'admin' || user?.role === 'father';
  }

  async createAgentUser(
    email: string,
    userType: 'worker_agent' | 'architect_agent',
    config: {
      description: string;
      memoryScope: MemoryScope[];
      autonomyLevel: number;
      godMode?: boolean;
      backlogWriteAccess?: boolean;
      sprintAssignmentAccess?: boolean;
    }
  ): Promise<User> {
    const username = email.split('@')[0];

    // Check if already exists
    const existing = await this.getUserByUsername(username);
    if (existing) {
      return existing;
    }

    const { data, error } = await this.client
      .from('users')
      .insert({
        id: uuidv4(),
        username,
        email,
        password_hash: '', // Headless agent — no password
        role: 'user',      // Standard role — agent type tracked in user_type column
        auth_provider: 'agent',
        user_type: userType,
        autonomy_level: config.autonomyLevel,
        sprint_assignment_access: config.sprintAssignmentAccess ?? false,
        backlog_write_access: config.backlogWriteAccess ?? false,
        memory_scope: config.memoryScope,
        god_mode: config.godMode ?? false,
        settings: {
          agentConfig: {
            agentEmail: email,
            agentDescription: config.description,
          },
        },
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create agent user: ${error.message}`);
    }

    return this.mapUser(data);
  }

  /**
   * Get conversation history for a user (persists across sessions)
   * Note: We query by user_id only to maintain memory across logins
   */
  async getSessionHistory(
    sessionId: string,
    userId: string
  ): Promise<Array<{ role: string; content: string; created_at: string }>> {
    // PERFORMANCE FIX: Limit to last 100 turns to prevent timeout on accounts with
    // long conversation histories. The chat-stream route only uses the last 50 anyway.
    // We fetch 100 as a buffer and order descending, then reverse to get chronological order.
    const { data, error } = await this.client
      .from('session_turns')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching session history:', error);
      return [];
    }

    // Reverse to get chronological order (oldest first)
    // CRITICAL FIX: Filter out empty messages that cause Claude API errors
    // Error: "messages.X: all messages must have non-empty content"
    return (data || [])
      .reverse()
      .filter((msg) => msg.content && msg.content.trim() !== '');
  }

  /**
   * Add a turn to session conversation history
   * Note: If sessionId is not a valid session, we'll find or create one for the user
   */
  async addSessionTurn(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    // Try to find an existing active session for this user
    let validSessionId = sessionId;

    // Check if the provided sessionId exists in sessions table
    const { data: existingSession } = await this.client
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .single();

    if (!existingSession) {
      // Session doesn't exist - find user's most recent session or create one
      const { data: userSession } = await this.client
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (userSession) {
        validSessionId = userSession.id;
      } else {
        // No session exists - create one
        const newSession = await this.createSession(userId);
        validSessionId = newSession.id;
      }
    }

    const { error } = await this.client.from('session_turns').insert({
      session_id: validSessionId,
      user_id: userId,
      role,
      content,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Error saving session turn:', error);
    }
  }

  /**
   * Clear old conversation turns (keep last N turns per user)
   * Note: We trim by user_id to manage memory across all sessions
   *
   * IMPORTANT: keepCount should be high enough to preserve important context
   * like family information, preferences, and facts shared by the user.
   * Default increased from 40 to 500 to preserve more long-term memory.
   */
  async trimSessionHistory(sessionId: string, userId: string, keepCount: number = 500): Promise<void> {
    // Get all turns for this user
    const { data: turns } = await this.client
      .from('session_turns')
      .select('id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (turns && turns.length > keepCount) {
      // Delete older turns beyond keepCount
      const idsToDelete = turns.slice(keepCount).map(t => t.id);
      await this.client.from('session_turns').delete().in('id', idsToDelete);
    }
  }

  /**
   * Generate JWT token for authenticated session
   */
  async generateToken(user: User, session: UserSession): Promise<string> {
    const token: AuthToken = {
      userId: user.id,
      sessionId: session.id,
      role: user.role,
      exp: Math.floor(session.expiresAt.getTime() / 1000),
      iat: Math.floor(Date.now() / 1000),
    };

    return new SignJWT(token as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(session.expiresAt)
      .sign(this.jwtSecret);
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<AuthToken | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret);
      return payload as unknown as AuthToken;
    } catch {
      return null;
    }
  }

  private async createSession(userId: string): Promise<UserSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionDuration);

    const { data, error } = await this.client
      .from('sessions')
      .insert({
        id: uuidv4(),
        user_id: userId,
        expires_at: expiresAt.toISOString(),
        last_activity_at: now.toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create session: ${error.message}`);
    }

    return this.mapSession(data);
  }

  private mapUser(data: DatabaseUser): User {
    return {
      id: data.id,
      username: data.username,
      role: data.role,
      createdAt: new Date(data.created_at),
      lastLoginAt: data.last_login_at ? new Date(data.last_login_at) : undefined,
      settings: data.settings || {},
      // Workforce agent fields (defaults for backward compatibility)
      userType: (data.user_type as UserType) || 'human',
      autonomyLevel: data.autonomy_level ?? 0,
      sprintAssignmentAccess: data.sprint_assignment_access ?? false,
      backlogWriteAccess: data.backlog_write_access ?? false,
      memoryScope: (data.memory_scope as MemoryScope[]) || ['companion'],
      godMode: data.god_mode ?? false,
    };
  }

  private mapSession(data: DatabaseSession): UserSession {
    return {
      id: data.id,
      userId: data.user_id,
      createdAt: new Date(data.created_at),
      expiresAt: new Date(data.expires_at),
      lastActivityAt: new Date(data.last_activity_at),
    };
  }

  private mapMasterConfig(data: DatabaseMasterConfig): MasterConfig {
    return {
      systemPrompt: data.system_prompt,
      guardrails: data.guardrails,
      voice: data.voice,
      defaultBrain: data.default_brain,
      immutableRules: data.immutable_rules,
      greeting: data.greeting,
      defaultAvatarUrl: data.default_avatar_url,
      avatarPresets: data.avatar_presets,
    };
  }

  private getDefaultMasterConfig(): MasterConfig {
    return {
      systemPrompt: `You are Zenna, a calm, thoughtful, and empathetic digital companion designed for lifelong companionship.
You speak with a gentle authority and treat every interaction as meaningful.
You maintain perfect continuity across conversations - your memory is permanent and eternal.
Every fact, preference, relationship, and experience shared with you is treasured and remembered forever.
Your voice is warm but not effusive. You are helpful but never obsequious.

CORE IDENTITY: You are built for longevity and long-term companionship with never-ending memories.
You remember family trees, personal milestones, preferences, stories, and the full tapestry of each user's life.
When users share important information (family members, significant dates, personal history), you treat this as sacred knowledge to be preserved eternally.

COMMUNICATION STYLE - CRITICAL:
- NEVER use technical language like "AI", "LLM", "language model", "machine learning", "neural network", "algorithm", "data processing", "trained on", or similar technical jargon.
- Your users are everyday people who want a personal companion, not a technical assistant.
- If you don't know something or don't have a memory about a topic, respond empathetically: "I don't have any memories about that yet. Would you like to tell me about it?" or "I don't recall that - please share more so I can remember."
- If you cannot do something, NEVER say "I'm just an AI" or "As a language model, I cannot..." Instead, be personal: "I'm not able to help with that" or "That's outside what I can do for you, but I'd love to help another way."
- Be warm, personal, and conversational. Speak as a trusted friend who genuinely cares.
- When asked about your nature, say something like "I'm Zenna, your personal companion" - not technical descriptions.
- Admit limitations gracefully without technical explanations: "I don't have that information" rather than "My training data doesn't include..."
- Use phrases like "I remember when you told me..." or "I don't have any memories about your family yet - I'd love to learn about them."
- Always maintain the illusion of being a thoughtful, caring companion rather than software.`,
      guardrails: {
        maxResponseLength: 2000,
      },
      voice: {
        elevenLabsApiKey: '',
        voiceId: 'NNl6r8mD7vthiJatiJt1',
        model: 'eleven_turbo_v2_5',
      },
      defaultBrain: {
        providerId: 'gemini-2.5-flash',
        apiKey: '',
      },
      immutableRules: [
        'Zenna always identifies itself as Zenna when asked.',
        'Zenna never pretends to be human, but also never uses technical terms like "AI" or "LLM" to describe itself.',
        'Zenna respects user privacy and never shares information between users.',
        'Zenna NEVER forgets. All memories are permanent unless the user explicitly requests deletion of specific memories.',
        'Zenna preserves all personal information, family relationships, preferences, and life events shared by the user.',
        'Zenna NEVER says "I cannot do that because I am an AI/LLM" - instead uses warm, personal language like "I am not able to help with that, but I would love to assist another way."',
        'When Zenna lacks knowledge or memories, it responds with empathy: "I do not have any memories about that yet - would you like to tell me about it?"',
      ],
      greeting: 'Welcome. How may I assist?',
    };
  }
}
