/**
 * Claude Brain Provider
 *
 * Anthropic Claude integration for Zenna.
 * Supports Claude 3.5 Sonnet and Claude 3 Opus.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  BrainProvider,
  BrainProviderConfig,
  BrainResponse,
  StreamingBrainResponse,
  Message,
} from '../../interfaces/brain-provider';

export class ClaudeProvider implements BrainProvider {
  readonly providerId = 'claude';
  readonly providerName = 'Claude';

  private client: Anthropic | null = null;
  private config: BrainProviderConfig;

  constructor(config: BrainProviderConfig) {
    this.config = config;

    if (config.apiKey) {
      this.client = new Anthropic({ apiKey: config.apiKey });
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.client !== null;
  }

  async validateCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.client) {
      return { valid: false, error: 'API key not configured' };
    }

    try {
      await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say ok' }],
      });
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async generateResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<BrainResponse> {
    if (!this.client) {
      throw new Error('Claude provider not initialized');
    }

    // Extract and combine ALL system messages (master prompt + memory context + guardrails)
    // This matches how Gemini handles systemInstruction
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : (options?.systemPrompt || this.config.systemPrompt || '');

    const claudeMessages = this.convertToClaudeMessages(messages);

    const response = await this.client.messages.create({
      model: options?.model || this.config.model || 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || this.config.maxTokens || 2048,
      // LOW TEMPERATURE for strict adherence to system prompt (ElevenLabs recommends 0.0-0.3)
      temperature: options?.temperature || this.config.temperature || 0.2,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      content,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      model: response.model,
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  async generateStreamingResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<StreamingBrainResponse> {
    if (!this.client) {
      throw new Error('Claude provider not initialized');
    }

    // Extract and combine ALL system messages (master prompt + memory context + guardrails)
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : (options?.systemPrompt || this.config.systemPrompt || '');

    const claudeMessages = this.convertToClaudeMessages(messages);
    const model = options?.model || this.config.model || 'claude-sonnet-4-20250514';

    const client = this.client;
    const temperature = options?.temperature || this.config.temperature || 0.2;
    const maxTokens = options?.maxTokens || 2048;

    const stream = async function* () {
      const streamResponse = await client.messages.stream({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: claudeMessages,
      });

      for await (const event of streamResponse) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
    };

    return {
      stream: stream(),
      model,
    };
  }

  /**
   * Streaming response generator (alias for generateStreamingResponse)
   * Used by chat-stream route - matches Gemini provider interface
   */
  async *generateResponseStream(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): AsyncGenerator<string> {
    const response = await this.generateStreamingResponse(messages, options);
    for await (const chunk of response.stream) {
      yield chunk;
    }
  }

  private convertToClaudeMessages(
    messages: Message[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  }

  private mapStopReason(
    reason: string | null
  ): 'stop' | 'length' | 'content_filter' | 'error' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
