/**
 * OpenAI Brain Provider
 *
 * OpenAI GPT integration for Zenna.
 * Supports GPT-4o, GPT-4 Turbo, etc.
 */

import OpenAI from 'openai';
import type {
  BrainProvider,
  BrainProviderConfig,
  BrainResponse,
  StreamingBrainResponse,
  Message,
} from '../../interfaces/brain-provider';

export class OpenAIProvider implements BrainProvider {
  readonly providerId = 'openai';
  readonly providerName = 'OpenAI';

  private client: OpenAI | null = null;
  private config: BrainProviderConfig;

  constructor(config: BrainProviderConfig) {
    this.config = config;

    if (config.apiKey) {
      this.client = new OpenAI({ apiKey: config.apiKey });
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
      await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
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
      throw new Error('OpenAI provider not initialized');
    }

    const openaiMessages = this.convertToOpenAIMessages(messages, options?.systemPrompt);

    const response = await this.client.chat.completions.create({
      model: options?.model || this.config.model || 'gpt-4o',
      max_tokens: options?.maxTokens || this.config.maxTokens || 2048,
      temperature: options?.temperature || this.config.temperature || 0.7,
      messages: openaiMessages,
    });

    const choice = response.choices[0];

    return {
      content: choice.message.content || '',
      tokensUsed: response.usage?.total_tokens,
      model: response.model,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async generateStreamingResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<StreamingBrainResponse> {
    if (!this.client) {
      throw new Error('OpenAI provider not initialized');
    }

    const openaiMessages = this.convertToOpenAIMessages(messages, options?.systemPrompt);
    const model = options?.model || this.config.model || 'gpt-4o';

    const client = this.client;

    const stream = async function* () {
      const streamResponse = await client.chat.completions.create({
        model,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature || 0.7,
        messages: openaiMessages,
        stream: true,
      });

      for await (const chunk of streamResponse) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    };

    return {
      stream: stream(),
      model,
    };
  }

  private convertToOpenAIMessages(
    messages: Message[],
    systemPrompt?: string
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const result: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    // Add system prompt if provided
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    // Add conversation messages
    for (const msg of messages) {
      if (msg.role === 'system' && !systemPrompt) {
        result.push({ role: 'system', content: msg.content });
      } else if (msg.role !== 'system') {
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  private mapFinishReason(
    reason: string | null
  ): 'stop' | 'length' | 'content_filter' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
