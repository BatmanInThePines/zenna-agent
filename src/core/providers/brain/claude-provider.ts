/**
 * Claude Brain Provider
 *
 * Anthropic Claude integration for Zenna.
 * Supports Claude 3.5 Sonnet and Claude 3 Opus.
 * Enhanced with tool use for real-time information access.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  BrainProvider,
  BrainProviderConfig,
  BrainResponse,
  StreamingBrainResponse,
  Message,
} from '../../interfaces/brain-provider';

// Tool definitions for Claude
export const ZENNA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: `Search the internet for real-time information. Use this tool when the user asks about:
- Weather conditions or forecasts (current weather, tomorrow's weather, etc.)
- Current time in any location
- Recent news or current events
- Sports scores or schedules
- Any information that requires up-to-date data from the internet

IMPORTANT: You MUST use this tool for weather questions - do not guess or make up weather information.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query or location to look up',
        },
        type: {
          type: 'string',
          enum: ['weather', 'time', 'news', 'general'],
          description: 'The type of search: weather for weather info, time for current time, news for news articles, general for other searches',
        },
      },
      required: ['query', 'type'],
    },
  },
];

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
      tools: ZENNA_TOOLS,
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

    // Debug logging
    console.log('[ClaudeProvider] Preparing streaming request:', {
      model,
      messageCount: claudeMessages.length,
      systemPromptLength: systemPrompt.length,
      firstMessageRole: claudeMessages[0]?.role,
      lastMessageRole: claudeMessages[claudeMessages.length - 1]?.role,
    });

    // Validate messages before sending
    if (claudeMessages.length === 0) {
      throw new Error('[ClaudeProvider] No messages to send to Claude API');
    }
    if (claudeMessages[0]?.role !== 'user') {
      console.error('[ClaudeProvider] First message is not from user:', claudeMessages[0]);
      throw new Error('[ClaudeProvider] First message must be from user role');
    }

    const client = this.client;
    const temperature = options?.temperature || this.config.temperature || 0.2;
    const maxTokens = options?.maxTokens || 2048;

    const stream = async function* () {
      try {
        const streamResponse = await client.messages.stream({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: claudeMessages,
          tools: ZENNA_TOOLS,
        });

        for await (const event of streamResponse) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            yield event.delta.text;
          }
        }
      } catch (error) {
        console.error('[ClaudeProvider] Stream error:', error);
        throw error;
      }
    };

    return {
      stream: stream(),
      model,
    };
  }

  /**
   * Generate response with tool use support
   * This method handles the full tool use loop for real-time information
   */
  async generateResponseWithTools(
    messages: Message[],
    options?: Partial<BrainProviderConfig>,
    executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<string>
  ): Promise<BrainResponse & { toolsUsed?: string[] }> {
    if (!this.client) {
      throw new Error('Claude provider not initialized');
    }

    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : (options?.systemPrompt || this.config.systemPrompt || '');

    let claudeMessages = this.convertToClaudeMessages(messages);
    const model = options?.model || this.config.model || 'claude-sonnet-4-20250514';
    const temperature = options?.temperature || this.config.temperature || 0.2;
    const maxTokens = options?.maxTokens || 2048;

    const toolsUsed: string[] = [];
    let totalTokens = 0;
    let finalContent = '';
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;

      console.log(`[ClaudeProvider] Tool iteration ${iterations}, messages:`, claudeMessages.length);

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: claudeMessages,
        tools: ZENNA_TOOLS,
      });

      totalTokens += response.usage.input_tokens + response.usage.output_tokens;

      // Check if we need to handle tool calls
      if (response.stop_reason === 'tool_use') {
        // Find tool use blocks
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          console.error('[ClaudeProvider] tool_use stop reason but no tool blocks found');
          break;
        }

        // Add assistant's response (with tool calls) to messages
        claudeMessages = [
          ...claudeMessages,
          { role: 'assistant' as const, content: response.content },
        ];

        // Execute tools and add results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          console.log(`[ClaudeProvider] Executing tool: ${toolBlock.name}`, toolBlock.input);
          toolsUsed.push(toolBlock.name);

          let toolResult: string;
          if (executeToolFn) {
            try {
              toolResult = await executeToolFn(toolBlock.name, toolBlock.input as Record<string, unknown>);
            } catch (error) {
              toolResult = `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          } else {
            toolResult = 'Tool execution not available';
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult,
          });
        }

        // Add tool results to messages
        claudeMessages = [
          ...claudeMessages,
          { role: 'user' as const, content: toolResults },
        ];
      } else {
        // No more tool calls, extract final response
        finalContent = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
        break;
      }
    }

    if (iterations >= maxIterations) {
      console.warn('[ClaudeProvider] Max tool iterations reached');
    }

    return {
      content: finalContent,
      tokensUsed: totalTokens,
      model,
      finishReason: 'stop',
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  }

  /**
   * Streaming response generator with tool use support
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

  /**
   * Streaming response with tool use support
   * Yields text chunks and handles tool calls internally
   */
  async *generateResponseStreamWithTools(
    messages: Message[],
    options?: Partial<BrainProviderConfig>,
    executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<string>
  ): AsyncGenerator<string, void, unknown> {
    if (!this.client) {
      throw new Error('Claude provider not initialized');
    }

    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : (options?.systemPrompt || this.config.systemPrompt || '');

    let claudeMessages = this.convertToClaudeMessages(messages);
    const model = options?.model || this.config.model || 'claude-sonnet-4-20250514';
    const temperature = options?.temperature || this.config.temperature || 0.2;
    const maxTokens = options?.maxTokens || 2048;

    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      console.log(`[ClaudeProvider] Stream+Tools iteration ${iterations}`);

      // First, make a non-streaming call to check for tool use
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: claudeMessages,
        tools: ZENNA_TOOLS,
      });

      if (response.stop_reason === 'tool_use') {
        // Handle tool calls
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // Yield a "thinking" message to show user we're fetching data
        const toolNames = toolUseBlocks.map(t => t.name).join(', ');
        yield `[Fetching real-time data: ${toolNames}...]\n\n`;

        // Add assistant's response to messages
        claudeMessages = [
          ...claudeMessages,
          { role: 'assistant' as const, content: response.content },
        ];

        // Execute tools
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          console.log(`[ClaudeProvider] Executing tool: ${toolBlock.name}`);

          let toolResult: string;
          if (executeToolFn) {
            try {
              toolResult = await executeToolFn(toolBlock.name, toolBlock.input as Record<string, unknown>);
            } catch (error) {
              toolResult = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
          } else {
            toolResult = 'Tool execution not available';
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult,
          });
        }

        // Add tool results
        claudeMessages = [
          ...claudeMessages,
          { role: 'user' as const, content: toolResults },
        ];
      } else {
        // No tool use, stream the response
        // Re-run with streaming since we know it won't use tools
        const streamResponse = await this.client.messages.stream({
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
        break;
      }
    }
  }

  private convertToClaudeMessages(
    messages: Message[]
  ): Anthropic.MessageParam[] {
    // Filter out system messages
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // CRITICAL: Claude API requires the first message to be from 'user'
    // If the conversation starts with an assistant message (e.g., greeting),
    // we need to skip those initial assistant messages
    let startIndex = 0;
    while (startIndex < nonSystemMessages.length && nonSystemMessages[startIndex].role === 'assistant') {
      startIndex++;
    }

    // If all messages are assistant messages (shouldn't happen), return empty array
    // which will cause an error, but that's better than a cryptic API error
    if (startIndex >= nonSystemMessages.length) {
      console.warn('[ClaudeProvider] No user messages found in conversation');
      return nonSystemMessages.length > 0 ? nonSystemMessages.slice(-1) : [];
    }

    const result = nonSystemMessages.slice(startIndex);

    // Also ensure alternating roles by merging consecutive same-role messages
    // Claude requires strict alternation: user, assistant, user, assistant...
    const merged: Anthropic.MessageParam[] = [];
    for (const msg of result) {
      if (merged.length === 0 || merged[merged.length - 1].role !== msg.role) {
        merged.push(msg);
      } else {
        // Merge with previous message of same role
        const prev = merged[merged.length - 1];
        if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content = prev.content + '\n\n' + msg.content;
        }
      }
    }

    return merged;
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
      case 'tool_use':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
