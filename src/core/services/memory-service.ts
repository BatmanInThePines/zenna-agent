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

    console.log('[MemoryService] Initializing memory service...');
    console.log('[MemoryService] Config check:', {
      hasEmbeddingApiKey: !!this.config.embeddingApiKey,
      embeddingProvider: this.config.embeddingProvider,
      vectorProvider: this.config.vectorProvider,
      hasQdrantUrl: !!this.config.qdrantUrl,
      hasQdrantCollection: !!this.config.qdrantCollectionName,
      hasPineconeKey: !!this.config.pineconeApiKey,
      hasPineconeIndex: !!this.config.pineconeIndexName,
    });

    // Create embedding provider if API key is available
    if (this.config.embeddingApiKey) {
      if (this.config.embeddingProvider === 'openai') {
        this.embeddingProvider = new OpenAIEmbeddingProvider(this.config.embeddingApiKey);
        console.log('[MemoryService] Using OpenAI embeddings');
      } else {
        // Default to Gemini (more cost-effective)
        this.embeddingProvider = new GeminiEmbeddingProvider(this.config.embeddingApiKey);
        console.log('[MemoryService] Using Gemini embeddings');
      }
    } else {
      console.warn('[MemoryService] No embedding API key configured!');
    }

    // Determine which vector store to use (prefer Qdrant for cost savings)
    const preferredProvider = this.config.vectorProvider || 'qdrant';
    console.log('[MemoryService] Preferred vector provider:', preferredProvider);

    // Try Qdrant first (self-hosted or cloud)
    if (
      preferredProvider === 'qdrant' &&
      this.config.qdrantUrl &&
      this.config.qdrantCollectionName &&
      this.embeddingProvider
    ) {
      try {
        console.log('[MemoryService] Attempting to initialize Qdrant...');
        console.log('[MemoryService] Qdrant URL:', this.config.qdrantUrl);
        console.log('[MemoryService] Qdrant Collection:', this.config.qdrantCollectionName);

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
        console.log('[MemoryService] ✓ Qdrant long-term memory initialized successfully');
      } catch (error) {
        console.warn('[MemoryService] Qdrant initialization failed, trying Pinecone:', error);
        this.longTermStore = null;
      }
    } else {
      console.log('[MemoryService] Qdrant not configured or missing dependencies:', {
        preferredProvider,
        hasQdrantUrl: !!this.config.qdrantUrl,
        hasQdrantCollection: !!this.config.qdrantCollectionName,
        hasEmbeddingProvider: !!this.embeddingProvider,
      });
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
   * NOTE: sessionId is just used for grouping - we query by userId for full history
   */
  async getConversationHistory(
    userId: string
  ): Promise<Array<{ role: string; content: string; created_at: string }>> {
    // Use a deterministic session ID based on userId only (not date)
    // The identity store queries by userId anyway, so this is just for legacy compatibility
    const sessionId = userId;
    return this.identityStore.getSessionHistory(sessionId, userId);
  }

  /**
   * Add a conversation turn to permanent storage
   * Stores in both Supabase (structured) and vector store (semantic search)
   */
  async addConversationTurn(
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: {
      importance?: number;
      tags?: string[];
      topic?: string;
      platformSource?: '360aware' | 'zenna_web' | 'zenna_mobile' | 'api';
      memoryScope?: 'companion' | 'engineering' | 'platform' | 'simulation';
    }
  ): Promise<void> {
    // Use userId as sessionId - the session_turns table expects UUID format
    // Appending date to UUID creates invalid UUID format
    const sessionId = userId;

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
            contextSource: 'companion_conversation', // BUG 3 FIX: Tag for memory classification
            platformSource: metadata?.platformSource || 'zenna_web',
            memoryScope: metadata?.memoryScope || 'companion',
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
        contextSource: 'personal_fact', // BUG 3 FIX: Tag for memory classification
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
        contextSource: 'user_preference',
      },
    });
  }

  /**
   * Store an internet search result as a memory
   * BUG 3 FIX: Internet searches now persist to memory with proper tagging
   */
  async storeInternetSearch(
    userId: string,
    query: string,
    result: string,
    options: {
      searchSource: string;        // e.g., "wttr.in", "Google News"
      searchType: 'weather' | 'news' | 'time' | 'general';
      topic?: string;
    }
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Vector store not configured - internet search not persisted');
      return null;
    }

    const content = `[Internet Search] Query: "${query}" | Result: ${result}`;

    console.log(`[MemoryService] Storing internet search: "${query}" from ${options.searchSource}`);

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'internet_search',
        source: 'external',
        importance: 0.6, // Medium importance - can be recalled but not as critical as personal facts
        tags: ['internet', options.searchType, options.searchSource.toLowerCase().replace(/\s+/g, '_')],
        topic: options.topic || options.searchType,
        contextSource: 'internet_search',
        searchQuery: query,
        searchSource: options.searchSource,
        retrievedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Store a smart home interaction as a memory
   * BUG 3 FIX: Smart home commands persist to memory
   */
  async storeSmartHomeInteraction(
    userId: string,
    command: string,
    result: string,
    options: {
      deviceType: string;
      deviceCommand: string;
      deviceName?: string;
    }
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Vector store not configured - smart home command not persisted');
      return null;
    }

    const content = `[Smart Home] ${options.deviceName || options.deviceType}: ${command} → ${result}`;

    console.log(`[MemoryService] Storing smart home command: ${options.deviceCommand} on ${options.deviceType}`);

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'smart_home',
        source: 'system',
        importance: 0.5, // Lower importance - routine commands
        tags: ['smart_home', options.deviceType, options.deviceCommand],
        topic: 'smart-home-control',
        contextSource: 'smart_home',
        deviceType: options.deviceType,
        deviceCommand: options.deviceCommand,
      },
    });
  }

  /**
   * Store a Notion interaction as a memory
   * Tracks all Notion tool invocations with appropriate tagging
   */
  async storeNotionInteraction(
    userId: string,
    action: string,
    input: Record<string, unknown>,
    result: string,
    memoryTag: string
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] Vector store not configured - Notion interaction not persisted');
      return null;
    }

    // Build a concise summary of the action
    const inputSummary = action === 'notion_search'
      ? `Query: "${input.query}"`
      : action === 'notion_get_page'
        ? `Page: ${input.page_id}`
        : action === 'notion_create_page'
          ? `Title: "${input.title}"`
          : action === 'notion_add_entry'
            ? `Entry: "${input.title}" in database ${input.database_id}`
            : JSON.stringify(input);

    const content = `${memoryTag} ${inputSummary} | Result: ${result.substring(0, 500)}`;

    console.log(`[MemoryService] Storing Notion interaction: ${action} - ${inputSummary}`);

    const isWriteAction = action.includes('create') || action.includes('add');

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'notion_action',
        source: 'external',
        importance: isWriteAction ? 0.8 : 0.6,
        tags: ['notion', action.replace('notion_', ''), memoryTag.replace(/[\[\]]/g, '')],
        topic: 'notion-workspace',
        contextSource: 'external_knowledge',
        memoryScope: 'engineering',
        notionAction: action,
        notionPageId: (input.page_id || input.database_id || input.parent_id) as string | undefined,
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
      memoryScopes?: ('companion' | 'engineering' | 'platform' | 'simulation')[];
    }
  ): Promise<RelevantMemory[]> {
    console.log(`[MemoryService] searchMemories called:`);
    console.log(`[MemoryService]   userId: ${userId}`);
    console.log(`[MemoryService]   query: "${query.substring(0, 60)}..."`);
    console.log(`[MemoryService]   longTermStore: ${!!this.longTermStore}`);
    console.log(`[MemoryService]   vectorProvider: ${this.vectorProvider}`);

    if (!this.longTermStore) {
      console.log('[MemoryService] No long-term store - falling back to keyword search');
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

    console.log(`[MemoryService] Searching Qdrant with topK=${options?.topK ?? 10}, threshold=${options?.threshold ?? 0.5}`);

    try {
      const filters: { type?: MemoryMetadata['type'][]; memoryScope?: ('companion' | 'engineering' | 'platform' | 'simulation')[] } = {};
      if (options?.types) filters.type = options.types;
      if (options?.memoryScopes) filters.memoryScope = options.memoryScopes;

      const results = await this.longTermStore.search({
        query,
        userId,
        topK: options?.topK ?? 10,
        threshold: options?.threshold ?? 0.5,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });

      console.log(`[MemoryService] Qdrant returned ${results.length} results`);

      return results.map((r) => ({
        content: r.entry.content,
        type: r.entry.metadata.type,
        importance: r.entry.metadata.importance,
        createdAt: r.entry.createdAt,
        score: r.score,
      }));
    } catch (error) {
      console.error('[MemoryService] Qdrant search error:', error);
      return [];
    }
  }

  /**
   * Scan ALL users' memories for feedback (issues, bugs, feature requests).
   * SECURITY: Only callable by God-level users. Caller MUST verify permissions.
   *
   * Performs multiple semantic searches with different query strategies
   * to maximize recall of user-reported problems.
   */
  async scanEcosystemFeedback(options?: {
    topK?: number;
    threshold?: number;
  }): Promise<Array<{
    content: string;
    userId: string;
    type: string;
    createdAt: Date;
    score: number;
    tags?: string[];
  }>> {
    if (!this.longTermStore) {
      console.warn('[MemoryService] No vector store — ecosystem scan unavailable');
      return [];
    }

    // Check if the long-term store supports cross-user search
    const store = this.longTermStore as { searchAllUsers?: (...args: unknown[]) => unknown };
    if (typeof store.searchAllUsers !== 'function') {
      console.error('[MemoryService] Vector store does not support cross-user search');
      return [];
    }

    // Cast to QdrantLongTermStore type for searchAllUsers
    const qdrantStore = this.longTermStore as import('../providers/memory/qdrant-store').QdrantLongTermStore;

    // Run multiple semantic searches to capture different phrasings
    const searchQueries = [
      'bug report problem issue error not working broken',
      'feature request would be nice wish could want need',
      'suggestion improvement idea enhancement',
      'frustrating annoying confusing difficult hard to use',
      'complaint issue problem with the system',
    ];

    const allResults = new Map<string, {
      content: string;
      userId: string;
      type: string;
      createdAt: Date;
      score: number;
      tags?: string[];
    }>();

    for (const query of searchQueries) {
      try {
        const results = await qdrantStore.searchAllUsers({
          query,
          topK: options?.topK ?? 30,
          threshold: options?.threshold ?? 0.4,
          filters: {
            type: ['conversation'], // Focus on conversation memories
            // Privacy: exclude companion scope to protect personal memories
            memoryScope: ['engineering', 'platform', 'simulation'],
          },
        });

        for (const r of results) {
          // Deduplicate by memory ID — keep highest score
          const existing = allResults.get(r.entry.id);
          if (!existing || r.score > existing.score) {
            allResults.set(r.entry.id, {
              content: r.entry.content,
              userId: r.entry.userId,
              type: r.entry.metadata.type,
              createdAt: r.entry.createdAt,
              score: r.score,
              tags: r.entry.metadata.tags,
            });
          }
        }
      } catch (error) {
        console.error(`[MemoryService] Ecosystem scan query failed: "${query}"`, error);
        // Continue with remaining queries
      }
    }

    console.log(`[MemoryService] Ecosystem scan found ${allResults.size} unique memories`);

    // Sort by score descending
    return Array.from(allResults.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Resolve a list of userIds to usernames for display.
   * Results are cached within the call to avoid redundant lookups.
   */
  async resolveUsernames(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueIds = [...new Set(userIds)];

    for (const id of uniqueIds) {
      try {
        const user = await this.identityStore.getUser(id);
        map.set(id, user?.username || id);
      } catch {
        map.set(id, id);
      }
    }

    return map;
  }

  // ============================================
  // NOTION SYNC HELPERS
  // ============================================

  /**
   * Check if the long-term store is available.
   */
  hasLongTermMemory(): boolean {
    return this.longTermStore !== null;
  }

  /**
   * Store a chunk from Notion sync, tagged for easy identification/cleanup.
   */
  async storeNotionSync(
    userId: string,
    content: string,
    pageTitle: string,
    pageId: string
  ): Promise<MemoryEntry | null> {
    if (!this.longTermStore) return null;

    return this.longTermStore.store({
      userId,
      content,
      metadata: {
        type: 'fact',
        source: 'external',
        importance: 0.7,
        tags: ['notion', 'notion-sync', 'knowledge-base'],
        topic: pageTitle,
        contextSource: 'external_knowledge',
        memoryScope: 'companion',
      },
    });
  }

  /**
   * Estimate the user's current memory usage in MB.
   * Uses Qdrant vector count with an approximate 4KB per vector point.
   */
  async estimateUserMemoryUsageMB(userId: string): Promise<number> {
    if (!this.longTermStore) return 0;

    // Only Qdrant supports countUserVectors
    const store = this.longTermStore as QdrantLongTermStore;
    if (typeof store.countUserVectors !== 'function') return 0;

    try {
      const count = await store.countUserVectors(userId);
      // Estimate: each vector point ≈ 4KB (embedding + payload + metadata)
      const estimatedBytes = count * 4096;
      return Math.round((estimatedBytes / (1024 * 1024)) * 100) / 100;
    } catch (error) {
      console.error('[MemoryService] Failed to estimate memory usage:', error);
      return 0;
    }
  }

  /**
   * Clear all notion-sync tagged memories for a user.
   * Used when switching from Sync mode back to Query on Demand.
   */
  async clearNotionSync(userId: string): Promise<void> {
    if (!this.longTermStore) return;

    const store = this.longTermStore as QdrantLongTermStore;
    if (typeof store.deleteByTag === 'function') {
      await store.deleteByTag(userId, 'notion-sync');
      console.log(`[MemoryService] Cleared notion-sync memories for user ${userId}`);
    }
  }

  /**
   * Build context from relevant memories for LLM prompt injection
   */
  async buildMemoryContext(userId: string, currentMessage: string): Promise<string | null> {
    console.log(`[MemoryService] Building memory context for: "${currentMessage.substring(0, 50)}..."`);
    console.log(`[MemoryService] Vector provider: ${this.vectorProvider}, hasLongTermStore: ${!!this.longTermStore}`);

    // PERFORMANCE FIX: Add timeout to prevent hanging on slow vector DB
    const MEMORY_TIMEOUT_MS = 8000; // 8 second timeout for memory retrieval

    const timeoutPromise = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((resolve) => {
          setTimeout(() => {
            console.warn(`[MemoryService] Memory search timed out after ${ms}ms, using fallback`);
            resolve(fallback);
          }, ms);
        }),
      ]);
    };

    // PERFORMANCE FIX: Run both searches in parallel instead of sequential
    const [factResults, conversationResults] = await Promise.all([
      timeoutPromise(
        this.searchMemories(userId, currentMessage, {
          topK: 10,
          threshold: 0.1, // Very low threshold for facts - we want to find them
          types: ['fact', 'preference'],
        }),
        MEMORY_TIMEOUT_MS,
        [] // Return empty array on timeout
      ),
      timeoutPromise(
        this.searchMemories(userId, currentMessage, {
          topK: 20,
          threshold: 0.2, // Slightly higher for conversations
          types: ['conversation'],
        }),
        MEMORY_TIMEOUT_MS,
        [] // Return empty array on timeout
      ),
    ]);

    console.log(`[MemoryService] Found ${factResults.length} facts/preferences`);
    console.log(`[MemoryService] Found ${conversationResults.length} conversation memories`);

    // Combine and deduplicate
    const seenContent = new Set<string>();
    const relevantMemories = [...factResults, ...conversationResults].filter(m => {
      const contentKey = m.content.substring(0, 100);
      if (seenContent.has(contentKey)) return false;
      seenContent.add(contentKey);
      return true;
    });

    console.log(`[MemoryService] Total unique memories: ${relevantMemories.length}`);

    if (relevantMemories.length === 0) {
      return null;
    }

    // CRITICAL FIX: Filter out user questions that just echo back the current query
    // User questions have high similarity but don't contain useful information
    // We want ASSISTANT responses and FACTS that contain actual answers
    const filteredMemories = relevantMemories.filter((m) => {
      // Keep all facts and preferences - these are important
      if (m.type === 'fact' || m.type === 'preference') {
        return true;
      }

      // For conversations, filter out user questions (they start with question patterns)
      const content = m.content.toLowerCase();
      const questionPatterns = [
        'what is my', 'what\'s my', 'who is my', 'who\'s my',
        'tell me', 'do you know', 'do you remember', 'can you tell',
        'what do you know about', 'remind me'
      ];

      // If it looks like a question the user asked, skip it
      const isUserQuestion = questionPatterns.some(pattern => content.startsWith(pattern));
      if (isUserQuestion) {
        console.log(`[MemoryService] Filtering out user question: "${m.content.substring(0, 50)}..."`);
        return false;
      }

      return true;
    });

    console.log(`[MemoryService] After filtering: ${filteredMemories.length} memories (removed ${relevantMemories.length - filteredMemories.length} user questions)`);

    if (filteredMemories.length === 0) {
      return null;
    }

    // Log top memories for debugging
    filteredMemories.slice(0, 3).forEach((m, i) => {
      console.log(`[MemoryService] Memory ${i + 1}: score=${m.score.toFixed(3)}, type=${m.type}, content="${m.content.substring(0, 80)}..."`);
    });

    // Group by type for better organization
    const facts = filteredMemories.filter((m) => m.type === 'fact');
    const preferences = filteredMemories.filter((m) => m.type === 'preference');
    const conversations = filteredMemories.filter((m) => m.type === 'conversation');

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
  // Determine embedding provider - prefer Gemini for cost savings and our Qdrant uses Gemini embeddings (768 dim)
  // Can be overridden with EMBEDDING_PROVIDER env var
  // IMPORTANT: Trim the value to handle any newline/whitespace issues from Vercel env vars
  const rawEmbeddingProvider = process.env.EMBEDDING_PROVIDER?.trim()?.toLowerCase();
  const embeddingProvider: 'openai' | 'gemini' = rawEmbeddingProvider === 'openai' ? 'openai' : 'gemini';
  const embeddingApiKey = embeddingProvider === 'gemini'
    ? process.env.GOOGLE_AI_API_KEY
    : process.env.OPENAI_API_KEY;

  console.log('[MemoryService] Creating service with:');
  console.log('[MemoryService]   - Raw EMBEDDING_PROVIDER:', JSON.stringify(process.env.EMBEDDING_PROVIDER));
  console.log('[MemoryService]   - Parsed provider:', embeddingProvider);
  console.log('[MemoryService]   - Has embedding API key:', !!embeddingApiKey);

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
    // Embedding config - IMPORTANT: Qdrant was populated with Gemini embeddings (768 dimensions)
    // Using a different provider will cause dimension mismatches!
    embeddingApiKey,
    embeddingProvider,
  });
}
