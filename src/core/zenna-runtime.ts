/**
 * Zenna Runtime
 *
 * The core conversation loop that coordinates:
 * - Voice input (ASR)
 * - Reasoning (LLM)
 * - Voice output (TTS)
 * - Memory (short-term + long-term)
 * - Avatar state
 *
 * This is Zenna's "brain loop" - the heartbeat of the agent.
 */

import type { BrainProvider, Message } from './interfaces/brain-provider';
import type { VoicePipeline, ASRResult } from './interfaces/voice-pipeline';
import type { MemoryStore, ConversationTurn, Conversation } from './interfaces/memory-store';
import type { IdentityStore, User, MasterConfig } from './interfaces/user-identity';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// RUNTIME STATE
// ============================================

export type ZennaState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface ZennaContext {
  userId: string;
  sessionId: string;
  conversationId: string;
  masterConfig: MasterConfig;
  userSettings: User['settings'];
}

// ============================================
// EVENT EMITTER
// ============================================

export type ZennaEventType =
  | 'stateChange'
  | 'transcriptUpdate'
  | 'responseStart'
  | 'responseChunk'
  | 'responseEnd'
  | 'error'
  | 'turnComplete';

export interface ZennaEvent {
  type: ZennaEventType;
  data: unknown;
  timestamp: Date;
}

type ZennaEventHandler = (event: ZennaEvent) => void;

// ============================================
// ZENNA RUNTIME
// ============================================

export class ZennaRuntime {
  private brain: BrainProvider;
  private voice: VoicePipeline;
  private memory: MemoryStore;
  private identity: IdentityStore;

  private state: ZennaState = 'idle';
  private context: ZennaContext | null = null;
  private conversationHistory: Message[] = [];
  private eventHandlers: Map<ZennaEventType, Set<ZennaEventHandler>> = new Map();

