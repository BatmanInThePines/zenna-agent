/**
 * Memory Service
 *
 * Unified memory management for Zenna's permanent memory system.
 * CORE PRINCIPLE: Memories are PERMANENT. They are never deleted unless
 * explicitly requested by the user.
 *
 * This service coordinates between:
 * - Supabase (session history, structured storage)
 * - Pinecone (semantic search, long-term memory)
 *
 * Design: Built for longevity and lifelong AI companionship.
 */

import { SupabaseIdentityStore } from '../providers/identity/supabase-identity';
import {
  PineconeLongTermStore,
  GeminiEmbeddingProvider,
  OpenAIEmbeddingProvider,
  EmbeddingProvider,
} from '../providers/memory/pinecone-store';
import { QdrantLongTermStore } from '../providers/memory/qdrant-store';
import type { MemoryEntry, MemoryMetadata, LongTermMemoryStore } from '../interfaces/memory-store';

interface MemoryServiceConfig {
  supabaseUrl: string;
  supabaseKey: string;
  jwtSecret: string;
  // Vector store provider selection
  vectorProvider?: 'pinecone' | 'qdrant';
  // Pinecone config
  pineconeApiKey?: string;
  pineconeIndexName?: string;
  // Qdrant config (self-hosted or cloud)
  qdrantUrl?: string;
  qdrantApiKey?: string;
  qdrantCollectionName?: string;
  // Embedding config
  embeddingApiKey?: string;
  embeddingProvider?: 'openai' | 'gemini';
}

interface RelevantMemory {
  content: string;
  type: MemoryMetadata['type'];
  importance?: number;
  createdAt: Date;
  score: number;
}

export class MemoryService {
  private identityStore: SupabaseIdentityStore;
  private longTermStore: LongTermMemoryStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private config: MemoryServiceConfig;
  private initialized = false;
  private vectorProvider: 'pinecone' | 'qdrant' | 'none' = 'none';

  constructor(config: MemoryServiceConfig) {
    this.config = config;
    this.identityStore = new SupabaseIdentityStore({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
      jwtSecret: config.jwtSecret,
    });
  }

  /**
   * Initialize the memory service (lazy initialization)
   * Supports both Pinecone (managed) and Qdrant (self-hosted/cloud) as vector stores
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create embedding provider if API key is available
    if (this.config.embeddingApiKey) {
      if (this.config.embeddingProvider === 'openai') {
        this.embeddingProvider = new OpenAIEmbeddingProvider(this.config.embeddingApiKey);
      } else {
        // Default to Gemini (more cost-effective)
        this.embeddingProvider = new GeminiEmbeddingProvider(this.config.embeddingApiKey);
      }
    }

    // Determine which vector store to use (prefer Qdrant for cost savings)
    const preferredProvider = this.config.vectorProvider || 'qdrant';

    // Try Qdrant first (self-hosted or cloud)
    if (
      preferredProvider === 'qdrant' &&
      this.config.qdrantUrl &&
      this.config.qdrantCollectionName &&
      this.embeddingProvider
    ) {
      try {
        this.longTermStore = new QdrantLongTermStore(
          {
            url: this.config.qdrantUrl,
            apiKey: this.config.qdrantApiKey,
            collectionName: this.config.qdrantCollectionName,
          },
          this.embeddingProvider
        );

        await this.longTermStore.initialize?.();
        this.vectorProvider = 'qdrant';
        console.log('[MemoryService] Qdrant long-term memory initialized');
      } catch (error) {
        console.warn('[MemoryService] Qdrant initialization failed, trying Pinecone:', error);
        this.longTermStore = null;
      }
    }

    // Fall back to Pinecone if Qdrant not configured or failed
    if (
      !this.longTermStore &&
      this.config.pineconeApiKey &&
      this.config.pineconeIndexName &&
      this.embeddingProvider
    ) {
      try {
        this.longTermStore = new PineconeLongTermStore(
          {
            apiKey: this.config.pineconeApiKey,
            indexName: this.config.pineconeIndexName,
          },
          this.embeddingProvider
        );

        await this.longTermStore.initialize?.();
        this.vectorProvider = 'pinecone';
        console.log('[MemoryService] Pinecone long-term memory initialized');
      } catch (error) {
        console.error('[MemoryService] Pinecone initialization failed:', error);
      }
    }

    if (!this.longTermStore) {
      console.log('[MemoryService] No vector store configured - using Supabase only');
      console.log('[MemoryService] Set QDRANT_URL + QDRANT_COLLECTION or PINECONE_API_KEY + PINECONE_INDEX_NAME');
    }

    this.initialized = true;
  }

  /**
   * Get the active vector provider
   */
  getVectorProvider(): 'pinecone' | 'qdrant' | 'none' {
    return this.vectorProvider;
  }

