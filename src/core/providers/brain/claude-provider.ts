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

// Base tools - always available (no external integrations required)
export const BASE_TOOLS: Anthropic.Tool[] = [
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

// Notion Integration Tools - only included when user explicitly requests Notion
export const NOTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'notion_search',
    description: `Search the user's connected Notion workspace for pages and databases. Use when the user asks to find, look up, or search for something in their Notion workspace.

Examples: "Search my Notion for sprint planning", "Find my to-do list in Notion", "Look up my meeting notes"

IMPORTANT: Only use this tool if the user has Notion connected (indicated in the system prompt).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find pages or databases',
        },
        filter: {
          type: 'string',
          enum: ['page', 'database'],
          description: 'Optional: filter results to only pages or only databases',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_get_page',
    description: `Retrieve and read the full content of a specific Notion page by its ID. Use after searching to get the details of a specific page the user wants to read.

IMPORTANT: You need a page ID from a previous notion_search result. Do not guess page IDs.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID to retrieve (from a previous search result)',
        },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'notion_create_page',
    description: `Create a new page in the user's Notion workspace. Use when the user wants to document something, capture notes, or create a new page in Notion.

Examples: "Create meeting notes in Notion", "Document this conversation", "Add a page about our product idea"

If no parent_id is provided, the page will be created at the workspace root level.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'The title of the new page',
        },
        content: {
          type: 'string',
          description: 'The page content in markdown format (supports # headings, - bullets, 1. numbered lists, [ ] to-dos)',
        },
        parent_id: {
          type: 'string',
          description: 'Optional: parent page or database ID. If omitted, creates at workspace root.',
        },
        parent_type: {
          type: 'string',
          enum: ['page', 'database'],
          description: 'Whether the parent is a page or database. Defaults to page.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'notion_add_entry',
    description: `Add a new entry (row) to an existing Notion database. Use when the user wants to add tasks, bugs, backlog items, or any entries to a database.

Examples: "Add this bug to the sprint backlog", "Create a task in my project tracker", "Log a feature request"

IMPORTANT: Use notion_search with filter "database" first to find the target database ID and understand its schema before adding entries.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        database_id: {
          type: 'string',
          description: 'The target Notion database ID (from a previous search result)',
        },
        title: {
          type: 'string',
          description: 'The title/name of the new entry',
        },
        properties: {
          type: 'object' as const,
          description: 'Key-value pairs for database properties (e.g., {"Status": "To Do", "Priority": "High"}). Property names must match the database schema.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['database_id', 'title'],
    },
  },
  {
    name: 'notion_delta_check',
    description: `Check for recent changes in the user's Notion workspace since the last check-in. Returns modified pages, updated database entries, and who made each change.

Use when: "What's new in Notion?", "Any updates since last time?", "What changed in my workspace?", "Check Notion for changes"

Returns a summary of all modifications including who changed what and when. Automatically tracks the last check timestamp so subsequent calls only show new changes.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        database_id: {
          type: 'string',
          description: 'Optional: check a specific database only. If omitted, checks the entire workspace.',
        },
      },
      required: [] as string[],
    },
  },
];

// Legacy export: All standard tools combined (for backwards compatibility)
// NOTE: Prefer using BASE_TOOLS + conditionally adding NOTION_TOOLS based on user intent
export const ZENNA_TOOLS: Anthropic.Tool[] = [...BASE_TOOLS, ...NOTION_TOOLS];

/**
 * God-level ecosystem tools (conditionally included for admin/father users only).
 * These tools bypass per-user memory isolation for cross-user feedback scanning.
 */
export const GOD_TOOLS: Anthropic.Tool[] = [
  {
    name: 'ecosystem_scan_feedback',
    description: `Scan ALL Zenna ecosystem users' conversational memories for reported issues, bugs, and feature requests. This is a God-level administrative tool.

Use when the admin says: "Check for user issues", "Scan for bug reports", "Find feature requests from users", "Comb through all user feedback", "What issues are users reporting?"

This tool:
1. Semantically searches ALL users' memories for feedback signals
2. Uses AI classification to categorize each finding as: issue, bug, or feature_request
3. Returns classified results with the originating user's name
4. Does NOT automatically add items to Notion — present results conversationally first and wait for confirmation

After presenting results, if the admin confirms, use notion_add_entry to add each item to the Zenna Backlog database.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        focus: {
          type: 'string',
          description: 'Optional: focus the scan on specific topics like "onboarding issues" or "mobile bugs". Leave empty for a general scan.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memory snippets to scan (default: 30)',
        },
      },
      required: [] as string[],
    },
  },
];

