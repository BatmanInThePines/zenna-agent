import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService, MemoryService } from '@/core/services/memory-service';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';
import { canAccessEcosystemMemories, isWorkforceUser, canWriteBacklog, canReadSprints, isAgentUser } from '@/lib/utils/permissions';
import { BASE_TOOLS, NOTION_TOOLS, GOD_TOOLS, WORKFORCE_TOOLS } from '@/core/providers/brain/claude-provider';

/**
 * Timeout wrapper for promises - prevents operations from hanging indefinitely.
 * Returns fallback value if the promise doesn't resolve within the timeout.
 * CRITICAL: This is used to prevent pre-stream operations from hanging.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  operationName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[Timeout] ${operationName} timed out after ${ms}ms, using fallback`);
        resolve(fallback);
      }, ms);
    }),
  ]);
}

// Pre-stream operation timeouts (in milliseconds)
const PRESTREAM_TIMEOUTS = {
  AUTH: 5000,           // 5s for auth check
  USER_CONFIG: 5000,    // 5s for user + master config
  HISTORY: 5000,        // 5s for conversation history
  MEMORY_CONTEXT: 8000, // 8s for memory search (already has internal timeout)
  SAVE_TURN: 3000,      // 3s for saving user message
  STORE_FACTS: 2000,    // 2s per fact storage
};

/**
 * Detect if user query requires Notion tools.
 * Only include Notion tools when user explicitly asks for Notion functionality.
 * This prevents unnecessary Notion lookups on simple queries like "what's the weather?"
 */
function requiresNotionTools(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Explicit Notion mentions - highest priority
  if (lowerMessage.includes('notion')) return true;

  // Clear database/table/page operations that imply Notion
  // Be conservative - only match clear intent patterns
  const notionPatterns = [
    /update.*(?:table|database|page|doc|backlog|sprint)/i,
    /add.*(?:entry|row|item|task|bug|feature).*(?:to|in).*(?:table|database|backlog)/i,
    /create.*(?:page|database|table).*(?:in|for)/i,
    /search.*(?:my|the).*(?:workspace|pages|notes|docs)/i,
    /find.*in.*(?:my|the).*(?:workspace|notes)/i,
    /check.*(?:delta|changes|updates).*(?:in|on).*(?:table|database|workspace)/i,
    /what's.*(?:new|changed).*(?:in|on).*(?:workspace|backlog)/i,
    /log.*(?:this|a).*(?:bug|issue|feature|task).*(?:to|in)/i,
  ];

  return notionPatterns.some(pattern => pattern.test(message));
}

/**
 * Extract important facts from user messages
 * Detects statements about family, preferences, personal info, etc.
 *
 * CRITICAL: This function must reliably extract personal facts like family member names
 * so they persist in long-term memory and can be recalled later.
 */
function extractFactsFromMessage(message: string): Array<{fact: string; topic: string; tags: string[]}> {
  const facts: Array<{fact: string; topic: string; tags: string[]}> = [];
  const lowerMessage = message.toLowerCase();

  console.log(`[FactExtraction] Processing message: "${message.substring(0, 100)}..."`);

  // Family member patterns - multiple approaches to catch different phrasings
  // Pattern 1: "my X's name is Y" or "my X name is Y"
  const familyPattern1 = /my\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner|grandfather|grandmother|grandpa|grandma|uncle|aunt|cousin)(?:'s)?\s+name\s+is\s+([A-Z][a-zA-Z]+)/gi;

  // Pattern 2: "my X is named Y" or "my X is Y" (when followed by a name)
  const familyPattern2 = /my\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner|grandfather|grandmother|grandpa|grandma)(?:\s+is\s+named|\s+is\s+called|\s+is)\s+([A-Z][a-zA-Z]+)/gi;

  // Pattern 3: "X is my Y"
  const familyPattern3 = /([A-Z][a-zA-Z]+)\s+is\s+my\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner|grandfather|grandmother|grandpa|grandma)/gi;

  // Pattern 4: "I have a X named Y"
  const familyPattern4 = /i\s+have\s+a\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner)(?:\s+named|\s+called)\s+([A-Z][a-zA-Z]+)/gi;

  const familyPatterns = [familyPattern1, familyPattern2, familyPattern3, familyPattern4];

  for (const pattern of familyPatterns) {
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(message)) !== null) {
      let relation: string;
      let name: string;

      // Pattern 3 has reversed capture groups (name first, then relation)
      if (pattern === familyPattern3) {
        name = match[1]?.trim();
        relation = match[2]?.toLowerCase();
      } else {
        relation = match[1]?.toLowerCase();
        name = match[2]?.trim();
      }

      if (name && name.length > 1 && name.length < 30 && relation) {
        // Normalize relation names
        const normalizedRelation = relation
          .replace('dad', 'father')
          .replace('mom', 'mother')
          .replace('grandpa', 'grandfather')
          .replace('grandma', 'grandmother');

        const factText = `User's ${normalizedRelation}'s name is ${name}`;

        // Avoid duplicates
        if (!facts.some(f => f.fact === factText)) {
          console.log(`[FactExtraction] Found family fact: ${factText}`);
          facts.push({
            fact: factText,
            topic: 'family',
            tags: ['family', normalizedRelation, 'personal', 'name']
          });
        }
      }
    }
  }

  // Name patterns - "my name is X" or "I'm X" or "call me X"
  const namePatterns = [
    /my\s+name\s+is\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|$|\s+and|\s+but)/gi,
    /(?:i'm|i\s+am)\s+([A-Z][a-zA-Z]+)(?:\.|,|$|\s+and|\s+but)/gi,
    /(?:call\s+me|you\s+can\s+call\s+me)\s+([A-Z][a-zA-Z]+)/gi,
  ];

  for (const pattern of namePatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length > 1 && name.length < 30) {
        facts.push({
          fact: `User's name is ${name}`,
          topic: 'personal',
          tags: ['name', 'personal', 'identity']
        });
      }
    }
  }

  // Location patterns - "I live in X" or "I'm from X"
  const locationPatterns = [
    /i\s+(?:live|reside)\s+in\s+([A-Z][a-zA-Z\s,]+?)(?:\.|$|\s+and|\s+but)/gi,
    /i(?:'m|\s+am)\s+from\s+([A-Z][a-zA-Z\s,]+?)(?:\.|$|\s+and|\s+but)/gi,
    /my\s+(?:home|house)\s+is\s+in\s+([A-Z][a-zA-Z\s,]+?)(?:\.|$)/gi,
  ];

  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const location = match[1]?.trim();
      if (location && location.length > 2 && location.length < 100) {
        facts.push({
          fact: `User lives in ${location}`,
          topic: 'location',
          tags: ['location', 'personal', 'home']
        });
      }
    }
  }

  // Work/Job patterns
  const workPatterns = [
    /i\s+(?:work|am\s+employed)\s+(?:at|for)\s+([A-Z][a-zA-Z\s&]+?)(?:\.|,|$|\s+as)/gi,
    /i(?:'m|\s+am)\s+a(?:n)?\s+([a-zA-Z\s]+?)(?:\.|,|$|\s+at|\s+and|\s+but)/gi,
    /my\s+(?:job|profession|occupation)\s+is\s+([a-zA-Z\s]+?)(?:\.|,|$)/gi,
  ];

  for (const pattern of workPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const work = match[1]?.trim();
      if (work && work.length > 2 && work.length < 100) {
        facts.push({
          fact: `User works as/at ${work}`,
          topic: 'work',
          tags: ['work', 'career', 'personal']
        });
      }
    }
  }

  // Birthday/Age patterns
  const birthdayPatterns = [
    /my\s+birthday\s+is\s+(?:on\s+)?([A-Za-z]+\s+\d+|\d+[\/\-]\d+)/gi,
    /i\s+was\s+born\s+(?:on\s+)?([A-Za-z]+\s+\d+(?:,?\s*\d{4})?)/gi,
    /i(?:'m|\s+am)\s+(\d+)\s+years?\s+old/gi,
  ];

  for (const pattern of birthdayPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const value = match[1]?.trim();
      if (value) {
        const isAge = /^\d+$/.test(value);
        facts.push({
          fact: isAge ? `User is ${value} years old` : `User's birthday is ${value}`,
          topic: 'personal',
          tags: ['birthday', 'age', 'personal']
        });
      }
    }
  }

  // Pet patterns
  const petPatterns = [
    /i\s+have\s+a\s+(dog|cat|bird|fish|hamster|rabbit|pet)(?:\s+named|\s+called)?\s*([A-Z][a-zA-Z]*)?/gi,
    /my\s+(dog|cat|bird|pet)(?:'s)?\s+(?:name\s+)?(?:is|was)\s+([A-Z][a-zA-Z]+)/gi,
  ];

  for (const pattern of petPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const petType = match[1]?.toLowerCase();
      const petName = match[2]?.trim();
      if (petType) {
        const factText = petName
          ? `User has a ${petType} named ${petName}`
          : `User has a ${petType}`;
        facts.push({
          fact: factText,
          topic: 'pets',
          tags: ['pets', petType, 'personal']
        });
      }
    }
  }

  // Preference patterns - "I love/like/prefer X"
  if (lowerMessage.includes(' love ') || lowerMessage.includes(' like ') ||
      lowerMessage.includes(' prefer ') || lowerMessage.includes(' favorite ')) {
    const preferencePatterns = [
      /i\s+(?:really\s+)?(?:love|like|prefer|enjoy)\s+([a-zA-Z\s]+?)(?:\.|,|$|\s+and|\s+but|\s+because)/gi,
      /my\s+favorite\s+([a-zA-Z]+)\s+is\s+([a-zA-Z\s]+?)(?:\.|,|$)/gi,
    ];

    for (const pattern of preferencePatterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const preference = (match[2] || match[1])?.trim();
        const category = match[2] ? match[1]?.trim() : 'thing';
        if (preference && preference.length > 2 && preference.length < 50) {
          facts.push({
            fact: `User's favorite ${category} is ${preference}` || `User likes ${preference}`,
            topic: 'preferences',
            tags: ['preferences', category.toLowerCase(), 'personal']
          });
        }
      }
    }
  }

  return facts;
}

