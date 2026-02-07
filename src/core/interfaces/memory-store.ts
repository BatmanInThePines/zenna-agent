/**
 * MemoryStore Interface
 *
 * Abstraction layer for Zenna's memory system.
 * Three distinct knowledge layers (never conflated):
 *   1. Personal Memory (persistent, private, user-scoped)
 *   2. Session Context (ephemeral, conversation-scoped)
 *   3. External Research Context (attached, revocable)
 *
 * Design Principle: Provider-agnostic and portable.
 * Cloud (Pinecone + Supabase) → Local (SQLite + local vector DB)
 * Migration requires deployment changes, not architectural rewrites.
 */

// ============================================
// CORE DATA TYPES
// ============================================

export interface MemoryEntry {
  id: string;
  userId: string;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryScopeType = 'companion' | 'engineering' | 'platform' | 'simulation';

export interface MemoryMetadata {
  type: 'conversation' | 'fact' | 'preference' | 'context' | 'internet_search' | 'smart_home' | 'notion_action';
  conversationId?: string;
  topic?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  importance?: number; // 0-1 scale
  source?: 'user' | 'assistant' | 'system' | 'external';
  tags?: string[];

  // Memory Scope Partitioning (OpenClaw BOT Workforce)
  memoryScope?: MemoryScopeType;

  // Memory Classification Tags (BUG 3 - Internet Memory Persistence)
  contextSource?: MemoryContextSource;

  // Internet Search Metadata
  searchQuery?: string;        // Original query for internet searches
  searchSource?: string;       // e.g., "wttr.in", "Google News", "DuckDuckGo"
  retrievedAt?: string;        // ISO timestamp of retrieval

  // Smart Home Metadata
  deviceType?: string;         // e.g., "light", "thermostat", "lock"
  deviceCommand?: string;      // e.g., "turn_on", "set_temperature"

  // Notion Integration Metadata
  notionAction?: string;       // e.g., 'notion_search', 'notion_create_page', 'notion_add_entry'
  notionPageId?: string;       // Page or database ID involved in the action
  notionWorkspaceId?: string;  // Workspace reference for audit trail

  // Cross-Platform Context
  platformSource?: '360aware' | 'zenna_web' | 'zenna_mobile' | 'api';
}

/**
 * Memory Context Source Classification
 * Used for filtering and retrieval prioritization
 */
export type MemoryContextSource =
  | 'companion_conversation'   // Standard dialogue interactions
  | 'internet_search'          // Web retrieval results
  | 'smart_home'              // IoT commands and automation
  | '360aware'                // Cross-platform from 360aware.com.au
  | 'personal_fact'           // Extracted personal information
  | 'user_preference'         // User preferences and likes
  | 'external_knowledge'      // NotebookLM, Notion, etc.
  | 'engineering_task'         // Sprint/backlog operations (OpenClaw BOT)
  | 'agent_work_simulation'   // QA simulation conversations (OpenClaw BOT)
  | 'platform_governance';    // Architecture decisions (OpenClaw BOT)

export interface ConversationTurn {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  timestamp: Date;
  metadata?: {
    tokensUsed?: number;
    model?: string;
    latencyMs?: number;
  };
}

export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  summary?: string;
  turns: ConversationTurn[];
  startedAt: Date;
  endedAt?: Date;
  metadata?: {
    topics?: string[];
    sentiment?: string;
  };
}

// ============================================
// SEARCH & RETRIEVAL
// ============================================

export interface MemorySearchQuery {
  query: string;
  userId: string;
  topK?: number;
  threshold?: number;
  filters?: {
    type?: MemoryMetadata['type'][];
    dateRange?: { start: Date; end: Date };
    conversationId?: string;
    tags?: string[];
    memoryScope?: MemoryScopeType[];
  };
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  context?: string;
}

// ============================================
// SHORT-TERM MEMORY (Session Context)
// ============================================

export interface ShortTermMemoryStore {
  /**
   * Get the current session's conversation buffer
   */
  getSessionBuffer(sessionId: string): Promise<ConversationTurn[]>;

