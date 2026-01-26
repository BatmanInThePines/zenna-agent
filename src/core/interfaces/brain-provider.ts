/**
 * BrainProvider Interface
 *
 * Abstraction layer for LLM reasoning providers.
 * Supports pluggable providers: Gemini, Claude, OpenAI, Local models.
 *
 * Design Principle: Cloud-first now, local-first compatible later.
 * Swapping providers should require only configuration changes, not code rewrites.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface BrainResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
}

export interface StreamingBrainResponse {
  stream: AsyncIterable<string>;
  model?: string;
}

export interface BrainProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

/**
 * Core interface for all LLM providers.
 * Implementations must handle their own API specifics internally.
 */
export interface BrainProvider {
  /**
   * Provider identifier
   */
  readonly providerId: string;

  /**
   * Human-readable provider name
   */
  readonly providerName: string;

  /**
   * Check if the provider is properly configured and available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Validate API credentials
   */
  validateCredentials(): Promise<{ valid: boolean; error?: string }>;

  /**
   * Generate a complete response (blocking)
   */
  generateResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<BrainResponse>;

  /**
   * Generate a streaming response (non-blocking, for real-time voice)
   * Critical for low-latency TTS: tokens stream as they're generated
   */
  generateStreamingResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<StreamingBrainResponse>;
}

/**
 * Factory for creating BrainProvider instances
 */
export interface BrainProviderFactory {
  create(providerId: string, config: BrainProviderConfig): BrainProvider;
  getSupportedProviders(): string[];
}

/**
 * Supported provider identifiers
 */
export const BRAIN_PROVIDERS = {
  GEMINI_FLASH: 'gemini-2.5-flash',
  GEMINI_PRO: 'gemini-2.5-pro',
  CLAUDE: 'claude',
  OPENAI: 'openai',
  LOCAL: 'local', // Future: Ollama, llama.cpp, etc.
} as const;

export type BrainProviderId = typeof BRAIN_PROVIDERS[keyof typeof BRAIN_PROVIDERS];
