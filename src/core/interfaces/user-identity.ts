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
  role: 'user' | 'father' | 'admin' | 'admin-support'; // 'father' = legacy admin, 'admin' = new admin
  createdAt: Date;
  lastLoginAt?: Date;
  settings: UserSettings;
}

export interface UserSettings {
  // Personal avatar (2D PNG/image URL or data URL)
  avatarUrl?: string;

  // 3D Avatar model (GLB URL from reconstruction or preset)
  avatarModelUrl?: string;

  // Avatar model type: how the avatar was created
  avatarModelType?: 'preset' | 'custom' | 'reconstructed' | '2d-fallback';

  // Personal behavior prompt (preferences only, not core behavior)
  personalPrompt?: string;

  // LLM preferences
  preferredBrainProvider?: string;
  brainApiKey?: string; // User's own API key (encrypted)

  // Voice preferences
  preferredVoiceId?: string;

  // Smart home integrations (per-user credentials)
  integrations?: {
    hue?: {
      // OAuth-based cloud access
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      username?: string;
      // Home manifest data (fetched from Hue CLIP v2 API)
      manifest?: HueManifest;
      // Legacy local access (deprecated)
      bridgeIp?: string;
    };
    // Future: unifi, lutron, smartthings
  };

  // External context connections
  externalContext?: {
    notion?: {
      enabled: boolean;
      token?: string;
      workspaceId?: string;
      workspaceName?: string;
      botId?: string;
      connectedAt?: number;
      ingestionStatus?: 'idle' | 'processing' | 'completed' | 'error';
      ingestionProgress?: number;
    };
    notebooklm?: { enabled: boolean };
  };

  // UI preferences
  theme?: 'dark' | 'light';

  // Geolocation data
  location?: {
    latitude: number;
    longitude: number;
    city?: string;
    region?: string;
    country?: string;
    updatedAt?: string;
  };

  // Search Preferences (for personalized Google search)
  searchPreferences?: {
    // Incognito mode: use generic API instead of personalized results
    incognitoMode?: boolean;

    // Language preference for search results (ISO 639-1, e.g., "en", "es", "fr")
    language?: string;

    // Country/region for localized results (ISO 3166-1 alpha-2, e.g., "US", "GB", "AU")
    countryCode?: string;

    // Safe search level
    safeSearch?: 'off' | 'medium' | 'high';

    // Whether to use user's location for local search results
    useLocationForSearch?: boolean;
  };
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

  /**
   * Default avatar URL (base64 data URL or path)
   * This avatar is used for all users unless they set a personal avatar
   */
  defaultAvatarUrl?: string;

  /**
   * Default 3D avatar presets available to all users
   * Father can configure these via admin panel
   */
  avatarPresets?: Array<{
    id: string;
    name: string;
    modelUrl: string;        // GLB URL
    thumbnailUrl?: string;   // Preview image
    description?: string;
  }>;
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
    role?: 'user' | 'father' | 'admin' | 'admin-support'
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
  role: 'user' | 'father' | 'admin' | 'admin-support';
  exp: number;
  iat: number;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}

// ============================================
// HUE MANIFEST TYPES
// ============================================

export interface HueHome {
  id: string;
  name: string;
}

export interface HueRoom {
  id: string;
  homeId?: string;
  name: string;
  type: string;
  lights: HueLight[];
  groupedLightId?: string;
}

export interface HueZone {
  id: string;
  name: string;
  lights: HueLight[];
}

export interface HueLight {
  id: string;
  name: string;
  type: string;
  supportsColor: boolean;
  supportsDimming: boolean;
  currentState?: {
    on: boolean;
    brightness?: number;
    colorXY?: { x: number; y: number };
    colorTemp?: number;
  };
}

export interface HueScene {
  id: string;
  name: string;
  roomId?: string;
  roomName?: string;
}

export interface HueManifest {
  homes: HueHome[];
  rooms: HueRoom[];
  zones: HueZone[];
  scenes: HueScene[];
  fetchedAt: number;
}
