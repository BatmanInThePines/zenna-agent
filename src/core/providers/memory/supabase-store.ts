/**
 * Supabase Memory Store
 *
 * Short-term memory and conversation storage using Supabase.
 * Provides real-time session management and conversation persistence.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  ShortTermMemoryStore,
  ConversationTurn,
  Conversation,
} from '../../interfaces/memory-store';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

interface DatabaseConversationTurn {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  audio_url?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface DatabaseConversation {
  id: string;
  user_id: string;
  title?: string;
  summary?: string;
  started_at: string;
  ended_at?: string;
  metadata?: Record<string, unknown>;
}

interface DatabaseSession {
  id: string;
  user_id: string;
  started_at: string;
  last_activity_at: string;
  turn_count: number;
}

export class SupabaseShortTermStore implements ShortTermMemoryStore {
  private client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.serviceRoleKey || config.anonKey);
  }

  async getSessionBuffer(sessionId: string): Promise<ConversationTurn[]> {
    const { data, error } = await this.client
      .from('session_turns')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching session buffer:', error);
      return [];
    }

    return (data || []).map(this.mapTurn);
  }

  async addToSession(
    sessionId: string,
    turn: Omit<ConversationTurn, 'id'>
  ): Promise<ConversationTurn> {
    const { data, error } = await this.client
      .from('session_turns')
      .insert({
        session_id: sessionId,
        conversation_id: turn.conversationId,
        user_id: turn.userId,
        role: turn.role,
        content: turn.content,
        audio_url: turn.audioUrl,
        metadata: turn.metadata,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add turn to session: ${error.message}`);
    }

    // Update session activity
    await this.client
      .from('sessions')
      .update({
        last_activity_at: new Date().toISOString(),
        turn_count: await this.getSessionTurnCount(sessionId),
      })
      .eq('id', sessionId);

    return this.mapTurn(data);
  }

  async clearSession(sessionId: string): Promise<void> {
    const { error } = await this.client
      .from('session_turns')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      throw new Error(`Failed to clear session: ${error.message}`);
    }
  }

  async getSessionMetadata(
    sessionId: string
  ): Promise<{ userId: string; startedAt: Date; turnCount: number } | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      userId: data.user_id,
      startedAt: new Date(data.started_at),
      turnCount: data.turn_count || 0,
    };
  }

  private async getSessionTurnCount(sessionId: string): Promise<number> {
    const { count } = await this.client
      .from('session_turns')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    return count || 0;
  }

  private mapTurn(row: DatabaseConversationTurn): ConversationTurn {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      role: row.role,
      content: row.content,
      audioUrl: row.audio_url,
      timestamp: new Date(row.created_at),
      metadata: row.metadata as ConversationTurn['metadata'],
    };
  }
}

/**
 * Conversation persistence using Supabase
 */
export class SupabaseConversationStore {
  private client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.serviceRoleKey || config.anonKey);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    // Insert conversation record
    const { error: convError } = await this.client.from('conversations').upsert({
      id: conversation.id,
      user_id: conversation.userId,
      title: conversation.title,
      summary: conversation.summary,
      started_at: conversation.startedAt.toISOString(),
      ended_at: conversation.endedAt?.toISOString(),
      metadata: conversation.metadata,
    });

    if (convError) {
      throw new Error(`Failed to save conversation: ${convError.message}`);
    }

    // Insert turns
    const turns = conversation.turns.map((turn) => ({
      id: turn.id,
      conversation_id: conversation.id,
      user_id: turn.userId,
      role: turn.role,
      content: turn.content,
      audio_url: turn.audioUrl,
      created_at: turn.timestamp.toISOString(),
      metadata: turn.metadata,
    }));

    const { error: turnsError } = await this.client
      .from('conversation_turns')
      .upsert(turns);

    if (turnsError) {
      throw new Error(`Failed to save conversation turns: ${turnsError.message}`);
    }
  }

  async getConversation(id: string, userId: string): Promise<Conversation | null> {
    const { data: conv, error: convError } = await this.client
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (convError || !conv) {
      return null;
    }

    const { data: turns } = await this.client
      .from('conversation_turns')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    return this.mapConversation(conv, turns || []);
  }

  async getConversationHistory(
    userId: string,
    options?: { limit?: number; offset?: number; dateRange?: { start: Date; end: Date } }
  ): Promise<Conversation[]> {
    let query = this.client
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    if (options?.dateRange) {
      query = query
        .gte('started_at', options.dateRange.start.toISOString())
        .lte('started_at', options.dateRange.end.toISOString());
    }

    const { data: conversations } = await query;

    if (!conversations || conversations.length === 0) {
      return [];
    }

    // Fetch turns for each conversation
    const results: Conversation[] = [];
    for (const conv of conversations) {
      const { data: turns } = await this.client
        .from('conversation_turns')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });

      results.push(this.mapConversation(conv, turns || []));
    }

    return results;
  }

  async searchConversations(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<Conversation[]> {
    // Full-text search on conversation turns
    const { data: matchingTurns } = await this.client
      .from('conversation_turns')
      .select('conversation_id')
      .textSearch('content', query)
      .limit(options?.limit || 10);

    if (!matchingTurns || matchingTurns.length === 0) {
      return [];
    }

    const conversationIds = [...new Set(matchingTurns.map((t) => t.conversation_id))];

    const { data: conversations } = await this.client
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .in('id', conversationIds);

    if (!conversations) {
      return [];
    }

    const results: Conversation[] = [];
    for (const conv of conversations) {
      const { data: turns } = await this.client
        .from('conversation_turns')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true });

      results.push(this.mapConversation(conv, turns || []));
    }

    return results;
  }

  private mapConversation(
    conv: DatabaseConversation,
    turns: DatabaseConversationTurn[]
  ): Conversation {
    return {
      id: conv.id,
      userId: conv.user_id,
      title: conv.title,
      summary: conv.summary,
      turns: turns.map((t) => ({
        id: t.id,
        conversationId: t.conversation_id,
        userId: t.user_id,
        role: t.role,
        content: t.content,
        audioUrl: t.audio_url,
        timestamp: new Date(t.created_at),
        metadata: t.metadata as ConversationTurn['metadata'],
      })),
      startedAt: new Date(conv.started_at),
      endedAt: conv.ended_at ? new Date(conv.ended_at) : undefined,
      metadata: conv.metadata as Conversation['metadata'],
    };
  }
}
