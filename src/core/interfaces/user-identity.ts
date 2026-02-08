/**
 * User Identity & Isolation Model
 *
 * Zenna supports multiple users, each with:
 * - Independent password
 * - Isolated memory space
 * - Personal settings
 *
 * Zero cross-user data access under any circumstance
 * (except GOD mode for cross-user memory mining).
 *
 * Special role: "Father of Zenna" (Master/Admin)
 * - Exclusive access to Master Prompt
 * - Can define core behavior, guardrails, voice settings
 * - Can manage all users
 *
 * User Types:
 * - human: Standard platform member
 * - worker_agent: Autonomous sprint execution agent (OpenClaw BOT)
 * - architect_agent: Supervisory AI agent with orchestration authority
 */

export type UserType = 'human' | 'worker_agent' | 'architect_agent';
export type MemoryScope = 'companion' | 'engineering' | 'platform' | 'simulation';

export interface User {
  id: string;
  username: string;
  role: 'user' | 'father' | 'admin' | 'admin-support'; // 'father' = legacy admin, 'admin' = new admin
  createdAt: Date;
  lastLoginAt?: Date;
  settings: UserSettings;

  // Workforce agent fields (stored as DB columns)
  userType: UserType;
  autonomyLevel: number;               // 0 = manual, 5 = assisted, 10 = fully autonomous
  sprintAssignmentAccess: boolean;
  backlogWriteAccess: boolean;
  memoryScope: MemoryScope[];          // Which scopes this user can read/write
  godMode: boolean;                    // Cross-user memory mining (Father-grantable only)
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
      lastCheckedAt?: number; // Unix ms timestamp of last delta check
      capabilities?: {
        read: boolean;
        write: boolean;
        create: boolean;
      };
      notionMode?: 'query' | 'sync';   // Default: 'query' — live search vs synced to memory
      syncedPageIds?: string[];         // IDs of pages currently synced to memory
      syncedAt?: number;               // Unix ms of last sync
      syncEstimateMB?: number;          // Actual size of synced content in MB
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

  // Agent-specific metadata (only for worker_agent / architect_agent users)
  agentConfig?: AgentConfig;
}

export interface AgentConfig {
  agentEmail?: string;          // e.g., "ZennaArchitect@gmail.com"
  agentDescription?: string;    // What this agent does
  lastTaskAt?: string;          // ISO timestamp of last task execution
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

  /**
   * Create a headless agent user (Father only)
   */
  createAgentUser(
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
  ): Promise<User>;
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
  id: string;        // bridge_home resource UID
  name: string;
}

export interface HueRoom {
  id: string;        // room resource UID
  homeId?: string;
  name: string;
  type: string;
  lights: HueLight[];
  groupedLightId?: string;  // grouped_light resource UID for room-level control
  deviceIds?: string[];     // child device UIDs belonging to this room
}

export interface HueZone {
  id: string;        // zone resource UID
  name: string;
  lights: HueLight[];
  groupedLightId?: string;  // grouped_light resource UID for zone-level control
}

export interface HueLight {
  id: string;        // light resource UID (used in PUT /resource/light/{id})
  name: string;      // human-assigned name
  deviceId?: string; // parent device UID (owner.rid)
  type: string;      // archetype: e.g. sultan_bulb, spot_bulb, etc.
  productName?: string;  // product data name (e.g. "Hue color lamp")
  modelId?: string;      // product model ID
  supportsColor: boolean;
  supportsDimming: boolean;
  supportsColorTemp: boolean;
  currentState?: {
    on: boolean;
    brightness?: number;
    colorXY?: { x: number; y: number };
    colorTemp?: number;
  };
}

export interface HueScene {
  id: string;        // scene resource UID (used in PUT /resource/scene/{id})
  name: string;      // human-assigned name
  roomId?: string;   // owning room/zone UID
  roomName?: string;
  type?: string;     // group type: room or zone
  speed?: number;    // scene transition speed (0.0-1.0)
}

export interface HueDevice {
  id: string;        // device resource UID
  name: string;      // human-assigned name
  productName?: string;  // product data name
  modelId?: string;      // product model ID
  manufacturer?: string;
  archetype?: string;
  lightIds?: string[];   // light resource UIDs owned by this device
}

export interface HueManifest {
  homes: HueHome[];
  rooms: HueRoom[];
  zones: HueZone[];
  scenes: HueScene[];
  devices: HueDevice[];  // all devices for cross-reference
  fetchedAt: number;
}
