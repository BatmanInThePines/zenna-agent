/**
 * Pinecone Memory Store
 *
 * Long-term RAG memory using Pinecone vector database.
 * Stores embeddings for semantic search over conversation history.
 */

import { Pinecone, Index } from '@pinecone-database/pinecone';
import type {
  LongTermMemoryStore,
  MemoryEntry,
  MemoryMetadata,
  MemorySearchQuery,
  MemorySearchResult,
  Conversation,
} from '../../interfaces/memory-store';
import { v4 as uuidv4 } from 'uuid';

interface PineconeConfig {
  apiKey: string;
  indexName: string;
  environment?: string;
}

// Type for writing to Pinecone (excludes undefined)
type PineconeWriteMetadata = Record<string, string | string[] | number | boolean>;

// Type for reading from Pinecone
interface PineconeReadMetadata {
  userId: string;
  type: string;
  conversationId?: string;
  topic?: string;
  sentiment?: string;
  importance?: number;
  source?: string;
  tags?: string[];
  content: string;
  createdAt: string;
  updatedAt: string;
}

export class PineconeLongTermStore implements LongTermMemoryStore {
  private client: Pinecone;
  private index: Index | null = null;
  private config: PineconeConfig;
  private embeddingProvider: EmbeddingProvider;

  constructor(config: PineconeConfig, embeddingProvider: EmbeddingProvider) {
    this.config = config;
    this.client = new Pinecone({ apiKey: config.apiKey });
    this.embeddingProvider = embeddingProvider;
  }

  async initialize(): Promise<void> {
    this.index = this.client.index(this.config.indexName);
  }

  async store(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MemoryEntry> {
    if (!this.index) {
      await this.initialize();
    }

    const id = uuidv4();
    const now = new Date();

    // Generate embedding if not provided
    const embedding =
      entry.embedding || (await this.embeddingProvider.generateEmbedding(entry.content));

    const metadata: Record<string, string | string[] | number | boolean> = {
      userId: entry.userId,
      type: entry.metadata.type,
      content: entry.content,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Only add defined optional fields
    if (entry.metadata.conversationId) metadata.conversationId = entry.metadata.conversationId;
    if (entry.metadata.topic) metadata.topic = entry.metadata.topic;
    if (entry.metadata.sentiment) metadata.sentiment = entry.metadata.sentiment;
    if (entry.metadata.importance !== undefined) metadata.importance = entry.metadata.importance;
    if (entry.metadata.source) metadata.source = entry.metadata.source;
    if (entry.metadata.tags && entry.metadata.tags.length > 0) metadata.tags = entry.metadata.tags;

    await this.index!.upsert([
      {
        id,
        values: embedding,
        metadata,
      },
    ]);

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
    if (!this.index) {
      await this.initialize();
    }

    const result = await this.index!.fetch([id]);
    const record = result.records[id];

    if (!record || (record.metadata as unknown as PineconeReadMetadata)?.userId !== userId) {
      return null;
    }

    const metadata = record.metadata as unknown as PineconeReadMetadata;

    return {
      id,
      userId: metadata.userId,
      content: metadata.content,
      embedding: record.values,
      metadata: {
        type: metadata.type as MemoryMetadata['type'],
        conversationId: metadata.conversationId,
        topic: metadata.topic,
        sentiment: metadata.sentiment as MemoryMetadata['sentiment'],
        importance: metadata.importance,
        source: metadata.source as MemoryMetadata['source'],
        tags: metadata.tags,
      },
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
    };
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    if (!this.index) {
      await this.initialize();
    }

    // Generate embedding for query
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query.query);

    // Build filter
    const filter: Record<string, unknown> = {
      userId: { $eq: query.userId },
    };

    if (query.filters?.type && query.filters.type.length > 0) {
      filter.type = { $in: query.filters.type };
    }

    if (query.filters?.conversationId) {
      filter.conversationId = { $eq: query.filters.conversationId };
    }

    if (query.filters?.tags && query.filters.tags.length > 0) {
      filter.tags = { $in: query.filters.tags };
    }

    const results = await this.index!.query({
      vector: queryEmbedding,
      topK: query.topK || 10,
      filter,
      includeMetadata: true,
      includeValues: true,
    });

    return results.matches
      .filter((match) => (match.score || 0) >= (query.threshold || 0))
      .map((match) => {
        const metadata = match.metadata as unknown as PineconeReadMetadata;

        return {
          entry: {
            id: match.id,
            userId: metadata.userId,
            content: metadata.content,
            embedding: match.values,
            metadata: {
              type: metadata.type as MemoryMetadata['type'],
              conversationId: metadata.conversationId,
              topic: metadata.topic,
              sentiment: metadata.sentiment as MemoryMetadata['sentiment'],
              importance: metadata.importance,
              source: metadata.source as MemoryMetadata['source'],
              tags: metadata.tags,
            },
            createdAt: new Date(metadata.createdAt),
            updatedAt: new Date(metadata.updatedAt),
          },
          score: match.score || 0,
        };
      });
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
      id, // Preserve ID
      userId, // Preserve user
      updatedAt: new Date(),
    };

    // Regenerate embedding if content changed
    if (updates.content && updates.content !== existing.content) {
      updated.embedding = await this.embeddingProvider.generateEmbedding(
        updates.content
      );
    }

    const metadata: PineconeWriteMetadata = {
      userId: updated.userId,
      type: updated.metadata.type,
      content: updated.content,
      createdAt: existing.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };

    // Only add defined optional fields
    if (updated.metadata.conversationId) metadata.conversationId = updated.metadata.conversationId;
    if (updated.metadata.topic) metadata.topic = updated.metadata.topic;
    if (updated.metadata.sentiment) metadata.sentiment = updated.metadata.sentiment;
    if (updated.metadata.importance !== undefined) metadata.importance = updated.metadata.importance;
    if (updated.metadata.source) metadata.source = updated.metadata.source;
    if (updated.metadata.tags && updated.metadata.tags.length > 0) metadata.tags = updated.metadata.tags;

    await this.index!.upsert([
      {
        id,
        values: updated.embedding!,
        metadata,
      },
    ]);

    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    // Verify ownership before deletion
    const existing = await this.retrieve(id, userId);

    if (!existing) {
      throw new Error('Memory entry not found or access denied');
    }

    await this.index!.deleteOne(id);
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
    // Pinecone is used for semantic search, not listing
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
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }
}

/**
 * Google embedding provider (using Gemini)
 *
 * Uses gemini-embedding-001 model which supports flexible output dimensions.
 * IMPORTANT: Existing Qdrant data uses 768 dimensions, so we must maintain
 * this for compatibility. The model supports 128-3072 dimensions via
 * Matryoshka Representation Learning.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private outputDimensionality: number;

  constructor(apiKey: string, outputDimensionality: number = 768) {
    this.apiKey = apiKey;
    this.outputDimensionality = outputDimensionality;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Use gemini-embedding-001 (updated from deprecated text-embedding-004)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          // Maintain 768 dimensions for compatibility with existing Qdrant vectors
          outputDimensionality: this.outputDimensionality,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GeminiEmbeddingProvider] API error:', response.status, errorText);
      throw new Error(`Embedding generation failed: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    return data.embedding.values;
  }
}
