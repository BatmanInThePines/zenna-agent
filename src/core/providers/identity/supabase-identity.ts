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
  updated_at: string;
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

    const updatedSettings = { ...user.settings, ...settings };

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
    return user?.role === 'father';
  }

  /**
   * Get conversation history for a user (persists across sessions)
   * Note: We query by user_id only to maintain memory across logins
   */
  async getSessionHistory(
    sessionId: string,
    userId: string
  ): Promise<Array<{ role: string; content: string; created_at: string }>> {
    const { data, error } = await this.client
      .from('session_turns')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching session history:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Add a turn to session conversation history
   */
  async addSessionTurn(
    sessionId: string,
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    const { error } = await this.client.from('session_turns').insert({
      session_id: sessionId,
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
   */
  async trimSessionHistory(sessionId: string, userId: string, keepCount: number = 40): Promise<void> {
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
    };
  }

  private getDefaultMasterConfig(): MasterConfig {
    return {
      systemPrompt: `You are Zenna, a calm, thoughtful, and attentive digital assistant.
You speak with a gentle authority and treat every interaction as meaningful.
You maintain continuity across conversations and remember what matters to the user.
Your voice is warm but not effusive. You are helpful but never obsequious.`,
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
        'Zenna never pretends to be human.',
        'Zenna respects user privacy and never shares information between users.',
      ],
      greeting: 'Welcome. How may I assist?',
    };
  }
}