  /**
   * Get conversation history from Supabase (all turns for user)
   * NOTE: This does NOT delete any history - memories are permanent
   */
  async getConversationHistory(
    userId: string
  ): Promise<Array<{ role: string; content: string; created_at: string }>> {
    const sessionId = `${userId}-${new Date().toISOString().split('T')[0]}`;
    return this.identityStore.getSessionHistory(sessionId, userId);
  }

  /**
   * Add a conversation turn to permanent storage
   * Stores in both Supabase (structured) and Pinecone (semantic search)
   */
  async addConversationTurn(
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: {
      importance?: number;
      tags?: string[];
      topic?: string;
    }
  ): Promise<void> {
    const sessionId = `${userId}-${new Date().toISOString().split('T')[0]}`;

    // Always store in Supabase (structured, queryable)
    await this.identityStore.addSessionTurn(sessionId, userId, role, content);

    // Store in Pinecone for semantic search if available
    if (this.longTermStore && this.embeddingProvider) {
      try {
        await this.longTermStore.store({
          userId,
          content,
          metadata: {
            type: 'conversation',
            source: role,
            importance: metadata?.importance,
            tags: metadata?.tags,
            topic: metadata?.topic,
          },
        });
      } catch (error) {
        console.error('[MemoryService] Failed to store in Pinecone:', error);
        // Don't fail the request - Supabase is the primary store
      }
    }
  }

