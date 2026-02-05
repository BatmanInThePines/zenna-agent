/**
 * Gemini Brain Provider
 *
 * Default reasoning model for Zenna: Gemini 2.5 Flash
 * Also supports Gemini 2.5 Pro for users who want higher capability
 *
 * SYSTEM PROMPT ENFORCEMENT:
 * Following ElevenLabs best practices for LLM adherence:
 * 1. System instructions are passed via systemInstruction parameter (not in chat)
 * 2. Low temperature (0.1-0.3) for deterministic, consistent responses
 * 3. Clear section headers for guardrails and rules
 * 4. Critical instructions are emphasized with "This step is important"
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
  private config: BrainProviderConfig;

  constructor(config: BrainProviderConfig, variant: 'flash' | 'pro' = 'flash') {
    this.config = config;
    this.providerId = variant === 'flash' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
    this.providerName = variant === 'flash' ? 'Gemini 2.5 Flash' : 'Gemini 2.5 Pro';

    if (config.apiKey) {
      this.client = new GoogleGenerativeAI(config.apiKey);
    }
  }

  /**
   * Get model name based on variant
   */
  private getModelName(variant: 'flash' | 'pro' = 'flash'): string {
    return variant === 'flash' ? 'gemini-2.0-flash' : 'gemini-1.5-pro';
  }

  async isAvailable(): Promise<boolean> {
    return this.client !== null;
  }

  async validateCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.client) {
      return { valid: false, error: 'API key not configured' };
    }

    try {
      // Simple validation by attempting to generate
      const model = this.client.getGenerativeModel({ model: this.getModelName() });
      const result = await model.generateContent('Say "ok" if you can hear me.');
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
    if (!this.client) {
      throw new Error('Gemini provider not initialized');
    }

    // Extract system prompt from messages (first system message is master prompt)
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemInstruction = systemMessages.map(m => m.content).join('\n\n');

    // Create model with systemInstruction - THIS IS THE KEY FIX
    // Gemini treats systemInstruction as authoritative, non-negotiable instructions
    const model = this.client.getGenerativeModel({
      model: this.config.model || this.getModelName(),
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens || 2048,
        // LOW TEMPERATURE for strict adherence to system prompt (ElevenLabs recommends 0.0-0.3)
        temperature: options?.temperature || this.config.temperature || 0.2,
      },
    });

    // Convert non-system messages to Gemini history format
    const history = this.convertToGeminiHistory(messages);

    const chat = model.startChat({ history });

    // Get the last user message
    const lastMessage = messages[messages.length - 1];

    const result = await chat.sendMessage(lastMessage.content);
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
    if (!this.client) {
      throw new Error('Gemini provider not initialized');
    }

    // Extract system prompt from messages (first system message is master prompt)
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemInstruction = systemMessages.map(m => m.content).join('\n\n');

    // Create model with systemInstruction - THIS IS THE KEY FIX
    // Gemini treats systemInstruction as authoritative, non-negotiable instructions
    const model = this.client.getGenerativeModel({
      model: this.config.model || this.getModelName(),
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.config.maxTokens || 2048,
        // LOW TEMPERATURE for strict adherence to system prompt (ElevenLabs recommends 0.0-0.3)
        temperature: options?.temperature || this.config.temperature || 0.2,
      },
    });

    // Convert non-system messages to Gemini history
    const history = this.convertToGeminiHistory(messages.slice(0, -1));

    const chat = model.startChat({ history });

    const lastMessage = messages[messages.length - 1];

    const streamResult = await chat.sendMessageStream(lastMessage.content);

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

  /**
   * Streaming response generator (alias for generateStreamingResponse)
   * Used by chat-stream route
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
