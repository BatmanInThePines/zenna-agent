/**
 * Qdrant Memory Store
 *
 * Long-term RAG memory using Qdrant vector database.
 * Self-hostable, open-source alternative to Pinecone.
 *
 * Deployment options:
 * - Qdrant Cloud (managed): https://cloud.qdrant.io
 * - Self-hosted on GCP (Cloud Run or Compute Engine)
 * - Self-hosted on AWS (EC2 or ECS)
 * - Docker: docker run -p 6333:6333 qdrant/qdrant
 *
 * Cost comparison at scale:
 * - Pinecone: ~$70-100+/month for 1M+ vectors
 * - Qdrant Cloud: Free tier 1GB, then ~$25/month
 * - Qdrant Self-hosted: ~$27-50/month on e2-medium
 */

import type {
  LongTermMemoryStore,
  MemoryEntry,
  MemoryMetadata,
  MemorySearchQuery,
  MemorySearchResult,
  Conversation,
} from '../../interfaces/memory-store';
import { v4 as uuidv4 } from 'uuid';
import type { EmbeddingProvider } from './pinecone-store';

interface QdrantConfig {
  url: string; // e.g., "http://localhost:6333" or "https://your-cluster.qdrant.io"
  apiKey?: string; // Required for Qdrant Cloud
  collectionName: string;
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

interface QdrantSearchResult {
  id: string;
  version: number;
  score: number;
  payload: Record<string, unknown>;
  vector?: number[];
}

export class QdrantLongTermStore implements LongTermMemoryStore {
  private config: QdrantConfig;
  private embeddingProvider: EmbeddingProvider;
  private initialized = false;

  constructor(config: QdrantConfig, embeddingProvider: EmbeddingProvider) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
  }