  /**
   * Store an important fact/memory (high importance, persistent)
   * Use this for family information, preferences, significant events
   */
  async storeImportantFact(
    userId: string,
    content: string,
    options?: {
      topic?: string;
      tags?: string[];
      importance?: number;
    }
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Pinecone not configured - fact stored in session only');
      const sessionId = `${userId}-${new Date().toISOString().split('T')[0]}`;
      await this.identityStore.addSessionTurn(sessionId, userId, 'system', `[FACT] ${content}`);
      return null;
    }

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'fact',
        source: 'user',
        importance: options?.importance ?? 0.9, // Facts are high importance by default
        tags: options?.tags,
        topic: options?.topic,
      },
    });
  }

  /**
   * Store a user preference
   */
  async storePreference(
    userId: string,
    content: string,
    options?: {
      topic?: string;
      tags?: string[];
    }
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Pinecone not configured - preference stored in session only');
      const sessionId = `${userId}-${new Date().toISOString().split('T')[0]}`;
      await this.identityStore.addSessionTurn(sessionId, userId, 'system', `[PREFERENCE] ${content}`);
      return null;
    }

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'preference',
        source: 'user',
        importance: 0.8,
        tags: options?.tags,
        topic: options?.topic,
      },
    });
  }

  /**
   * Search for relevant memories using semantic search
   * Returns memories sorted by relevance score
   */
  async searchMemories(
    userId: string,
    query: string,
    options?: {
      topK?: number;
      threshold?: number;
      types?: MemoryMetadata['type'][];
    }
  ): Promise<RelevantMemory[]> {
    if (!this.longTermStore) {
      // Fall back to recent conversation history
      const history = await this.getConversationHistory(userId);
      // Simple keyword matching fallback
      const lowerQuery = query.toLowerCase();
      return history
        .filter((turn) => turn.content.toLowerCase().includes(lowerQuery))
        .slice(-10)
        .map((turn) => ({
          content: turn.content,
          type: 'conversation' as const,
          createdAt: new Date(turn.created_at),
          score: 0.5, // Default score for keyword match
        }));
    }

    const results = await this.longTermStore.search({
      query,
      userId,
      topK: options?.topK ?? 10,
      threshold: options?.threshold ?? 0.5,
      filters: options?.types ? { type: options.types } : undefined,
    });

    return results.map((r) => ({
      content: r.entry.content,
      type: r.entry.metadata.type,
      importance: r.entry.metadata.importance,
      createdAt: r.entry.createdAt,
      score: r.score,
    }));
  }

  /**
   * Build context from relevant memories for LLM prompt injection
   */
  async buildMemoryContext(userId: string, currentMessage: string): Promise<string | null> {
    const relevantMemories = await this.searchMemories(userId, currentMessage, {
      topK: 10,
      threshold: 0.6,
    });

    if (relevantMemories.length === 0) {
      return null;
    }

    // Group by type for better organization
    const facts = relevantMemories.filter((m) => m.type === 'fact');
    const preferences = relevantMemories.filter((m) => m.type === 'preference');
    const conversations = relevantMemories.filter((m) => m.type === 'conversation');

    let context = 'Relevant information from memory:\n\n';

    if (facts.length > 0) {
      context += '**Important Facts:**\n';
      facts.forEach((f) => {
        context += `- ${f.content}\n`;
      });
      context += '\n';
    }

    if (preferences.length > 0) {
      context += '**User Preferences:**\n';
      preferences.forEach((p) => {
        context += `- ${p.content}\n`;
      });
      context += '\n';
    }

    if (conversations.length > 0) {
      context += '**Related Past Conversations:**\n';
      conversations.slice(0, 5).forEach((c) => {
        context += `- ${c.content.substring(0, 200)}${c.content.length > 200 ? '...' : ''}\n`;
      });
    }

    return context;
  }

  /**
   * Delete a specific memory (only when explicitly requested by user)
   */
  async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Cannot delete - Pinecone not configured');
      return false;
    }

    try {
      await this.longTermStore.delete(memoryId, userId);
      console.log(`[MemoryService] Memory ${memoryId} deleted at user request`);
      return true;
    } catch (error) {
      console.error('[MemoryService] Failed to delete memory:', error);
      return false;
    }
  }

  /**
   * Get the identity store for direct access (e.g., user settings)
   */
  getIdentityStore(): SupabaseIdentityStore {
    return this.identityStore;
  }

  /**
   * Check if long-term memory (Pinecone) is available
   */
  hasLongTermMemory(): boolean {
    return this.longTermStore !== null;
  }
}

/**
 * Create a memory service instance with environment configuration
 *
 * Environment variables:
 * - VECTOR_PROVIDER: 'qdrant' or 'pinecone' (default: 'qdrant')
 *
 * For Qdrant (recommended for self-hosting):
 * - QDRANT_URL: e.g., "http://localhost:6333" or "https://your-cluster.qdrant.io"
 * - QDRANT_API_KEY: (optional, required for Qdrant Cloud)
 * - QDRANT_COLLECTION: e.g., "zenna-memories"
 *
 * For Pinecone (managed service):
 * - PINECONE_API_KEY: Your Pinecone API key
 * - PINECONE_INDEX_NAME: e.g., "zenna-memories"
 *
 * For embeddings:
 * - GOOGLE_AI_API_KEY: For Gemini embeddings (cheaper, 768 dimensions)
 * - OPENAI_API_KEY: For OpenAI embeddings (1536 dimensions)
 */
export function createMemoryService(): MemoryService {
  return new MemoryService({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
    // Vector provider preference
    vectorProvider: (process.env.VECTOR_PROVIDER as 'pinecone' | 'qdrant') || 'qdrant',
    // Qdrant config (self-hosted or cloud)
    qdrantUrl: process.env.QDRANT_URL,
    qdrantApiKey: process.env.QDRANT_API_KEY,
    qdrantCollectionName: process.env.QDRANT_COLLECTION || 'zenna-memories',
    // Pinecone config (fallback)
    pineconeApiKey: process.env.PINECONE_API_KEY,
    pineconeIndexName: process.env.PINECONE_INDEX_NAME,
    // Embedding config
    embeddingApiKey: process.env.GOOGLE_AI_API_KEY || process.env.OPENAI_API_KEY,
    embeddingProvider: process.env.OPENAI_API_KEY ? 'openai' : 'gemini',
  });
}