/**
 * Workforce tools for OpenClaw BOT agents and authorized users.
 * These tools enable sprint management and backlog operations via Notion.
 */
export const WORKFORCE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'backlog_create',
    description: `Create a structured backlog item in a Notion sprint/backlog database.
Use after ecosystem_scan_feedback to log findings, or when creating issues/features/bugs.

IMPORTANT: First use notion_search to find the target backlog database, then use this tool with the database_id.

Use when: "Add this bug to the backlog", "Create a feature request", "Log this issue"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        database_id: {
          type: 'string',
          description: 'Notion database ID for the backlog (find via notion_search first)',
        },
        title: {
          type: 'string',
          description: 'Issue/feature/task title',
        },
        type: {
          type: 'string',
          enum: ['bug', 'feature', 'improvement', 'task'],
          description: 'Item type classification',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Priority level',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the item',
        },
        source: {
          type: 'string',
          description: 'Where this was discovered (e.g., "memory_mine scan", "user report", "QA testing")',
        },
      },
      required: ['database_id', 'title', 'type'] as string[],
    },
  },
  {
    name: 'sprint_read',
    description: `Read sprint tasks and assignments from a Notion database.
Shows current tasks, their status, assignees, and priorities.

Use when: "What are my sprint tasks?", "Show current assignments", "What's in the sprint?"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        database_id: {
          type: 'string',
          description: 'Notion sprint database ID',
        },
        assignee: {
          type: 'string',
          description: 'Filter by assignee name (optional)',
        },
        status: {
          type: 'string',
          description: 'Filter by status (optional, e.g., "To Do", "In Progress", "Done")',
        },
      },
      required: ['database_id'] as string[],
    },
  },
  {
    name: 'sprint_update',
    description: `Update progress on a sprint task in Notion.
Log status changes, add progress notes, or mark tasks complete.

Use when: "Mark task X as done", "Update progress on task Y", "Move task to In Progress"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID of the task to update',
        },
        status: {
          type: 'string',
          description: 'New status value (e.g., "In Progress", "Done", "Blocked")',
        },
        progress_note: {
          type: 'string',
          description: 'Progress note to append to the task page',
        },
      },
      required: ['page_id'] as string[],
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
   *
   * @param tools Optional tool array override. Defaults to ZENNA_TOOLS.
   *              Pass [...ZENNA_TOOLS, ...GOD_TOOLS] for God-level users.
   */
  async *generateResponseStreamWithTools(
    messages: Message[],
    options?: Partial<BrainProviderConfig>,
    executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<string>,
    tools?: Anthropic.Tool[]
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
      const activeTools = tools || ZENNA_TOOLS;
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: claudeMessages,
        tools: activeTools,
      });

      if (response.stop_reason === 'tool_use') {
        // Handle tool calls
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        // Add assistant's response to messages
        claudeMessages = [
          ...claudeMessages,
          { role: 'assistant' as const, content: response.content },
        ];

        // Execute tools with per-tool status updates
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (let i = 0; i < toolUseBlocks.length; i++) {
          const toolBlock = toolUseBlocks[i];
          console.log(`[ClaudeProvider] Executing tool: ${toolBlock.name}`);

          // Signal which tool is executing
          yield `[status:executing:${toolBlock.name}:${i + 1}:${toolUseBlocks.length}]\n`;

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

          // Signal tool completed
          yield `[status:completed:${toolBlock.name}:${i + 1}:${toolUseBlocks.length}]\n`;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult,
          });
        }

        // Signal between iterations — Claude is processing results
        if (iterations < maxIterations) {
          yield `[status:thinking:processing_results:${iterations}:${maxIterations}]\n`;
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
