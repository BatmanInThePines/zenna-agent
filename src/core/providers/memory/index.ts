/**
 * Memory Store Factory
 *
 * Creates and combines memory stores for Zenna's three knowledge layers:
 * 1. Personal Memory (persistent, private, user-scoped)
 * 2. Session Context (ephemeral, conversation-scoped)
 * 3. External Research Context (attached, revocable)
 */

import type {
  MemoryStore,
  ShortTermMemoryStore,
  LongTermMemoryStore,
  ExternalContextStore,
  ExternalContextSource,
} from '../../interfaces/memory-store';
import {
  SupabaseShortTermStore,
  SupabaseConversationStore,
} from './supabase-store';
import {
  PineconeLongTermStore,
  EmbeddingProvider,
  GeminiEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from './pinecone-store';

interface MemoryStoreConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
  pinecone: {
    apiKey: string;
    indexName: string;
    environment?: string;
  };
  embedding: {
    provider: 'openai' | 'gemini';
    apiKey: string;
  };
}

/**
 * Stub external context store (Notion, NotebookLM integration)
 * Full implementation deferred
 */
class StubExternalContextStore implements ExternalContextStore {
  async getSources(userId: string): Promise<ExternalContextSource[]> {
    // TODO: Implement Notion/NotebookLM integration
    return [];
  }

  async addSource(
    source: Omit<ExternalContextSource, 'id'>
  ): Promise<ExternalContextSource> {
    throw new Error('External context integration not yet implemented');
  }

  async toggleSource(
    sourceId: string,
    userId: string,
    enabled: boolean
  ): Promise<void> {
    throw new Error('External context integration not yet implemented');
  }

  async removeSource(sourceId: string, userId: string): Promise<void> {
    throw new Error('External context integration not yet implemented');
  }

  async queryContext(
    userId: string,
    query: string,
    sourceIds?: string[]
  ): Promise<Array<{ source: string; content: string; relevance: number }>> {
    // No external context available yet
    return [];
  }
}

/**
 * Combined Memory Store implementation
 */
class CombinedMemoryStore implements MemoryStore {
  readonly shortTerm: ShortTermMemoryStore;
  readonly longTerm: LongTermMemoryStore;
  readonly external: ExternalContextStore;

  private embeddingProvider: EmbeddingProvider;
  private conversationStore: SupabaseConversationStore;

  constructor(config: MemoryStoreConfig) {
    // Create embedding provider
    this.embeddingProvider =
      config.embedding.provider === 'openai'
        ? new OpenAIEmbeddingProvider(config.embedding.apiKey)
        : new GeminiEmbeddingProvider(config.embedding.apiKey);

    // Create stores
    this.shortTerm = new SupabaseShortTermStore(config.supabase);
    this.longTerm = new PineconeLongTermStore(
      config.pinecone,
      this.embeddingProvider
    );
    this.external = new StubExternalContextStore();
    this.conversationStore = new SupabaseConversationStore(config.supabase);
  }

  async initialize(): Promise<void> {
    // Initialize Pinecone index
    await (this.longTerm as PineconeLongTermStore).initialize();
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embeddingProvider.generateEmbedding(text);
  }

  async getActiveKnowledgeSources(userId: string): Promise<{
    personalMemory: boolean;
    sessionContext: boolean;
    externalSources: Array<{ name: string; type: string }>;
  }> {
    const externalSources = await this.external.getSources(userId);

    return {
      personalMemory: true, // Always active
      sessionContext: true, // Always active during session
      externalSources: externalSources
        .filter((s) => s.enabled)
        .map((s) => ({ name: s.name, type: s.type })),
    };
  }

  async exportConversations(
    userId: string,
    conversationIds: string[],
    destination: 'notion' | 'notebooklm'
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    // TODO: Implement export to Notion/NotebookLM
    return {
      success: false,
      error: `Export to ${destination} not yet implemented`,
    };
  }

  /**
   * Helper: Get conversation store for direct access
   */
  getConversationStore(): SupabaseConversationStore {
    return this.conversationStore;
  }
}

/**
 * Factory function to create memory store
 */
export function createMemoryStore(config: MemoryStoreConfig): MemoryStore {
  return new CombinedMemoryStore(config);
}

// Re-export individual stores
export { SupabaseShortTermStore, SupabaseConversationStore } from './supabase-store';
export {
  PineconeLongTermStore,
  OpenAIEmbeddingProvider,
  GeminiEmbeddingProvider,
} from './pinecone-store';
export type { EmbeddingProvider } from './pinecone-store';
