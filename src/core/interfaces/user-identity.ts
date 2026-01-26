/**
 * User Identity & Isolation Model
 *
 * Zenna supports multiple users, each with:
 * - Independent password
 * - Isolated memory space
 * - Personal settings
 *
 * Zero cross-user data access under any circumstance.
 *
 * Special role: "Father of Zenna" (Master/Admin)
 * - Exclusive access to Master Prompt
 * - Can define core behavior, guardrails, voice settings
 * - Can manage all users
 */

export interface User {
  id: string;
  username: string;
  role: 'user' | 'father'; // 'father' = admin/master
  createdAt: Date;
  lastLoginAt?: Date;
  settings: UserSettings;
}

export interface UserSettings {
  // Personal avatar (PNG)
  avatarUrl?: string;

  // Personal behavior prompt (preferences only, not core behavior)
  personalPrompt?: string;

  // LLM preferences
  preferredBrainProvider?: string;
  brainApiKey?: string; // User's own API key (encrypted)

  // Voice preferences
  preferredVoiceId?: string;

  // Smart home integrations (per-user credentials)
  integrations?: {
    hue?: { bridgeIp: string; username: string };
    // Future: unifi, lutron, smartthings
  };

  // External context connections
  externalContext?: {
    notion?: { enabled: boolean; token?: string };
    notebooklm?: { enabled: boolean };
  };

  // UI preferences
  theme?: 'dark' | 'light';
}

export interface UserSession {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

// ============================================
// MASTER/FATHER CONFIGURATION
// ============================================

export interface MasterConfig {
  /**
   * Core system prompt (defines Zenna's fundamental behavior)
   * Only Father can modify
   */
  systemPrompt: string;

  /**
   * Guardrails and behavioral constraints
   */
  guardrails: {
    maxResponseLength?: number;
    allowedTopics?: string[];
    blockedTopics?: string[];
    contentFilters?: string[];
  };

  /**
   * Voice configuration
   */
  voice: {
    elevenLabsApiKey: string;
    voiceId: string;
    model?: string;
  };

  /**
   * Default LLM configuration
   */
  defaultBrain: {
    providerId: string;
    apiKey: string;
    model?: string;
  };

  /**
   * Immutable system rules (cannot be overridden by users)
   */
  immutableRules: string[];

  /**
   * Greeting message
   */
  greeting: string;
}

// ============================================
// IDENTITY STORE INTERFACE
// ============================================

export interface IdentityStore {
  /**
   * Create a new user
   */
  createUser(
    username: string,
    password: string,
    role?: 'user' | 'father'
  ): Promise<User>;

  /**
   * Authenticate user
   */
  authenticate(
    username: string,
    password: string
  ): Promise<{ user: User; session: UserSession } | null>;

  /**
   * Get user by ID
   */
  getUser(userId: string): Promise<User | null>;

  /**
   * Get user by username
   */
  getUserByUsername(username: string): Promise<User | null>;

  /**
   * Update user settings
   */
  updateSettings(userId: string, settings: Partial<UserSettings>): Promise<User>;

  /**
   * Change password
   */
  changePassword(userId: string, newPassword: string): Promise<void>;

  /**
   * Delete user (Father only)
   */
  deleteUser(userId: string): Promise<void>;

  /**
   * List all users (Father only)
   */
  listUsers(): Promise<User[]>;

  /**
   * Validate session
   */
  validateSession(sessionId: string): Promise<UserSession | null>;

  /**
   * End session (logout)
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Get master configuration (Father only)
   */
  getMasterConfig(): Promise<MasterConfig>;

  /**
   * Update master configuration (Father only)
   */
  updateMasterConfig(config: Partial<MasterConfig>): Promise<MasterConfig>;

  /**
   * Check if user is Father
   */
  isFather(userId: string): Promise<boolean>;
}

// ============================================
// AUTH HELPERS
// ============================================

export interface AuthToken {
  userId: string;
  sessionId: string;
  role: 'user' | 'father';
  exp: number;
  iat: number;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}