  private async qdrantRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['api-key'] = this.config.apiKey;
    }

    const response = await fetch(`${this.config.url}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qdrant request failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if collection exists
    try {
      await this.qdrantRequest<{ result: { status: string } }>(
        `/collections/${this.config.collectionName}`
      );
      console.log(`[QdrantStore] Collection '${this.config.collectionName}' exists`);
    } catch {
      // Collection doesn't exist, create it
      // Determine vector size based on embedding provider
      // Gemini text-embedding-004: 768 dimensions
      // OpenAI text-embedding-3-small: 1536 dimensions
      const testEmbedding = await this.embeddingProvider.generateEmbedding('test');
      const vectorSize = testEmbedding.length;

      await this.qdrantRequest(
        `/collections/${this.config.collectionName}`,
        'PUT',
        {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
          // Optimize for search performance
          optimizers_config: {
            indexing_threshold: 10000, // Start indexing after 10K points
          },
          // Enable payload indexing for filtering
          on_disk_payload: true,
        }
      );

      // Create payload indexes for efficient filtering
      await this.qdrantRequest(
        `/collections/${this.config.collectionName}/index`,
        'PUT',
        {
          field_name: 'userId',
          field_schema: 'keyword',
        }
      );

      await this.qdrantRequest(
        `/collections/${this.config.collectionName}/index`,
        'PUT',
        {
          field_name: 'type',
          field_schema: 'keyword',
        }
      );

      await this.qdrantRequest(
        `/collections/${this.config.collectionName}/index`,
        'PUT',
        {
          field_name: 'memoryScope',
          field_schema: 'keyword',
        }
      );

      console.log(`[QdrantStore] Created collection '${this.config.collectionName}' with ${vectorSize} dimensions`);
    }

    this.initialized = true;
  }

  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MemoryEntry> {
    if (!this.initialized) {
      await this.initialize();
    }

    const id = uuidv4();
    const now = new Date();

    // Generate embedding if not provided
    const embedding =
      entry.embedding || (await this.embeddingProvider.generateEmbedding(entry.content));

    const point: QdrantPoint = {
      id,
      vector: embedding,
      payload: {
        userId: entry.userId,
        content: entry.content,
        type: entry.metadata.type,
        conversationId: entry.metadata.conversationId || null,
        topic: entry.metadata.topic || null,
        sentiment: entry.metadata.sentiment || null,
        importance: entry.metadata.importance ?? 0.5,
        source: entry.metadata.source || null,
        tags: entry.metadata.tags || [],
        memoryScope: entry.metadata.memoryScope || 'companion',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    };

    await this.qdrantRequest(
      `/collections/${this.config.collectionName}/points`,
      'PUT',
      {
        points: [point],
      }
    );

    return {
      id,
      userId: entry.userId,
      content: entry.content,
      embedding,
      metadata: entry.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  async retrieve(id: string, userId: string): Promise<MemoryEntry | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const response = await this.qdrantRequest<{
        result: Array<{
          id: string;
          payload: Record<string, unknown>;
          vector?: number[];
        }>;
      }>(
        `/collections/${this.config.collectionName}/points`,
        'POST',
        {
          ids: [id],
          with_payload: true,
          with_vector: true,
        }
      );

      const point = response.result[0];
      if (!point || point.payload.userId !== userId) {
        return null;
      }

      return this.pointToMemoryEntry(point);
    } catch {
      return null;
    }
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Generate embedding for query
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query.query);

    // Build filter
    const must: Array<Record<string, unknown>> = [
      {
        key: 'userId',
        match: { value: query.userId },
      },
    ];

    if (query.filters?.type && query.filters.type.length > 0) {
      must.push({
        key: 'type',
        match: { any: query.filters.type },
      });
    }

    if (query.filters?.conversationId) {
      must.push({
        key: 'conversationId',
        match: { value: query.filters.conversationId },
      });
    }

    if (query.filters?.tags && query.filters.tags.length > 0) {
      must.push({
        key: 'tags',
        match: { any: query.filters.tags },
      });
    }

    if (query.filters?.memoryScope && query.filters.memoryScope.length > 0) {
      must.push({
        key: 'memoryScope',
        match: { any: query.filters.memoryScope },
      });
    }

    const response = await this.qdrantRequest<{
      result: QdrantSearchResult[];
    }>(
      `/collections/${this.config.collectionName}/points/search`,
      'POST',
      {
        vector: queryEmbedding,
        limit: query.topK || 10,
        score_threshold: query.threshold || 0,
        filter: { must },
        with_payload: true,
        with_vector: true,
      }
    );

    return response.result.map((match) => ({
      entry: this.pointToMemoryEntry({
        id: match.id,
        payload: match.payload,
        vector: match.vector,
      }),
      score: match.score,
    }));
  }

  /**
   * Search across ALL users' memories (God-level access only).
   * SECURITY: Caller MUST verify God-level permissions before invoking.
   * This bypasses the standard userId isolation for ecosystem-wide scanning.
   */
  async searchAllUsers(params: {
    query: string;
    topK?: number;
    threshold?: number;
    filters?: {
      type?: MemoryMetadata['type'][];
      tags?: string[];
      memoryScope?: string[];
    };
  }): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Generate embedding for query
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(params.query);

    // Build filter WITHOUT userId constraint (cross-user search)
    const must: Array<Record<string, unknown>> = [];

    if (params.filters?.type && params.filters.type.length > 0) {
      must.push({
        key: 'type',
        match: { any: params.filters.type },
      });
    }

    if (params.filters?.tags && params.filters.tags.length > 0) {
      must.push({
        key: 'tags',
        match: { any: params.filters.tags },
      });
    }

    if (params.filters?.memoryScope && params.filters.memoryScope.length > 0) {
      must.push({
        key: 'memoryScope',
        match: { any: params.filters.memoryScope },
      });
    }

    const body: Record<string, unknown> = {
      vector: queryEmbedding,
      limit: params.topK || 50,
      score_threshold: params.threshold || 0.3,
      with_payload: true,
      with_vector: false, // Don't need embeddings back for read-only scan
    };

    if (must.length > 0) {
      body.filter = { must };
    }

    const response = await this.qdrantRequest<{
      result: QdrantSearchResult[];
    }>(
      `/collections/${this.config.collectionName}/points/search`,
      'POST',
      body
    );

    return response.result.map((match) => ({
      entry: this.pointToMemoryEntry({
        id: match.id,
        payload: match.payload,
        vector: match.vector,
      }),
      score: match.score,
    }));
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<MemoryEntry>
  ): Promise<MemoryEntry> {
    const existing = await this.retrieve(id, userId);

    if (!existing) {
      throw new Error('Memory entry not found');
    }

    const updated: MemoryEntry = {
      ...existing,
      ...updates,
      id,
      userId,
      updatedAt: new Date(),
    };

    // Regenerate embedding if content changed
    if (updates.content && updates.content !== existing.content) {
      updated.embedding = await this.embeddingProvider.generateEmbedding(updates.content);
    }

    const point: QdrantPoint = {
      id,
      vector: updated.embedding!,
      payload: {
        userId: updated.userId,
        content: updated.content,
        type: updated.metadata.type,
        conversationId: updated.metadata.conversationId || null,
        topic: updated.metadata.topic || null,
        sentiment: updated.metadata.sentiment || null,
        importance: updated.metadata.importance ?? 0.5,
        source: updated.metadata.source || null,
        tags: updated.metadata.tags || [],
        memoryScope: updated.metadata.memoryScope || 'companion',
        createdAt: existing.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    };

    await this.qdrantRequest(
      `/collections/${this.config.collectionName}/points`,
      'PUT',
      {
        points: [point],
      }
    );

    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    // Verify ownership before deletion
    const existing = await this.retrieve(id, userId);

    if (!existing) {
      throw new Error('Memory entry not found or access denied');
    }

    await this.qdrantRequest(
      `/collections/${this.config.collectionName}/points/delete`,
      'POST',
      {
        points: [id],
      }
    );
  }

  async persistConversation(conversation: Conversation): Promise<void> {
    // Store each turn as a memory entry
    for (const turn of conversation.turns) {
      await this.store({
        userId: conversation.userId,
        content: turn.content,
        metadata: {
          type: 'conversation',
          conversationId: conversation.id,
          source: turn.role,
        },
      });
    }

    // Store conversation summary if available
    if (conversation.summary) {
      await this.store({
        userId: conversation.userId,
        content: conversation.summary,
        metadata: {
          type: 'context',
          conversationId: conversation.id,
          topic: conversation.title,
          source: 'system',
        },
      });
    }
  }

  async getConversationHistory(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      dateRange?: { start: Date; end: Date };
    }
  ): Promise<Conversation[]> {
    // This is primarily handled by Supabase
    // Qdrant is used for semantic search, not listing
    throw new Error(
      'Use SupabaseConversationStore for conversation history listing'
    );
  }

  async searchConversations(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Conversation[]> {
    // Semantic search over conversation content
    const results = await this.search({
      query,
      userId,
      topK: options?.limit || 10,
      filters: { type: ['conversation'] },
    });

    // Group by conversation ID
    const conversationIds = [
      ...new Set(
        results
          .map((r) => r.entry.metadata.conversationId)
          .filter((id): id is string => !!id)
      ),
    ];

    // Note: Full conversation retrieval should be done via Supabase
    // This returns placeholder conversations with just the matched content
    return conversationIds.map((id) => ({
      id,
      userId,
      turns: results
        .filter((r) => r.entry.metadata.conversationId === id)
        .map((r) => ({
          id: r.entry.id,
          conversationId: id,
          userId,
          role: (r.entry.metadata.source || 'user') as 'user' | 'assistant',
          content: r.entry.content,
          timestamp: r.entry.createdAt,
        })),
      startedAt: new Date(),
    }));
  }

  /**
   * Get collection stats
   */
  async getStats(): Promise<{
    vectorCount: number;
    segmentsCount: number;
    status: string;
  }> {
    const response = await this.qdrantRequest<{
      result: {
        vectors_count: number;
        segments_count: number;
        status: string;
      };
    }>(`/collections/${this.config.collectionName}`);

    return {
      vectorCount: response.result.vectors_count,
      segmentsCount: response.result.segments_count,
      status: response.result.status,
    };
  }

  /**
   * Delete all memories for a user (GDPR compliance)
   */
  async deleteUserData(userId: string): Promise<number> {
    const response = await this.qdrantRequest<{
      result: { operation_id: number };
    }>(
      `/collections/${this.config.collectionName}/points/delete`,
      'POST',
      {
        filter: {
          must: [
            {
              key: 'userId',
              match: { value: userId },
            },
          ],
        },
      }
    );

    console.log(`[QdrantStore] Deleted all data for user ${userId}`);
    return response.result.operation_id;
  }

  /**
   * Count the approximate number of vectors owned by a user.
   * Used for memory quota estimation (~4KB per vector point).
   */
  async countUserVectors(userId: string): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const response = await this.qdrantRequest<{
        result: { count: number };
      }>(
        `/collections/${this.config.collectionName}/points/count`,
        'POST',
        {
          filter: {
            must: [
              {
                key: 'userId',
                match: { value: userId },
              },
            ],
          },
          exact: false, // Approximate count is fine for quota display
        }
      );

      return response.result.count;
    } catch (error) {
      console.error('[QdrantStore] Failed to count user vectors:', error);
      return 0;
    }
  }

  /**
   * Delete all vectors for a user that have a specific tag.
   * Used to clear notion-sync tagged memories when switching modes.
   */
  async deleteByTag(userId: string, tag: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    await this.qdrantRequest(
      `/collections/${this.config.collectionName}/points/delete`,
      'POST',
      {
        filter: {
          must: [
            {
              key: 'userId',
              match: { value: userId },
            },
            {
              key: 'tags',
              match: { value: tag },
            },
          ],
        },
      }
    );

    console.log(`[QdrantStore] Deleted vectors with tag '${tag}' for user ${userId}`);
  }

  private pointToMemoryEntry(point: {
    id: string;
    payload: Record<string, unknown>;
    vector?: number[];
  }): MemoryEntry {
    const payload = point.payload;

    return {
      id: point.id,
      userId: payload.userId as string,
      content: payload.content as string,
      embedding: point.vector,
      metadata: {
        type: payload.type as MemoryMetadata['type'],
        conversationId: payload.conversationId as string | undefined,
        topic: payload.topic as string | undefined,
        sentiment: payload.sentiment as MemoryMetadata['sentiment'],
        importance: payload.importance as number | undefined,
        source: payload.source as MemoryMetadata['source'],
        tags: payload.tags as string[] | undefined,
        memoryScope: (payload.memoryScope as MemoryMetadata['memoryScope']) || 'companion',
      },
      createdAt: new Date(payload.createdAt as string),
      updatedAt: new Date(payload.updatedAt as string),
    };
  }
}