  /**
   * Add a turn to the session buffer
   */
  addToSession(sessionId: string, turn: Omit<ConversationTurn, 'id'>): Promise<ConversationTurn>;

  /**
   * Clear session buffer (on session end)
   */
  clearSession(sessionId: string): Promise<void>;

  /**
   * Get session metadata
   */
  getSessionMetadata(sessionId: string): Promise<{
    userId: string;
    startedAt: Date;
    turnCount: number;
  } | null>;
}

// ============================================
// LONG-TERM MEMORY (Persistent + RAG)
// ============================================

export interface LongTermMemoryStore {
  /**
   * Initialize the store (optional, for providers that need setup)
   */
  initialize?(): Promise<void>;

  /**
   * Store a memory entry with embedding
   */
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>;

  /**
   * Retrieve memory by ID
   */
  retrieve(id: string, userId: string): Promise<MemoryEntry | null>;

  /**
   * Semantic search over memories
   */
  search(query: MemorySearchQuery): Promise<MemorySearchResult[]>;

  /**
   * Update a memory entry
   */
  update(id: string, userId: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry>;

  /**
   * Delete a memory entry
   */
  delete(id: string, userId: string): Promise<void>;

  /**
   * Persist a complete conversation to long-term memory
   */
  persistConversation(conversation: Conversation): Promise<void>;

  /**
   * Get conversation history for a user
   */
  getConversationHistory(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      dateRange?: { start: Date; end: Date };
    }
  ): Promise<Conversation[]>;

  /**
   * Search conversations by content
   */
  searchConversations(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Conversation[]>;
}

// ============================================
// EXTERNAL CONTEXT (Revocable, Read-only)
// ============================================

export interface ExternalContextSource {
  id: string;
  userId: string;
  type: 'notion' | 'notebooklm' | 'file';
  name: string;
  enabled: boolean;
  lastSynced?: Date;
  config: Record<string, unknown>;
}

export interface ExternalContextStore {
  /**
   * Get all connected sources for a user
   */
  getSources(userId: string): Promise<ExternalContextSource[]>;

  /**
   * Add a new external source
   */
  addSource(source: Omit<ExternalContextSource, 'id'>): Promise<ExternalContextSource>;

  /**
   * Enable/disable a source
   */
  toggleSource(sourceId: string, userId: string, enabled: boolean): Promise<void>;

  /**
   * Remove a source
   */
  removeSource(sourceId: string, userId: string): Promise<void>;

  /**
   * Query external context (read-only)
   */
  queryContext(
    userId: string,
    query: string,
    sourceIds?: string[]
  ): Promise<Array<{ source: string; content: string; relevance: number }>>;
}

// ============================================
// UNIFIED MEMORY INTERFACE
// ============================================

export interface MemoryStore {
  /**
   * Short-term memory (session context)
   */
  readonly shortTerm: ShortTermMemoryStore;

  /**
   * Long-term memory (persistent, RAG-enabled)
   */
  readonly longTerm: LongTermMemoryStore;

  /**
   * External research context (revocable)
   */
  readonly external: ExternalContextStore;

  /**
   * Initialize memory stores
   */
  initialize(): Promise<void>;

  /**
   * Generate embedding for text
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Get active knowledge sources for a user
   * Zenna must always be able to answer: "What sources are you using right now?"
   */
  getActiveKnowledgeSources(userId: string): Promise<{
    personalMemory: boolean;
    sessionContext: boolean;
    externalSources: Array<{ name: string; type: string }>;
  }>;

  /**
   * Export conversation range to external service
   */
  exportConversations(
    userId: string,
    conversationIds: string[],
    destination: 'notion' | 'notebooklm'
  ): Promise<{ success: boolean; url?: string; error?: string }>;
}

// ============================================
// PROVIDER CONSTANTS
// ============================================

export const MEMORY_PROVIDERS = {
  // Short-term
  SUPABASE: 'supabase',
  REDIS: 'redis',
  IN_MEMORY: 'in-memory',

  // Long-term / Vector
  PINECONE: 'pinecone',
  SQLITE_VSS: 'sqlite-vss', // Future: local vector search
  PGVECTOR: 'pgvector',
} as const;
