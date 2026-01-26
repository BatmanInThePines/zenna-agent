/**
 * Gemini Brain Provider
 *
 * Default reasoning model for Zenna: Gemini 2.5 Flash
 * Also supports Gemini 2.5 Pro for users who want higher capability
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type {
  BrainProvider,
  BrainProviderConfig,
  BrainResponse,
  StreamingBrainResponse,
  Message,
} from '../../interfaces/brain-provider';

export class GeminiProvider implements BrainProvider {
  readonly providerId: string;
  readonly providerName: string;

  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private config: BrainProviderConfig;

  constructor(config: BrainProviderConfig, variant: 'flash' | 'pro' = 'flash') {
    this.config = config;
    this.providerId = variant === 'flash' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
    this.providerName = variant === 'flash' ? 'Gemini 2.5 Flash' : 'Gemini 2.5 Pro';

    if (config.apiKey) {
      this.client = new GoogleGenerativeAI(config.apiKey);
      // Use stable Gemini model names (gemini-2.0-flash is the latest stable)
      const modelName = variant === 'flash'
        ? 'gemini-2.0-flash'
        : 'gemini-1.5-pro';
      this.model = this.client.getGenerativeModel({ model: config.model || modelName });
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.client !== null && this.model !== null;
  }

  async validateCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.client || !this.model) {
      return { valid: false, error: 'API key not configured' };
    }

    try {
      // Simple validation by attempting to generate
      const result = await this.model.generateContent('Say "ok" if you can hear me.');
      const text = result.response.text();
      return { valid: text.length > 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async generateResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<BrainResponse> {
    if (!this.model) {
      throw new Error('Gemini provider not initialized');
    }

    const systemPrompt = options?.systemPrompt || this.config.systemPrompt || '';
    const history = this.convertToGeminiHistory(messages);

    const chat = this.model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens || 2048,
        temperature: options?.temperature || this.config.temperature || 0.7,
      },
    });

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    const prompt = systemPrompt
      ? `${systemPrompt}\n\nUser: ${lastMessage.content}`
      : lastMessage.content;

    const result = await chat.sendMessage(prompt);
    const response = result.response;

    return {
      content: response.text(),
      model: this.providerId,
      finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
    };
  }

  async generateStreamingResponse(
    messages: Message[],
    options?: Partial<BrainProviderConfig>
  ): Promise<StreamingBrainResponse> {
    if (!this.model) {
      throw new Error('Gemini provider not initialized');
    }

    const systemPrompt = options?.systemPrompt || this.config.systemPrompt || '';
    const history = this.convertToGeminiHistory(messages.slice(0, -1));

    const chat = this.model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens || 2048,
        temperature: options?.temperature || this.config.temperature || 0.7,
      },
    });

    const lastMessage = messages[messages.length - 1];
    const prompt = systemPrompt
      ? `${systemPrompt}\n\nUser: ${lastMessage.content}`
      : lastMessage.content;

    const streamResult = await chat.sendMessageStream(prompt);

    const stream = async function* () {
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      }
    };

    return {
      stream: stream(),
      model: this.providerId,
    };
  }

  private convertToGeminiHistory(messages: Message[]): Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }> {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));
  }

  private mapFinishReason(
    reason?: string
  ): 'stop' | 'length' | 'content_filter' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