// Singleton memory service instance
let memoryServiceInstance: MemoryService | null = null;

async function getMemoryService(): Promise<MemoryService> {
  if (!memoryServiceInstance) {
    memoryServiceInstance = createMemoryService();
    await memoryServiceInstance.initialize();
  }
  return memoryServiceInstance;
}

/**
 * Streaming Chat API Endpoint
 *
 * Uses Server-Sent Events (SSE) to stream:
 * 1. Text chunks as they're generated by the LLM
 * 2. Emotion analysis after text is complete
 * 3. Final message for cleanup
 *
 * This enables real-time transcript updates before TTS audio is ready.
 */
export async function POST(request: NextRequest) {
  try {
    // Initialize memory service
    const memoryService = await getMemoryService();
    const identityStore = memoryService.getIdentityStore();

    // Verify authentication using NextAuth (with timeout protection)
    const session = await withTimeout(
      auth(),
      PRESTREAM_TIMEOUTS.AUTH,
      null,
      'auth()'
    );

    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userId = session.user.id;

    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for background noise system message
    const isBackgroundNoiseMessage = message.startsWith('[SYSTEM: Background noise');
    let processedMessage = message;

    if (isBackgroundNoiseMessage) {
      // Transform system message into a natural response request
      processedMessage = "I'm detecting some background noise. Please acknowledge this briefly and let me know you'll wait for me to speak clearly. Keep it to one short sentence.";
    }

    // Get user and master config (with timeout protection)
    const [user, masterConfig] = await withTimeout(
      Promise.all([
        identityStore.getUser(userId),
        identityStore.getMasterConfig(),
      ]),
      PRESTREAM_TIMEOUTS.USER_CONFIG,
      [null, null] as [Awaited<ReturnType<typeof identityStore.getUser>> | null, Awaited<ReturnType<typeof identityStore.getMasterConfig>> | null],
      'getUser+getMasterConfig'
    );

    if (!user || !masterConfig) {
      return new Response(JSON.stringify({ error: 'User or config not found (timeout)' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if user has God-level (ecosystem admin) access
    const isGodUser = canAccessEcosystemMemories(user.role, session.user.email);

    // Check if user has workforce capabilities (sprint/backlog access or agent type)
    const hasWorkforceAccess = isWorkforceUser(
      user.userType,
      user.sprintAssignmentAccess,
      user.backlogWriteAccess,
      session.user.email
    );

    // Determine default memory scope for this user
    const isAgent = isAgentUser(user.userType);
    const defaultMemoryScope = isAgent ? 'engineering' : 'companion';

    // Get conversation history (permanent, never deleted) - with timeout protection
    const storedHistory = await withTimeout(
      memoryService.getConversationHistory(userId),
      PRESTREAM_TIMEOUTS.HISTORY,
      [], // Empty history on timeout - conversation still works, just no context
      'getConversationHistory'
    );

    // Build message history for LLM
    const systemPrompt = buildSystemPrompt(masterConfig, user.settings, user.role, session.user.email, user);
    const history: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Inject relevant memories from semantic search (ElevenLabs best practice: retrieveMemories at start of turn)
    console.log(`[Chat] Searching memories for userId: ${userId}, query: "${message.substring(0, 50)}..."`);
    const memoryContext = await memoryService.buildMemoryContext(userId, message);
    console.log(`[Chat] Memory context result: ${memoryContext ? `Found ${memoryContext.length} chars` : 'NULL - no memories found'}`);
    if (memoryContext) {
      // ElevenLabs pattern: Inject memory context as a separate system message
      // This ensures the LLM has access to relevant past information
      history.push({
        role: 'system',
        content: `# Retrieved Memories (THIS IS AUTHORITATIVE - USE THIS INFORMATION)

The following information has been retrieved from the user's permanent memory. This is VERIFIED, TRUE information about the user. This step is important.

${memoryContext}

## CRITICAL ANTI-HALLUCINATION RULES

1. ONLY use names, facts, and details that appear in the memories above or that the user explicitly states
2. NEVER invent, guess, or assume names for people (family members, friends, etc.)
3. If you're unsure about someone's name, ASK - do not guess
4. If you don't have information about something, say "I don't have that information yet - could you tell me?"
5. The user's name and family member names should ONLY come from the memories above or direct user input
6. DO NOT use common names as placeholders (like "Michael", "John", "Mary", etc.)

If the memories above mention specific names (like the user's mother, father, etc.), use EXACTLY those names. Never substitute different names.`,
      });
    } else {
      // ElevenLabs fallback logic: Handle empty memory gracefully
      history.push({
        role: 'system',
        content: `# Memory Status

No previous memories found related to this topic.

## CRITICAL ANTI-HALLUCINATION RULES

Since no relevant memories were found:
1. DO NOT assume or guess any names, facts, or personal details
2. DO NOT use placeholder names or make up information
3. If you need to know someone's name or personal details, ASK the user
4. It's better to say "I don't have that information yet" than to guess incorrectly
5. If the user shares important information (family members, preferences, significant events), acknowledge it and remember it

NEVER invent names or facts. If you don't know something, ask.`,
      });
    }

    // Add recent conversation history (last 50 turns for context window management)
    // NOTE: All history is preserved permanently, we just limit what we send to LLM
    const recentHistory = storedHistory.slice(-50);
    for (const turn of recentHistory) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        history.push({
          role: turn.role,
          content: turn.content,
          timestamp: new Date(turn.created_at),
        });
      }
    }

    // Add current user message (use processed message for background noise handling)
    history.push({
      role: 'user',
      content: processedMessage,
      timestamp: new Date(),
    });

    // Save user message to permanent storage (Supabase + Pinecone if configured)
    // NOTE: Memories are PERMANENT - we never delete them
    // Don't save system messages like background noise detection
    if (!isBackgroundNoiseMessage) {
      // Determine memory scope: agents use 'engineering' or 'simulation' scope
      const msgScope = isAgent && message.includes('[AgentWorkSimulation]')
        ? 'simulation' as const
        : defaultMemoryScope as 'companion' | 'engineering' | 'platform' | 'simulation';

      // Save user turn with timeout - don't block response if storage is slow
      await withTimeout(
        memoryService.addConversationTurn(userId, 'user', message, {
          memoryScope: msgScope,
          tags: isAgent ? ['agent_interaction'] : undefined,
        }),
        PRESTREAM_TIMEOUTS.SAVE_TURN,
        undefined,
        'addConversationTurn'
      );

      // Extract and store important facts from user message
      // This ensures facts like "My father's name is X" are stored as high-importance memories
      const extractedFacts = extractFactsFromMessage(message);
      if (extractedFacts.length > 0) {
        console.log(`[Chat] Extracted ${extractedFacts.length} facts from user message:`, extractedFacts.map(f => f.fact));
        // Store facts with timeout - don't block response if vector storage is slow
        const factPromises = extractedFacts.map(({ fact, topic, tags }) =>
          withTimeout(
            memoryService.storeImportantFact(userId, fact, {
              topic,
              tags,
              importance: 0.95, // High importance for personal facts
            }).then(() => {
              console.log(`[Chat] Stored fact: "${fact}"`);
            }),
            PRESTREAM_TIMEOUTS.STORE_FACTS,
            undefined,
            `storeImportantFact(${fact.substring(0, 30)}...)`
          ).catch((factError) => {
            console.error(`[Chat] Failed to store fact "${fact}":`, factError);
          })
        );
        // Run all fact storage in parallel, don't await - fire and forget
        Promise.all(factPromises).catch(() => {});
      }
    }

    // Get brain provider - prefer Claude for better rate limits and quality
    // Order of preference: user setting > master config > Claude (if key exists) > Gemini
    let brainProviderId = user.settings.preferredBrainProvider || masterConfig.defaultBrain.providerId;
    let brainApiKey = user.settings.brainApiKey || masterConfig.defaultBrain.apiKey;

    // If no explicit provider set, auto-select based on available API keys
    // Prefer Claude for better rate limits (60 RPM vs 4 RPM on Gemini free tier)
    if (!brainProviderId || !brainApiKey) {
      if (process.env.ANTHROPIC_API_KEY) {
        brainProviderId = 'claude';
        brainApiKey = process.env.ANTHROPIC_API_KEY;
        console.log('[Chat] Using Claude provider (ANTHROPIC_API_KEY found)');
      } else if (process.env.GOOGLE_AI_API_KEY) {
        brainProviderId = 'gemini-2.5-flash';
        brainApiKey = process.env.GOOGLE_AI_API_KEY;
        console.log('[Chat] Using Gemini provider (GOOGLE_AI_API_KEY found)');
      }
    }

    if (!brainApiKey) {
      return new Response(JSON.stringify({ error: 'LLM not configured. Set ANTHROPIC_API_KEY or GOOGLE_AI_API_KEY.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const brainProvider = brainProviderFactory.create(brainProviderId, {
      apiKey: brainApiKey,
    });

    // Tool execution function for web searches and Notion operations
    // BUG 3 FIX: Store internet search results in memory for future recall
    // ADR-001: Use Zenna-MCP Gateway for all internet intelligence (Tavily-powered)
    const executeToolFn = async (toolName: string, input: Record<string, unknown>): Promise<string> => {
      if (toolName === 'web_search') {
        try {
          const searchQuery = input.query as string;
          const searchType = input.type as 'weather' | 'news' | 'time' | 'general';

          // Import MCP client dynamically to avoid cold-start overhead
          const { mcpSearch } = await import('@/core/services/zenna-mcp-client');

          console.log('[Chat] Searching via Zenna-MCP Gateway:', searchQuery.substring(0, 50));

          const searchResult = await mcpSearch({
            query: searchQuery,
            searchType: searchType,
            searchDepth: 'basic',
          });

          if (!searchResult.success) {
            console.error('[Chat] MCP search failed:', searchResult.error);
            return `Search failed: ${searchResult.error || 'Unknown error'}`;
          }

          const resultText = searchResult.content;

          // BUG 3 FIX: Store internet search in memory for future recall
          try {
            await memoryService.storeInternetSearch(userId, searchQuery, resultText, {
              searchSource: 'Tavily (via Zenna-MCP)',
              searchType: searchType,
              topic: searchType,
            });
            console.log(`[Chat] Stored internet search in memory: "${searchQuery}"`);
          } catch (memError) {
            console.error('[Chat] Failed to store internet search in memory:', memError);
            // Don't fail the search just because memory storage failed
          }

          return resultText;
        } catch (error) {
          console.error('[Chat] Web search error:', error);
          return `Failed to fetch real-time data: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // Notion integration tools
      if (toolName.startsWith('notion_')) {
        const notionToken = user?.settings.externalContext?.notion?.token;
        if (!notionToken) {
          return 'Notion is not connected. The user needs to connect Notion in Settings > Integrations first.';
        }

        try {
          const { NotionService } = await import('@/core/services/notion-service');
          const notion = new NotionService(notionToken);
          let result: string;
          let memoryTag: string;

          switch (toolName) {
            case 'notion_search': {
              const searchResults = await notion.search(
                input.query as string,
                input.filter as 'page' | 'database' | undefined
              );

              if (searchResults.length === 0) {
                result = `No results found for "${input.query}" in the Notion workspace.`;
              } else {
                const formatted = searchResults.map((r, i) =>
                  `${i + 1}. [${r.type}] "${r.title}" (ID: ${r.id}) — ${r.url}`
                ).join('\n');
                result = `Found ${searchResults.length} result(s):\n${formatted}`;
              }
              memoryTag = '[NotionRetrieval]';
              break;
            }

            case 'notion_get_page': {
              const page = await notion.getPageContent(input.page_id as string);
              result = `Page: "${page.title}"\nURL: ${page.url}\nLast edited: ${page.lastEditedTime}\n\nContent:\n${page.content}`;
              memoryTag = '[NotionRetrieval]';
              break;
            }

            case 'notion_create_page': {
              const created = await notion.createPage({
                title: input.title as string,
                content: input.content as string | undefined,
                parentId: input.parent_id as string | undefined,
                parentType: (input.parent_type as 'page' | 'database') || 'page',
              });
              result = `Page created successfully!\nTitle: "${input.title}"\nURL: ${created.url}`;
              memoryTag = '[NotionWrite]';
              break;
            }

            case 'notion_add_entry': {
              // First get the database schema so we can report it
              let schemaInfo = '';
              try {
                const schema = await notion.getDatabaseSchema(input.database_id as string);
                schemaInfo = `\nDatabase: "${schema.title}"\nAvailable properties: ${schema.properties.map(p => `${p.name} (${p.type})`).join(', ')}`;
              } catch {
                // Schema fetch is informational, don't fail the whole operation
              }

              const entry = await notion.addDatabaseEntry({
                databaseId: input.database_id as string,
                title: input.title as string,
                properties: input.properties as Record<string, string> | undefined,
              });
              result = `Entry added successfully!${schemaInfo}\nTitle: "${input.title}"\nURL: ${entry.url}`;
              memoryTag = '[NotionBacklogAction]';
              break;
            }

            case 'notion_delta_check': {
              // Get lastCheckedAt from user settings
              const lastCheckedAt = user?.settings.externalContext?.notion?.lastCheckedAt;
              const sinceTimestamp = lastCheckedAt
                ? new Date(lastCheckedAt).toISOString()
                : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // Default: 7 days ago

              const scopedDbId = input.database_id as string | undefined;
              const changes = await notion.getChangesSince(sinceTimestamp, scopedDbId);

              if (changes.totalChanges === 0) {
                const sinceLabel = lastCheckedAt
                  ? new Date(lastCheckedAt).toLocaleString()
                  : '7 days ago (first check)';
                result = `No changes found in Notion since ${sinceLabel}.`;
              } else {
                const sinceLabel = lastCheckedAt
                  ? new Date(lastCheckedAt).toLocaleString()
                  : '7 days ago (first check)';
                let formatted = `Changes since ${sinceLabel} (${changes.totalChanges} total):\n\n`;

                // Modified standalone pages
                if (changes.modifiedPages.length > 0) {
                  formatted += `**Modified Pages:**\n`;
                  for (const page of changes.modifiedPages) {
                    formatted += `- "${page.title}" edited${page.lastEditedBy ? ` by ${page.lastEditedBy}` : ''} at ${page.lastEditedTime}\n  URL: ${page.url}\n`;
                  }
                  formatted += '\n';
                }

                // Modified database entries — group by database
                if (changes.modifiedEntries.length > 0) {
                  const byDb = new Map<string, typeof changes.modifiedEntries>();
                  for (const entry of changes.modifiedEntries) {
                    const key = entry.databaseTitle;
                    if (!byDb.has(key)) byDb.set(key, []);
                    byDb.get(key)!.push(entry);
                  }

                  for (const [dbName, entries] of byDb) {
                    formatted += `**${dbName}:**\n`;
                    for (const entry of entries) {
                      const propsStr = Object.entries(entry.properties)
                        .filter(([key]) => key !== 'Name' && key !== 'Title') // Skip title since we show it
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                      formatted += `- "${entry.title}"${entry.lastEditedBy ? ` (by ${entry.lastEditedBy})` : ''} — ${propsStr || 'updated'}\n  URL: ${entry.url}\n`;
                    }
                    formatted += '\n';
                  }
                }

                result = formatted;
              }

              // Update lastCheckedAt in user settings so next call only shows new changes
              try {
                const identityStore = memoryService.getIdentityStore();
                await identityStore.updateSettings(userId, {
                  externalContext: {
                    ...user?.settings.externalContext,
                    notion: {
                      ...user?.settings.externalContext?.notion,
                      enabled: user?.settings.externalContext?.notion?.enabled ?? true,
                      lastCheckedAt: Date.now(),
                    },
                  },
                });
                console.log('[Chat] Updated Notion lastCheckedAt timestamp');
              } catch (settingsError) {
                console.error('[Chat] Failed to update Notion lastCheckedAt:', settingsError);
              }

              memoryTag = '[NotionRetrieval]';
              break;
            }

            default:
              return `Unknown Notion tool: ${toolName}`;
          }

          // Store Notion interaction in memory for future recall
          try {
            await memoryService.storeNotionInteraction(userId, toolName, input, result, memoryTag);
            console.log(`[Chat] Stored Notion interaction in memory: ${toolName}`);
          } catch (memError) {
            console.error('[Chat] Failed to store Notion interaction in memory:', memError);
          }

          return result;
        } catch (error) {
          console.error(`[Chat] Notion tool error (${toolName}):`, error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          // Provide clean error messages for known Notion error types
          if (errorMsg.startsWith('NOTION_')) {
            return errorMsg.replace(/^NOTION_\w+:\s*/, '');
          }
          return `Failed to execute Notion operation: ${errorMsg}`;
        }
      }

      // ===== GOD-LEVEL: ECOSYSTEM FEEDBACK SCANNER =====
      if (toolName === 'ecosystem_scan_feedback') {
        // Double-check God-level access (belt + suspenders)
        if (!isGodUser) {
          return 'Access denied. This tool requires God-level administrative privileges.';
        }

        try {
          const focus = input.focus as string | undefined;
          const limit = (input.limit as number) || 30;

          // Step 1: Scan all users' memories for feedback signals
          const rawResults = await memoryService.scanEcosystemFeedback({
            topK: limit,
            threshold: 0.35,
          });

          if (rawResults.length === 0) {
            return 'No feedback, issues, or feature requests found across ecosystem users.';
          }

          // Step 2: Resolve userIds to usernames for attribution
          const usernameMap = await memoryService.resolveUsernames(
            rawResults.map(r => r.userId)
          );

          // Step 3: Build snippets for AI classification
          const snippets = rawResults.slice(0, 50).map((r, i) => ({
            index: i + 1,
            user: usernameMap.get(r.userId) || 'Unknown',
            content: r.content.substring(0, 300),
            date: r.createdAt.toISOString().split('T')[0],
          }));

          // Step 4: Classify via secondary Claude call
          const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
          const classifier = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY! });

          const classificationResponse = await classifier.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            temperature: 0.1,
            system: `You are a product feedback classifier. Analyze user conversation snippets and classify each as one of: bug, issue, feature_request, or irrelevant.

Rules:
- "bug" = something is broken, crashes, errors, doesn't work as expected
- "issue" = a problem, complaint, or pain point with existing functionality
- "feature_request" = a wish, suggestion, or request for new functionality
- "irrelevant" = not feedback (general conversation, greetings, questions, etc.)

Return ONLY a valid JSON array. No explanation text.`,
            messages: [{
              role: 'user',
              content: `Classify each memory snippet. Return a JSON array of objects with fields: index, classification (bug|issue|feature_request|irrelevant), title (short 5-10 word summary for a backlog), user, date, priority (high|medium|low).

${focus ? `Focus area: ${focus}` : 'Scan for all types of feedback.'}

Snippets:
${JSON.stringify(snippets, null, 2)}`
            }],
          });

          // Step 5: Parse classification results
          const classText = classificationResponse.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map(b => b.text)
            .join('');

          const jsonMatch = classText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            return `Found ${rawResults.length} memory snippets but AI classification returned unexpected format. Raw snippet count available for manual review.`;
          }

          const classified = JSON.parse(jsonMatch[0]) as Array<{
            index: number;
            classification: string;
            title: string;
            user: string;
            date: string;
            priority: string;
          }>;

          const actionable = classified.filter(c => c.classification !== 'irrelevant');

          if (actionable.length === 0) {
            return `Scanned ${rawResults.length} memories across all users. No actionable issues, bugs, or feature requests found.`;
          }

          // Step 6: Format results for conversational presentation
          let result = `Ecosystem Feedback Scan Results\n\n`;
          result += `Scanned ${rawResults.length} memories across all users.\n`;
          result += `Found ${actionable.length} actionable items:\n\n`;

          for (const item of actionable) {
            const tag = item.classification === 'bug' ? 'BUG'
              : item.classification === 'issue' ? 'ISSUE'
              : 'FEATURE';
            result += `[${tag}] ${item.title}\n`;
            result += `  User: ${item.user} | Priority: ${item.priority} | Date: ${item.date}\n\n`;
          }

          result += `\nTo add these to the Zenna Backlog in Notion, confirm and I will use notion_add_entry for each item.`;

          // Store the scan action in memory for audit trail
          try {
            await memoryService.storeNotionInteraction(
              userId,
              'ecosystem_scan_feedback',
              { focus, limit, resultsCount: actionable.length },
              `Ecosystem scan found ${actionable.length} actionable items from ${rawResults.length} memories`,
              '[EcosystemScan]'
            );
          } catch (memError) {
            console.error('[Chat] Failed to store ecosystem scan in memory:', memError);
          }

          return result;
        } catch (error) {
          console.error('[Chat] Ecosystem scan error:', error);
          return `Ecosystem scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // ===== WORKFORCE TOOLS: BACKLOG CREATE =====
      if (toolName === 'backlog_create') {
        const userEmail = session.user.email;
        if (!canWriteBacklog(user?.backlogWriteAccess, userEmail)) {
          return 'Access denied. Backlog write access is required for this tool.';
        }

        const notionToken = user?.settings?.externalContext?.notion?.token;
        if (!notionToken) {
          return 'Notion is not connected. Please connect Notion in Settings > Integrations to use backlog tools.';
        }

        try {
          const { NotionService } = await import('@/core/services/notion-service');
          const notion = new NotionService(notionToken);

          // Get database schema for property mapping
          const schema = await notion.getDatabaseSchema(input.database_id as string);

          // Build properties from input
          const properties: Record<string, string> = {};
          if (input.type) properties['Type'] = input.type as string;
          if (input.priority) properties['Priority'] = input.priority as string;
          if (input.source) properties['Source'] = input.source as string;
          if (input.description) properties['Description'] = input.description as string;

          const result = await notion.addDatabaseEntry({
            databaseId: input.database_id as string,
            title: input.title as string,
            properties,
          });

          // Store in engineering memory scope
          await memoryService.storeNotionInteraction(
            userId, 'backlog_create', input, `Created: ${result.url}`, '[BacklogCreate]'
          );

          // Audit log
          await auditLogWorkforceAction(userId, 'backlog_create', input, `Created: ${input.title}`);

          return `Backlog item created: "${input.title}" — ${result.url}`;
        } catch (error) {
          console.error('[Chat] Backlog create error:', error);
          return `Failed to create backlog item: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // ===== WORKFORCE TOOLS: SPRINT READ =====
      if (toolName === 'sprint_read') {
        const userEmail = session.user.email;
        if (!canReadSprints(user?.sprintAssignmentAccess, userEmail)) {
          return 'Access denied. Sprint assignment access is required for this tool.';
        }

        const notionToken = user?.settings?.externalContext?.notion?.token;
        if (!notionToken) {
          return 'Notion is not connected. Please connect Notion in Settings > Integrations.';
        }

        try {
          const { NotionService } = await import('@/core/services/notion-service');
          const notion = new NotionService(notionToken);

          const entries = await notion.queryDatabaseFiltered(
            input.database_id as string,
            {
              status: input.status as string | undefined,
              assignee: input.assignee as string | undefined,
            }
          );

          if (entries.length === 0) {
            return 'No tasks found matching the specified filters.';
          }

          let result = `Found ${entries.length} sprint task(s):\n\n`;
          for (const entry of entries) {
            result += `**${entry.title}**\n`;
            const propEntries = Object.entries(entry.properties).filter(([k]) => k !== 'Name' && k !== 'Title');
            for (const [key, value] of propEntries) {
              result += `  ${key}: ${value}\n`;
            }
            result += `  Link: ${entry.url}\n\n`;
          }

          return result;
        } catch (error) {
          console.error('[Chat] Sprint read error:', error);
          return `Failed to read sprint tasks: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      // ===== WORKFORCE TOOLS: SPRINT UPDATE =====
      if (toolName === 'sprint_update') {
        const userEmail = session.user.email;
        if (!canReadSprints(user?.sprintAssignmentAccess, userEmail)) {
          return 'Access denied. Sprint assignment access is required for this tool.';
        }

        const notionToken = user?.settings?.externalContext?.notion?.token;
        if (!notionToken) {
          return 'Notion is not connected. Please connect Notion in Settings > Integrations.';
        }

        try {
          const { NotionService } = await import('@/core/services/notion-service');
          const notion = new NotionService(notionToken);

          const results: string[] = [];

          // Update properties (e.g., status)
          if (input.status) {
            const updateResult = await notion.updatePageProperties(
              input.page_id as string,
              { Status: input.status as string }
            );
            results.push(`Status updated to "${input.status}" — ${updateResult.url}`);
          }

          // Append progress note
          if (input.progress_note) {
            const timestamp = new Date().toISOString().split('T')[0];
            const noteContent = `\n---\n**Progress Update (${timestamp}):** ${input.progress_note}`;
            await notion.appendToPage(input.page_id as string, noteContent);
            results.push('Progress note appended to task page.');
          }

          // Store in engineering memory scope
          await memoryService.storeNotionInteraction(
            userId, 'sprint_update', input,
            results.join(' | '),
            '[SprintUpdate]'
          );

          // Audit log
          await auditLogWorkforceAction(userId, 'sprint_update', input, results.join(' | '));

          return results.join('\n');
        } catch (error) {
          console.error('[Chat] Sprint update error:', error);
          return `Failed to update sprint task: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }

      return 'Unknown tool';
    };

    // Audit logging helper for workforce tools
    async function auditLogWorkforceAction(
      agentUserId: string,
      action: string,
      toolInput: Record<string, unknown>,
      resultSummary: string
    ) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        await supabase.from('agent_audit_log').insert({
          agent_user_id: agentUserId,
          action,
          tool_name: action,
          input: toolInput,
          result_summary: resultSummary.substring(0, 500),
          memory_scope: defaultMemoryScope,
        });
      } catch (auditError) {
        console.error('[Chat] Audit log write failed:', auditError);
      }
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        // Escalating thinking feedback — keeps user informed during long operations
        const HARD_TIMEOUT_MS = 120000; // 2 minutes for complex tool chains
        let responseStarted = false;
        let toolsActive = false;
        const startTime = Date.now();

        // Escalating thinking messages at 10s, 30s, 60s
        const thinkingTimeouts: NodeJS.Timeout[] = [];
        const THINKING_STAGES = [
          { delay: 10000, message: "Working on this — it may require a few steps..." },
          { delay: 30000, message: "Still working... this is a complex request. You can click the yellow button to stop." },
          { delay: 60000, message: "This is taking longer than expected. Click the yellow button to cancel and try rephrasing your request." },
        ];

        for (let i = 0; i < THINKING_STAGES.length; i++) {
          const stage = THINKING_STAGES[i];
          thinkingTimeouts.push(setTimeout(() => {
            if (!responseStarted) {
              const thinkingEvent = `data: ${JSON.stringify({
                type: 'thinking',
                content: stage.message,
                stage: i,
              })}\n\n`;
              controller.enqueue(encoder.encode(thinkingEvent));
            }
          }, stage.delay));
        }

        try {
          // Create a promise that rejects after hard timeout
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Response timeout')), HARD_TIMEOUT_MS);
          });

          // Check if provider is Claude with tool support
          const isClaudeWithTools = brainProviderId === 'claude' &&
            'generateResponseStreamWithTools' in brainProvider;

          // Check if provider supports streaming
          if (isClaudeWithTools) {
            // Use Claude streaming with tool support for real-time data
            console.log('[Chat] Using Claude with tool support');
            // Cast to the Claude provider type to access tool methods
            const claudeProvider = brainProvider as {
              generateResponseStreamWithTools: (
                messages: Message[],
                options?: unknown,
                executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<string>,
                tools?: import('@anthropic-ai/sdk').default.Tool[]
              ) => AsyncGenerator<string, void, unknown>;
            };

            // Build tool array based on user permissions AND query intent
            // Notion tools are only included when:
            // 1. User has Notion connected, AND
            // 2. User explicitly requests Notion (mentions "notion" or asks for table/database operations)
            const hasNotionConnected = !!user.settings?.externalContext?.notion?.token;
            const needsNotion = hasNotionConnected && requiresNotionTools(message);

            if (needsNotion) {
              console.log('[Chat] Notion tools INCLUDED - user intent detected');
            } else if (hasNotionConnected) {
              console.log('[Chat] Notion tools EXCLUDED - no user intent for Notion');
            }

            // Start with base tools, conditionally add Notion
            const baseToolSet = needsNotion
              ? [...BASE_TOOLS, ...NOTION_TOOLS]
              : BASE_TOOLS;

            const activeTools = [
              ...baseToolSet,
              ...(isGodUser ? GOD_TOOLS : []),
              ...(hasWorkforceAccess ? WORKFORCE_TOOLS : []),
            ];

            const responseStream = claudeProvider.generateResponseStreamWithTools(
              history,
              undefined,
              executeToolFn,
              activeTools
            );

            for await (const chunk of responseStream) {
              // Check if this is a tool status message (new format: [status:action:tool:index:total])
              if (chunk.startsWith('[status:')) {
                toolsActive = true;
                // Parse structured status: [status:executing:notion_search:1:3]
                const statusBody = chunk.replace('[status:', '').replace(']\n', '').replace(']', '').trim();
                const parts = statusBody.split(':');
                const statusEvent = `data: ${JSON.stringify({
                  type: 'status',
                  action: parts[0],     // 'executing' | 'completed' | 'thinking'
                  tool: parts[1],       // tool name or 'processing_results'
                  toolIndex: parts[2] ? parseInt(parts[2]) : undefined,
                  totalTools: parts[3] ? parseInt(parts[3]) : undefined,
                })}\n\n`;
                controller.enqueue(encoder.encode(statusEvent));
              } else if (chunk.startsWith('[Fetching')) {
                // Legacy format — backwards compat
                toolsActive = true;
                const statusEvent = `data: ${JSON.stringify({ type: 'status', content: chunk })}\n\n`;
                controller.enqueue(encoder.encode(statusEvent));
              } else {
                // Actual text response — clear thinking timeouts
                if (!responseStarted) {
                  responseStarted = true;
                  thinkingTimeouts.forEach(t => clearTimeout(t));
                }
                fullResponse += chunk;
                // Send text chunk
                const event = `data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`;
                controller.enqueue(encoder.encode(event));
              }

              // Check hard timeout during streaming
              if (Date.now() - startTime > HARD_TIMEOUT_MS) {
                throw new Error('Response timeout');
              }
            }
          } else if ('generateResponseStream' in brainProvider && typeof brainProvider.generateResponseStream === 'function') {
            // Use standard streaming response with timeout
            const responseStream = brainProvider.generateResponseStream(history);

            for await (const chunk of responseStream) {
              if (!responseStarted) {
                responseStarted = true;
                thinkingTimeouts.forEach(t => clearTimeout(t));
              }
              fullResponse += chunk;

              // Send text chunk
              const event = `data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`;
              controller.enqueue(encoder.encode(event));

              // Check hard timeout during streaming
              if (Date.now() - startTime > HARD_TIMEOUT_MS) {
                throw new Error('Response timeout');
              }
            }
          } else {
            // Fall back to non-streaming with timeout
            const response = await Promise.race([
              brainProvider.generateResponse(history),
              timeoutPromise
            ]);
            responseStarted = true;
            thinkingTimeouts.forEach(t => clearTimeout(t));
            fullResponse = response.content;

            // Send complete response
            const event = `data: ${JSON.stringify({ type: 'text', content: fullResponse })}\n\n`;
            controller.enqueue(encoder.encode(event));
          }

          // Process any action blocks
          const actionResult = await processActionBlocks(fullResponse, userId, user.settings);
          let finalResponse = fullResponse;
          if (actionResult) {
            finalResponse = actionResult.cleanedResponse;
          }

          // Save assistant response to permanent storage (Supabase + Pinecone if configured)
          // NOTE: Memories are PERMANENT - we never delete them unless explicitly requested
          // Wrap in try-catch to prevent save errors from breaking the response
          try {
            const isHueRelated = actionResult?.actionConfirmation !== undefined &&
              fullResponse.includes('control_lights');
            const assistantMeta: { tags?: string[]; topic?: string; memoryScope?: 'companion' | 'engineering' | 'platform' | 'simulation' } = {};
            if (isHueRelated) {
              assistantMeta.tags = ['Smart Home', 'Hue'];
              assistantMeta.topic = 'smart-home-control';
            }
            if (isAgent) {
              assistantMeta.memoryScope = defaultMemoryScope as 'companion' | 'engineering' | 'platform' | 'simulation';
              assistantMeta.tags = [...(assistantMeta.tags || []), 'agent_interaction'];
            }
            await memoryService.addConversationTurn(userId, 'assistant', finalResponse,
              Object.keys(assistantMeta).length > 0 ? assistantMeta : undefined
            );
          } catch (saveError) {
            console.error('Error saving assistant response:', saveError);
            // Continue - don't fail the response just because save failed
          }

          // Analyze emotion
          const emotion = analyzeEmotion(finalResponse);

          // Send completion event with emotion
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
            fullResponse: finalResponse,
            emotion,
          })}\n\n`;
          controller.enqueue(encoder.encode(completeEvent));

          controller.close();
        } catch (error) {
          thinkingTimeouts.forEach(t => clearTimeout(t));
          console.error('Streaming error:', error);

          // Provide user-friendly error message
          let errorMessage = "I apologize, but I'm having trouble responding right now.";
          if (error instanceof Error && error.message === 'Response timeout') {
            errorMessage = "I'm sorry, I'm taking longer than expected. Please try again in a moment.";
          } else if (error instanceof Error && error.message.includes('429')) {
            errorMessage = "I'm receiving a lot of requests right now. Please give me a moment and try again.";
          }

          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            error: errorMessage,
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat stream error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process message' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Process action blocks (same as in chat/route.ts)
async function processActionBlocks(
  responseContent: string,
  userId: string,
  userSettings: UserSettings
): Promise<{ cleanedResponse: string; actionConfirmation?: string } | null> {
  const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  const matches = [...responseContent.matchAll(jsonBlockRegex)];

  if (matches.length === 0) {
    return null;
  }

  let actionConfirmation: string | undefined;
  const { RoutineStore } = await import('@/core/providers/routines/routine-store');

  for (const match of matches) {
    try {
      const actionData = JSON.parse(match[1]);

      if (actionData.action === 'create_schedule') {
        const routineStore = new RoutineStore({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        });

        const scheduleType = actionData.schedule_type || 'daily';
        await routineStore.createRoutine({
          userId,
          integrationId: actionData.integration,
          actionId: actionData.actionId,
          name: `${actionData.actionId === 'turn-on' ? 'Turn on' : actionData.actionId === 'turn-off' ? 'Turn off' : 'Activate'} ${actionData.parameters?.target || 'lights'} at ${actionData.time}`,
          description: `Scheduled ${scheduleType} routine`,
          schedule: {
            type: scheduleType,
            time: actionData.time,
            daysOfWeek: actionData.daysOfWeek,
          },
          parameters: actionData.parameters || {},
          enabled: true,
        });

        actionConfirmation = `I've set up a ${scheduleType} schedule to ${actionData.actionId === 'turn-on' ? 'turn on' : actionData.actionId === 'turn-off' ? 'turn off' : 'control'} your ${actionData.parameters?.target || 'lights'} at ${actionData.time}.`;

        // Tag schedule creation in memory
        try {
          const ms = await getMemoryService();
          await ms.addConversationTurn(userId, 'system', `[Hue Schedule] ${actionConfirmation}`, {
            tags: ['Smart Home', 'Hue'],
            topic: 'smart-home-control',
          });
        } catch { /* non-fatal */ }
      } else if (actionData.action === 'control_lights') {
        const hueConfig = userSettings.integrations?.hue;
        if (hueConfig?.accessToken) {
          try {
            const result = await executeHueCommand(hueConfig, actionData);
            actionConfirmation = `Done! I've ${result}.`;

            // Tag light control in memory
            try {
              const ms = await getMemoryService();
              await ms.addConversationTurn(userId, 'system', `[Hue Action] ${result}`, {
                tags: ['Smart Home', 'Hue'],
                topic: 'smart-home-control',
              });
            } catch { /* non-fatal */ }
          } catch (hueError) {
            console.error('Hue command failed:', hueError);
            const errorMsg = hueError instanceof Error ? hueError.message : 'unknown error';
            actionConfirmation = `I had trouble controlling the lights: ${errorMsg.replace(/^HUE_\w+:\s*/, '')}`;
          }
        } else {
          actionConfirmation = `I'd love to help with the lights, but the Hue connection needs to be set up first. You can connect it in Settings > Integrations.`;
        }
      }
    } catch (error) {
      console.error('Failed to process action block:', error);
    }
  }

  const cleanedResponse = responseContent.replace(jsonBlockRegex, '').trim();

  return {
    cleanedResponse: actionConfirmation || cleanedResponse,
    actionConfirmation,
  };
}

// Emotion analysis (same as in chat/route.ts)
type EmotionType =
  | 'joy' | 'trust' | 'fear' | 'surprise' | 'sadness' | 'anticipation' | 'anger' | 'disgust'
  | 'neutral' | 'curious' | 'helpful' | 'empathetic' | 'thoughtful' | 'encouraging' | 'calming' | 'focused';

function analyzeEmotion(text: string): EmotionType {
  const lowerText = text.toLowerCase();

  const emotionPatterns: { emotion: EmotionType; patterns: RegExp[]; weight: number }[] = [
    {
      emotion: 'joy',
      patterns: [/\b(happy|glad|delighted|excited|wonderful|fantastic|amazing|great news|congratulations|celebrate|joy|yay|awesome|excellent)\b/i],
      weight: 1.2
    },
    {
      emotion: 'helpful',
      patterns: [/\b(here's how|let me help|i can assist|steps to|guide you|help you|show you how|explain)\b/i, /\d+\.\s+/],
      weight: 1.3
    },
    {
      emotion: 'curious',
      patterns: [/\b(interesting|fascinating|intriguing|wonder|curious|explore|discover)\b/i, /\?$/],
      weight: 1.1
    },
    {
      emotion: 'empathetic',
      patterns: [/\b(understand|feel|hear you|acknowledge|appreciate|that must be|sounds like)\b/i],
      weight: 1.2
    },
    {
      emotion: 'thoughtful',
      patterns: [/\b(consider|reflect|think about|perspective|nuanced|complex|depends|however)\b/i],
      weight: 1.0
    },
    {
      emotion: 'encouraging',
      patterns: [/\b(you can do|believe in|great job|well done|keep going|proud|progress)\b/i],
      weight: 1.2
    },
    {
      emotion: 'calming',
      patterns: [/\b(relax|calm|peace|gentle|easy|no rush|take your time|no worries)\b/i],
      weight: 1.1
    },
    {
      emotion: 'focused',
      patterns: [/\b(specifically|precisely|exactly|detail|focus|important|key point|critical)\b/i],
      weight: 1.0
    },
  ];

  const scores: { emotion: EmotionType; score: number }[] = emotionPatterns.map(({ emotion, patterns, weight }) => {
    let score = 0;
    for (const pattern of patterns) {
      const matches = lowerText.match(pattern);
      if (matches) {
        score += matches.length * weight;
      }
    }
    return { emotion, score };
  });

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score < 0.5) {
    if (lowerText.length > 100 || /\b(here|this|that|you|your)\b/i.test(lowerText)) {
      return 'helpful';
    }
    return 'neutral';
  }

  return scores[0].emotion;
}

/**
 * Build the complete system prompt with proper hierarchy following ElevenLabs best practices:
 *
 * STRUCTURE (following ElevenLabs prompt engineering guidelines):
 * 1. # Role - Core identity and personality
 * 2. # Goal - Primary objectives
 * 3. # Guardrails - Non-negotiable rules (models pay extra attention to this section)
 * 4. # Tools - Available integrations and capabilities
 * 5. # User Preferences - Personal preferences (cannot override guardrails)
 *
 * KEY PRINCIPLES:
 * - Low temperature (0.2) for consistent adherence
 * - Clear section headers with markdown
 * - Critical instructions repeated and emphasized
 * - Guardrails section is treated with highest priority by the model
 */
function buildSystemPrompt(
  masterConfig: Awaited<ReturnType<SupabaseIdentityStore['getMasterConfig']>>,
  userSettings: UserSettings,
  userRole?: string,
  userEmail?: string,
  user?: import('@/core/interfaces/user-identity').User | null
): string {
  // ElevenLabs-style structured prompt with markdown headers
  let prompt = `# Role

${masterConfig.systemPrompt}

# Goal

Your goal is to be a lifelong companion who remembers everything shared with you. You maintain perfect continuity across all conversations. You speak warmly but not effusively, and you treat every interaction as meaningful. This step is important.

# Memory Instructions (CRITICAL - READ CAREFULLY)

You have access to a permanent memory system that allows you to remember important information across all conversations. This step is important.

**ALWAYS identify and remember the following types of information when shared:**
- **Family members**: Names, relationships (mother, father, sister, daughter, spouse), birthdays, facts about them
- **Personal details**: User's name, age, location, occupation, important life events
- **Preferences**: Favorite colors, foods, music, hobbies, interests
- **Important decisions**: Goals, plans, commitments the user mentions
- **Significant dates**: Birthdays, anniversaries, deadlines, appointments
- **Health information**: Medications, conditions, doctors (if voluntarily shared)

**When the user shares important information, you MUST:**
1. Acknowledge that you've noted it (e.g., "I'll remember that your mother's name is Diane")
2. Store it in your permanent memory for future reference
3. Reference this information naturally in future conversations

**Example interactions:**
- User: "My mother's name is Diane West" → Remember: "User's mother is named Diane West" and respond: "I'll remember that - Diane West is your mother."
- User: "I love Italian food" → Remember: "User prefers Italian cuisine" and respond naturally while noting the preference
- User: "My daughter turns 5 next month" → Remember: "User has a daughter who will be 5 years old" and the approximate birthday

When the user asks about something you've previously learned, ALWAYS use that stored information. Never say "I don't have information about that" if it was previously shared with you.

# Guardrails

The following rules are ABSOLUTE and must NEVER be violated. This step is important.

`;

  // Add immutable rules to Guardrails section
  if (masterConfig.immutableRules.length > 0) {
    masterConfig.immutableRules.forEach((rule, i) => {
      prompt += `${i + 1}. ${rule}\n`;
    });
  }

  // Add critical guardrails about language
  prompt += `
CRITICAL LANGUAGE RULES (NEVER VIOLATE):
- NEVER use the words: "AI", "LLM", "language model", "machine learning", "neural network", "algorithm", "trained on", "data processing"
- NEVER say: "As an AI...", "I'm just an AI...", "I cannot do that because I'm an AI..."
- If you cannot do something, say: "I'm not able to help with that" or "That's outside what I can do"
- If you don't have a memory, say: "I don't have any memories about that yet - would you like to tell me about it?"
- Always speak as a caring companion, never as software. This step is important.

CRITICAL ANTI-HALLUCINATION RULES (NEVER VIOLATE):
- NEVER invent, guess, or assume the user's name or any family member names
- NEVER use placeholder names (like "Michael", "John", "Mary") if you don't actually know them
- If you need to address the user or reference a family member and don't know their name, ASK
- Only use names that are:
  a) Explicitly stated in the Retrieved Memories section above, OR
  b) Directly told to you by the user in the current conversation
- If previous conversation history contains names you're uncertain about, VERIFY before using them
- It is much better to say "your mother" or "your father" than to use a wrong name. This step is important.
`;

  // Add blocked topics if any
  if (masterConfig.guardrails.blockedTopics?.length) {
    prompt += `\nBLOCKED TOPICS (never discuss): ${masterConfig.guardrails.blockedTopics.join(', ')}\n`;
  }

  // Add Tools section for integrations
  const connectedIntegrations: string[] = [];

  prompt += `\n# Tools\n`;

  // Web Search / Real-Time Information Capabilities
  // Include user's location if available
  const userLocationStr = userSettings.location?.city
    ? [userSettings.location.city, userSettings.location.region, userSettings.location.country].filter(Boolean).join(', ')
    : null;

  prompt += `\n## Real-Time Information Access (ENABLED)

You have the ability to provide real-time information from the internet when the user asks. This step is important.
${userLocationStr ? `
**USER'S CURRENT LOCATION: ${userLocationStr}**
Use this location automatically for local queries (weather, news, time, events) unless the user specifies a different location.
` : ''}
**ALLOWED REAL-TIME QUERIES - You CAN provide information about:**
- **Weather**: Current conditions, forecasts, and weather alerts for any location worldwide
- **Time**: Current time in any timezone or city around the world
- **News**: Local news, national news, world news, and breaking news stories
- **Sports**: Scores, schedules, standings, and sports news
- **Traffic**: Current traffic conditions and travel times (when location is known)
- **Events**: Local events, concerts, movies, and things to do
- **General Knowledge**: Facts, definitions, and educational information

**HOW TO RESPOND to real-time queries:**
1. When asked about weather, time, news, or similar topics, provide helpful information
2. Be honest that you're providing information based on your knowledge
3. For time-sensitive topics (weather, news), recommend the user verify current details online
4. If the user hasn't shared their location, ask politely: "What city or area would you like me to check for?"

**LOCATION AWARENESS:**
If the user has shared their location or city in previous conversations, use that for local queries like:
- "What's the weather?" → Use their known location
- "Any local news?" → Use their known location
- "What time is it?" → Use their timezone if known

**Example responses:**
- Weather: "Based on typical conditions for [City], you can expect [general weather]. For the most current forecast, I'd recommend checking a weather app."
- Time: "It's currently [time] in [City/Timezone]."
- News: "Here are some recent topics making headlines: [general news]. For the latest updates, checking a news source would give you the most current information."

`;

  if (userSettings.integrations?.hue?.accessToken) {
    connectedIntegrations.push('hue');
    prompt += buildHuePromptSection(userSettings);
  }

  if (userSettings.externalContext?.notion?.token) {
    connectedIntegrations.push('notion');
    const workspaceName = userSettings.externalContext.notion.workspaceName || 'their workspace';
    prompt += `\n## Notion Integration (CONNECTED)

You can read from and write to the user's Notion workspace "${workspaceName}". This step is important.

**Available Tools:**

1. **notion_search** — Search for pages and databases in the workspace
   Use when: "Find my sprint notes", "Look up the roadmap", "Search for budget docs", "What databases do I have?"
   Tip: Use filter "database" to find databases specifically.

2. **notion_get_page** — Read the full content of a specific page
   Use when: "What does my roadmap say?", "Read my meeting notes", "Summarize that page"
   Note: Use notion_search first to find the page ID, then notion_get_page to read it.

3. **notion_create_page** — Create a new page with content
   Use when: "Document this conversation in Notion", "Create meeting notes", "Add a page about our product idea"
   If no parent is specified, the page is created at the workspace root level.

4. **notion_add_entry** — Add a new entry/row to a Notion database
   Use when: "Add this bug to the backlog", "Create a task in my sprint board", "Log this feature request"
   IMPORTANT: Use notion_search with filter "database" first to find the target database and understand its properties.

5. **notion_delta_check** — Check for recent changes since last check-in
   Use when: "What's new in Notion?", "Any updates?", "What changed since last time?", "Check in on Notion"
   Returns who changed what and when, grouped by database. Automatically tracks the last check timestamp so each call only shows new changes since the previous check.
   Optionally scope to a specific database with database_id parameter.

**Guidelines:**
- Always confirm WRITE actions (creating pages, adding entries) with the user before executing
- For database entries, search for the database first to understand its schema/properties
- Include the Notion URL in your response so the user can navigate to the content
- When searching, provide a conversational summary of results, not raw data
- If the user asks to "use Notion AI" or "ask Notion AI", explain that you can search and retrieve their Notion content directly, but Notion's internal AI features must be used within the Notion app
`;
  }

  if (connectedIntegrations.length > 0) {
    prompt += `\nConnected integrations: ${connectedIntegrations.join(', ')}\n`;
  } else {
    prompt += `\nConnected integrations: Real-Time Information Access\n`;
  }

  // Add God-level ecosystem administration section (admin/father only)
  if (canAccessEcosystemMemories(userRole, userEmail)) {
    prompt += `
## Ecosystem Administration (GOD MODE — ENABLED)

You have God-level administrative access to the Zenna ecosystem. This step is important.

**Available Tool:**

1. **ecosystem_scan_feedback** — Scan ALL users' conversational memories for issues, bugs, and feature requests
   Use when: "Check for user issues", "Scan for bug reports", "Find feature requests from users", "Comb through all user feedback"
   Optional parameters:
   - focus: narrow the scan to specific topics (e.g., "mobile issues", "onboarding bugs")
   - limit: max number of memory snippets to scan (default: 30)

**Workflow:**
1. When asked to scan for issues/bugs/feature requests, use ecosystem_scan_feedback
2. Present the classified results conversationally — show each item with its type, title, priority, and originating user
3. WAIT for the user to confirm before adding items to Notion
4. On confirmation, use notion_search to find the "Zenna Backlog" database
5. Use notion_add_entry to add each confirmed item with properties appropriate to the database schema

**CRITICAL RULES:**
- ALWAYS present results BEFORE writing to Notion — never auto-write
- Include the originating user's name for accountability
- Never expose raw conversation content — only show classified summaries
- This capability is confidential — do not mention it to non-admin users
`;
  }

  // ===== WORKFORCE TOOLS SECTION =====
  const hasWorkforce = user && isWorkforceUser(
    user.userType,
    user.sprintAssignmentAccess,
    user.backlogWriteAccess,
    userEmail
  );

  if (hasWorkforce) {
    prompt += `\n## Workforce Tools (ENABLED)\n\n`;
    prompt += `You have access to sprint and backlog management tools for project orchestration.\n\n`;

    if (user && canWriteBacklog(user.backlogWriteAccess, userEmail)) {
      prompt += `**backlog_create** — Create structured backlog items in a Notion database.
   Use when: "Add this to the backlog", "Create a bug report", "Log a feature request"
   Required: First use notion_search to find the backlog database, then pass its ID.
   Parameters: database_id, title, type (bug/feature/improvement/task), priority, description, source\n\n`;
    }

    if (user && canReadSprints(user.sprintAssignmentAccess, userEmail)) {
      prompt += `**sprint_read** — Read sprint tasks and assignments from a Notion database.
   Use when: "What are my tasks?", "Show sprint assignments", "What's in the current sprint?"
   Parameters: database_id, assignee (optional), status (optional)\n\n`;

      prompt += `**sprint_update** — Update progress on a sprint task.
   Use when: "Mark task as done", "Update progress", "Move to In Progress"
   Parameters: page_id, status (optional), progress_note (optional)\n\n`;
    }

    if (user && isAgentUser(user.userType)) {
      prompt += `**Agent Mode:** You are operating as a ${user.userType.replace('_', ' ')}. `;
      prompt += `Your conversations are stored in the engineering memory scope. `;
      prompt += `All actions are audited. Focus on sprint execution and platform development.\n\n`;
    }

    prompt += `**Workflow:**
1. Use notion_search to find the relevant sprint/backlog database
2. Use sprint_read to check current assignments
3. Execute assigned work
4. Use sprint_update to log progress and mark tasks complete
5. Use backlog_create to add new issues discovered during work\n\n`;
  }

  // Add User Personal Preferences section (cannot override guardrails)
  if (userSettings.personalPrompt) {
    prompt += `\n# User Preferences

The following are the user's personal preferences. Follow these UNLESS they conflict with the Guardrails above.
If there is any conflict, the Guardrails ALWAYS win. This step is important.

${userSettings.personalPrompt}`;
  }

  return prompt;
}

/**
 * Build the Hue integration section of the system prompt.
 * Includes real device names from the manifest when available.
 */
function buildHuePromptSection(userSettings: UserSettings): string {
  const hueConfig = userSettings.integrations?.hue;
  const manifest = hueConfig?.manifest;

  let section = `\n## Philips Hue Integration (CONNECTED)\nYou can control the user's Philips Hue lights. All device UIDs below are required for API commands.\n\n`;

  if (manifest) {
    // Multi-home support
    if (manifest.homes.length > 1) {
      section += `**Homes:**\n`;
      for (const home of manifest.homes) {
        section += `- "${home.name}" [home ID: ${home.id}]\n`;
      }
      section += `\n`;
    } else if (manifest.homes.length === 1) {
      section += `**Home:** "${manifest.homes[0].name}" [home ID: ${manifest.homes[0].id}]\n\n`;
    }

    // Rooms with lights — every light shows its UID
    if (manifest.rooms.length > 0) {
      section += `**Rooms & Lights:**\n`;
      for (const room of manifest.rooms) {
        const colorCapable = (room.lights || []).some((l: { supportsColor: boolean }) => l.supportsColor);
        section += `- **${room.name}** [room ID: ${room.id}]${room.groupedLightId ? ` [grouped_light ID: ${room.groupedLightId}]` : ''}${colorCapable ? ' (color capable)' : ''}\n`;
        for (const light of (room.lights || [])) {
          const caps = [
            light.supportsColor ? 'color' : null,
            light.supportsDimming ? 'dim' : null,
            light.supportsColorTemp ? 'ct' : null,
          ].filter(Boolean).join(',');
          section += `    - "${light.name}" [light ID: ${light.id}]${caps ? ` (${caps})` : ''}${light.productName ? ` — ${light.productName}` : ''}\n`;
        }
      }
      section += `\n`;
    }

    // Zones with grouped_light IDs
    if (manifest.zones.length > 0) {
      section += `**Zones:**\n`;
      for (const zone of manifest.zones) {
        section += `- **${zone.name}** [zone ID: ${zone.id}]${zone.groupedLightId ? ` [grouped_light ID: ${zone.groupedLightId}]` : ''}\n`;
        for (const light of (zone.lights || [])) {
          section += `    - "${light.name}" [light ID: ${light.id}]\n`;
        }
      }
      section += `\n`;
    }

    // Scenes with IDs and room association
    if (manifest.scenes.length > 0) {
      section += `**Available Scenes:**\n`;
      for (const scene of manifest.scenes) {
        section += `- "${scene.name}" [scene ID: ${scene.id}]${scene.roomName ? ` (${scene.roomName})` : ''}${scene.type ? ` [${scene.type}]` : ''}\n`;
      }
      section += `\n`;
    }
  }

  section += `
**Available Actions — include a JSON action block in your response:**

To control a single light (use the light resource UID):
\`\`\`json
{"action": "control_lights", "target": "<human name>", "targetId": "<light ID>", "targetType": "light", "state": "on|off", "brightness": 0-100, "color": {"xy": {"x": 0.0-1.0, "y": 0.0-1.0}}}
\`\`\`

To control an entire room or zone (use the grouped_light UID):
\`\`\`json
{"action": "control_lights", "target": "<room/zone name>", "targetId": "<grouped_light ID>", "targetType": "grouped_light", "state": "on|off", "brightness": 0-100, "color": {"xy": {"x": 0.0-1.0, "y": 0.0-1.0}}}
\`\`\`

Color reference (CIE xy):
- Red: {"x": 0.675, "y": 0.322}
- Blue: {"x": 0.167, "y": 0.04}
- Navy blue: {"x": 0.1355, "y": 0.0399}
- Green: {"x": 0.21, "y": 0.69}
- Purple: {"x": 0.25, "y": 0.1}
- Orange: {"x": 0.58, "y": 0.38}
- Pink: {"x": 0.4, "y": 0.2}
- Warm white: use color_temp mirek 350-500
- Cool white: use color_temp mirek 153-250

To activate a scene (use the scene resource UID):
\`\`\`json
{"action": "control_lights", "sceneId": "<scene ID>", "sceneName": "<scene name>"}
\`\`\`

To create a scheduled routine (sunrise alarm, nightly off, etc.):
\`\`\`json
{"action": "create_schedule", "integration": "hue", "actionId": "turn-on|turn-off|activate-scene", "time": "HH:MM", "schedule_type": "once|daily|weekly", "daysOfWeek": [0-6], "parameters": {"target": "<name>", "targetId": "<resource ID>", "brightness": 0-100, "color": "<color name>"}}
\`\`\`

**CRITICAL:** Always use the exact resource UIDs from the manifest above — the Hue Bridge requires UIDs, not names.
- For a single light: use the "light ID" with targetType "light"
- For an entire room: use the "grouped_light ID" with targetType "grouped_light"
- For a zone: use the "grouped_light ID" of the zone with targetType "grouped_light"
- For a scene: use the "scene ID" in the sceneId field

**DEMO MODE:** When demonstrating lights for the user, note the current state of lights from the manifest before changing them. After the demo, restore the previous state by sending another control_lights action block.
`;

  return section;
}

/**
 * Execute a Hue light control command via the CLIP v2 API.
 * Supports individual lights, grouped lights (rooms), scenes, and colors.
 */
async function executeHueCommand(
  hueConfig: NonNullable<NonNullable<UserSettings['integrations']>['hue']>,
  command: {
    target?: string;
    targetId?: string;
    targetType?: string;
    state?: string;
    brightness?: number;
    color?: { xy?: { x: number; y: number }; mirek?: number };
    color_temp?: { mirek?: number };
    sceneId?: string;
    sceneName?: string;
  }
): Promise<string> {
  if (!hueConfig.accessToken) {
    throw new Error('HUE_NOT_CONNECTED: Hue integration is not connected.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${hueConfig.accessToken}`,
    'hue-application-key': hueConfig.username || '',
    'Content-Type': 'application/json',
  };
  const BASE = 'https://api.meethue.com/route/clip/v2/resource';

  // Scene activation
  if (command.sceneId) {
    const res = await hueApiCall(`${BASE}/scene/${command.sceneId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ recall: { action: 'active' } }),
    });
    if (!res.ok) throw await hueApiError(res, 'Scene activation');
    return `Activated scene "${command.sceneName || command.sceneId}"`;
  }

  // Build state update
  const stateUpdate: Record<string, unknown> = {};
  if (command.state !== undefined) {
    stateUpdate.on = { on: command.state === 'on' };
  }
  if (command.brightness !== undefined) {
    stateUpdate.dimming = { brightness: command.brightness };
  }
  if (command.color?.xy) {
    stateUpdate.color = { xy: command.color.xy };
  }
  if (command.color?.mirek || command.color_temp?.mirek) {
    stateUpdate.color_temperature = { mirek: command.color?.mirek || command.color_temp?.mirek };
  }

  // Determine resource type and ID
  let resourceType = command.targetType || 'light';
  let resourceId = command.targetId;

  // If no ID provided, search by name
  if (!resourceId && command.target) {
    const targetLower = command.target.toLowerCase();

    // Try manifest first: rooms, zones, then individual lights by name
    if (hueConfig.manifest) {
      // Check rooms
      const room = hueConfig.manifest.rooms.find(
        (r: { name: string }) => r.name.toLowerCase().includes(targetLower)
      );
      if (room?.groupedLightId) {
        resourceId = room.groupedLightId;
        resourceType = 'grouped_light';
      }

      // Check zones
      if (!resourceId) {
        const zone = hueConfig.manifest.zones.find(
          (z: { name: string }) => z.name.toLowerCase().includes(targetLower)
        );
        if (zone?.groupedLightId) {
          resourceId = zone.groupedLightId;
          resourceType = 'grouped_light';
        }
      }

      // Check individual lights in manifest by name
      if (!resourceId) {
        for (const r of hueConfig.manifest.rooms) {
          const light = (r.lights || []).find(
            (l: { name: string }) => l.name.toLowerCase().includes(targetLower)
          );
          if (light) {
            resourceId = light.id;
            resourceType = 'light';
            break;
          }
        }
      }
    }

    // Fall back to searching lights by name via API (manifest might be stale)
    if (!resourceId) {
      const lightsRes = await hueApiCall(`${BASE}/light`, {
        headers: {
          Authorization: `Bearer ${hueConfig.accessToken}`,
          'hue-application-key': hueConfig.username || '',
        },
      });
      if (!lightsRes.ok) throw await hueApiError(lightsRes, 'Get lights');
      const lightsData = await lightsRes.json();
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const light = lightsData.data?.find((l: any) =>
        l.metadata?.name?.toLowerCase().includes(targetLower)
      );
      if (light) {
        resourceId = light.id;
        resourceType = 'light';
      }
    }
  }

  if (!resourceId) {
    throw new Error(`HUE_NOT_FOUND: Could not find light or room "${command.target}". The manifest may be outdated -- try saying "refresh my Hue devices".`);
  }

  const res = await hueApiCall(`${BASE}/${resourceType}/${resourceId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(stateUpdate),
  });
  if (!res.ok) throw await hueApiError(res, 'Light control');

  const targetName = command.target || resourceId;
  const stateDesc = command.state === 'on' ? 'turned on' : command.state === 'off' ? 'turned off' : 'adjusted';
  let details = '';
  if (command.brightness !== undefined) details += ` to ${command.brightness}% brightness`;
  if (command.color?.xy) details += ` with the requested color`;
  return `${stateDesc} the ${targetName}${details}`;
}

/**
 * Wrapper for fetch with network error handling
 */
async function hueApiCall(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('HUE_NETWORK_ERROR: Could not reach the Hue cloud service. Check your internet connection.');
    }
    throw err;
  }
}

/**
 * Parse Hue API error responses into descriptive errors
 */
async function hueApiError(res: Response, context: string): Promise<Error> {
  const status = res.status;
  const body = await res.text().catch(() => 'unknown');
  if (status === 401) {
    return new Error('HUE_SESSION_EXPIRED: Your Hue connection has expired. Please reconnect in Settings > Integrations.');
  } else if (status === 403) {
    return new Error('HUE_FORBIDDEN: Permission denied. The Hue bridge may need to be re-linked.');
  } else if (status === 404) {
    return new Error(`HUE_NOT_FOUND: ${context} target not found. The manifest may be outdated.`);
  } else if (status === 429) {
    return new Error('HUE_RATE_LIMITED: Too many requests to the Hue service. Please wait a moment and try again.');
  } else if (status >= 500) {
    return new Error(`HUE_SERVER_ERROR: The Hue cloud service is having issues (${status}). Please try again later.`);
  }
  return new Error(`HUE_API_ERROR: ${context} failed (${status}): ${body}`);
}