  constructor(
    brain: BrainProvider,
    voice: VoicePipeline,
    memory: MemoryStore,
    identity: IdentityStore
  ) {
    this.brain = brain;
    this.voice = voice;
    this.memory = memory;
    this.identity = identity;
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async initialize(userId: string, sessionId: string): Promise<void> {
    // Load user and master config
    const user = await this.identity.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const masterConfig = await this.identity.getMasterConfig();

    // Create conversation ID
    const conversationId = uuidv4();

    this.context = {
      userId,
      sessionId,
      conversationId,
      masterConfig,
      userSettings: user.settings,
    };

    // Initialize conversation with system prompt
    this.conversationHistory = [
      {
        role: 'system',
        content: this.buildSystemPrompt(masterConfig, user.settings),
      },
    ];

    // Initialize voice pipeline
    await this.voice.initialize();

    // Initialize memory
    await this.memory.initialize();

    this.setState('idle');
  }

  async shutdown(): Promise<void> {
    // Persist conversation to long-term memory
    if (this.context && this.conversationHistory.length > 1) {
      await this.persistConversation();
    }

    this.voice.stopListening();
    this.context = null;
    this.conversationHistory = [];
    this.setState('idle');
  }

  // ============================================
  // GREETING
  // ============================================

  async greet(): Promise<void> {
    if (!this.context) {
      throw new Error('Runtime not initialized');
    }

    const greeting = this.context.masterConfig.greeting;

    this.setState('speaking');
    this.emit('responseStart', { text: greeting });

    await this.voice.speak(greeting);

    // Add greeting to history
    this.conversationHistory.push({
      role: 'assistant',
      content: greeting,
      timestamp: new Date(),
    });

    this.emit('responseEnd', { text: greeting });
    this.setState('idle');
  }

  // ============================================
  // VOICE CONVERSATION LOOP
  // ============================================

  async startListening(): Promise<void> {
    if (!this.context) {
      throw new Error('Runtime not initialized');
    }

    this.setState('listening');

    let finalTranscript = '';

    try {
      for await (const result of this.voice.startListening()) {
        this.emit('transcriptUpdate', {
          transcript: result.transcript,
          isFinal: result.isFinal,
        });

        if (result.isFinal && result.transcript.trim()) {
          finalTranscript = result.transcript;
          break;
        }
      }

      if (finalTranscript) {
        await this.processUserInput(finalTranscript);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  stopListening(): void {
    this.voice.stopListening();
    if (this.state === 'listening') {
      this.setState('idle');
    }
  }

  // ============================================
  // TEXT INPUT (FALLBACK)
  // ============================================

  async processTextInput(text: string): Promise<void> {
    if (!this.context) {
      throw new Error('Runtime not initialized');
    }

    await this.processUserInput(text);
  }

  // ============================================
  // CORE PROCESSING
  // ============================================

  private async processUserInput(userText: string): Promise<void> {
    if (!this.context) return;

    this.setState('thinking');

    // Add user message to history
    const userMessage: Message = {
      role: 'user',
      content: userText,
      timestamp: new Date(),
    };
    this.conversationHistory.push(userMessage);

    // Store in short-term memory
    await this.memory.shortTerm.addToSession(this.context.sessionId, {
      conversationId: this.context.conversationId,
      userId: this.context.userId,
      role: 'user',
      content: userText,
      timestamp: new Date(),
    });

    // Retrieve relevant memories for context
    const relevantMemories = await this.retrieveRelevantContext(userText);

    // Build messages with context
    const messagesWithContext = this.buildMessagesWithContext(relevantMemories);

    try {
      // Generate streaming response
      const { stream } = await this.brain.generateStreamingResponse(messagesWithContext);

      this.setState('speaking');

      let fullResponse = '';

      // Collect text chunks for TTS
      const textChunks: string[] = [];

      // Process stream
      for await (const chunk of stream) {
        fullResponse += chunk;
        textChunks.push(chunk);
        this.emit('responseChunk', { chunk, fullResponse });
      }

      this.emit('responseEnd', { text: fullResponse });

      // Speak the response (streaming TTS)
      const textStream = async function* () {
        for (const chunk of textChunks) {
          yield chunk;
        }
      };

      await this.voice.speakStream(textStream());

      // Add assistant response to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      };
      this.conversationHistory.push(assistantMessage);

      // Store in short-term memory
      await this.memory.shortTerm.addToSession(this.context.sessionId, {
        conversationId: this.context.conversationId,
        userId: this.context.userId,
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
      });

      this.emit('turnComplete', {
        userMessage: userText,
        assistantMessage: fullResponse,
      });

      this.setState('idle');
    } catch (error) {
      this.handleError(error);
    }
  }

  // ============================================
  // CONTEXT RETRIEVAL
  // ============================================

  private async retrieveRelevantContext(query: string): Promise<string[]> {
    if (!this.context) return [];

    const results = await this.memory.longTerm.search({
      query,
      userId: this.context.userId,
      topK: 5,
      threshold: 0.7,
    });

    return results.map((r) => r.entry.content);
  }

  private buildMessagesWithContext(relevantMemories: string[]): Message[] {
    const messages = [...this.conversationHistory];

    // Inject relevant memories into context
    if (relevantMemories.length > 0) {
      const memoryContext = `Relevant information from previous conversations:\n${relevantMemories.join('\n---\n')}`;

      // Insert after system message
      messages.splice(1, 0, {
        role: 'system',
        content: memoryContext,
      });
    }

    return messages;
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  private async persistConversation(): Promise<void> {
    if (!this.context) return;

    const turns: ConversationTurn[] = this.conversationHistory
      .filter((m) => m.role !== 'system')
      .map((m, i) => ({
        id: uuidv4(),
        conversationId: this.context!.conversationId,
        userId: this.context!.userId,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp || new Date(),
      }));

    const conversation: Conversation = {
      id: this.context.conversationId,
      userId: this.context.userId,
      turns,
      startedAt: turns[0]?.timestamp || new Date(),
      endedAt: new Date(),
    };

    await this.memory.longTerm.persistConversation(conversation);
  }

  // ============================================
  // SYSTEM PROMPT
  // ============================================

  private buildSystemPrompt(
    masterConfig: MasterConfig,
    userSettings: User['settings']
  ): string {
    let prompt = masterConfig.systemPrompt;

    // Add immutable rules
    if (masterConfig.immutableRules.length > 0) {
      prompt += `\n\nImmutable rules (never violate these):\n${masterConfig.immutableRules
        .map((r, i) => `${i + 1}. ${r}`)
        .join('\n')}`;
    }

    // Add guardrails
    if (masterConfig.guardrails.blockedTopics?.length) {
      prompt += `\n\nDo not discuss: ${masterConfig.guardrails.blockedTopics.join(', ')}`;
    }

    // Add user's personal prompt
    if (userSettings.personalPrompt) {
      prompt += `\n\nUser preferences:\n${userSettings.personalPrompt}`;
    }

    return prompt;
  }

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  getState(): ZennaState {
    return this.state;
  }

  private setState(newState: ZennaState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit('stateChange', { oldState, newState });
  }

  // ============================================
  // EVENTS
  // ============================================

  on(event: ZennaEventType, handler: ZennaEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: ZennaEventType, handler: ZennaEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(type: ZennaEventType, data: unknown): void {
    const event: ZennaEvent = {
      type,
      data,
      timestamp: new Date(),
    };

    this.eventHandlers.get(type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${type}:`, error);
      }
    });
  }

  // ============================================
  // ERROR HANDLING
  // ============================================

  private handleError(error: unknown): void {
    console.error('Zenna runtime error:', error);
    this.setState('error');
    this.emit('error', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error,
    });

    // Recover to idle state after error
    setTimeout(() => {
      if (this.state === 'error') {
        this.setState('idle');
      }
    }, 3000);
  }

  // ============================================
  // KNOWLEDGE SOURCES
  // ============================================

  async getActiveKnowledgeSources(): Promise<{
    personalMemory: boolean;
    sessionContext: boolean;
    externalSources: Array<{ name: string; type: string }>;
  }> {
    if (!this.context) {
      throw new Error('Runtime not initialized');
    }

    return this.memory.getActiveKnowledgeSources(this.context.userId);
  }
}
