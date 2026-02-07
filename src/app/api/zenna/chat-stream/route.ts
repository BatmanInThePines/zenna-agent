import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService, MemoryService } from '@/core/services/memory-service';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';

/**
 * Extract important facts from user messages
 * Detects statements about family, preferences, personal info, etc.
 */
function extractFactsFromMessage(message: string): Array<{fact: string; topic: string; tags: string[]}> {
  const facts: Array<{fact: string; topic: string; tags: string[]}> = [];
  const lowerMessage = message.toLowerCase();

  // Family member patterns - "my X is/are/was named Y" or "my X's name is Y"
  const familyPatterns = [
    // Direct name statements
    /my\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner|grandfather|grandmother|grandpa|grandma|uncle|aunt|cousin)(?:'s)?\s+(?:name\s+)?(?:is|was|are)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|$|\s+and|\s+but|\s+who|\s+he|\s+she)/gi,
    // "I have a X named Y"
    /i\s+have\s+a\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner)(?:\s+(?:who\s+is\s+)?named|\s+called)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|$)/gi,
    // "X is my Y" pattern
    /([A-Z][a-zA-Z\s]+?)\s+is\s+my\s+(father|dad|mother|mom|brother|sister|son|daughter|wife|husband|spouse|partner|grandfather|grandmother)/gi,
  ];

  for (const pattern of familyPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const relation = match[1].toLowerCase();
      const name = match[2]?.trim() || match[1]?.trim();
      if (name && name.length > 1 && name.length < 50) {
        // Normalize relation names
        const normalizedRelation = relation.replace('dad', 'father').replace('mom', 'mother')
          .replace('grandpa', 'grandfather').replace('grandma', 'grandmother');
        facts.push({
          fact: `User's ${normalizedRelation}'s name is ${name}`,
          topic: 'family',
          tags: ['family', normalizedRelation, 'personal']
        });
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

    // Verify authentication using NextAuth
    const session = await auth();

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

    // Get user and master config
    const [user, masterConfig] = await Promise.all([
      identityStore.getUser(userId),
      identityStore.getMasterConfig(),
    ]);

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get conversation history (permanent, never deleted)
    const storedHistory = await memoryService.getConversationHistory(userId);

    // Build message history for LLM
    const systemPrompt = buildSystemPrompt(masterConfig, user.settings);
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
      await memoryService.addConversationTurn(userId, 'user', message);

      // Extract and store important facts from user message
      // This ensures facts like "My father's name is X" are stored as high-importance memories
      const extractedFacts = extractFactsFromMessage(message);
      if (extractedFacts.length > 0) {
        console.log(`[Chat] Extracted ${extractedFacts.length} facts from user message:`, extractedFacts.map(f => f.fact));
        for (const { fact, topic, tags } of extractedFacts) {
          try {
            await memoryService.storeImportantFact(userId, fact, {
              topic,
              tags,
              importance: 0.95, // High importance for personal facts
            });
            console.log(`[Chat] Stored fact: "${fact}"`);
          } catch (factError) {
            console.error(`[Chat] Failed to store fact "${fact}":`, factError);
          }
        }
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

    // Tool execution function for web searches
    // BUG 3 FIX: Store internet search results in memory for future recall
    const executeWebSearchTool = async (toolName: string, input: Record<string, unknown>): Promise<string> => {
      if (toolName === 'web_search') {
        try {
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : process.env.NEXTAUTH_URL || 'http://localhost:3000';

          const searchQuery = input.query as string;
          const searchType = input.type as 'weather' | 'news' | 'time' | 'general';

          const response = await fetch(`${baseUrl}/api/zenna/web-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: searchQuery,
              type: searchType,
            }),
          });

          const result = await response.json();
          if (result.success) {
            const resultText = `${result.data}\n(Source: ${result.source})`;

            // BUG 3 FIX: Store internet search in memory for future recall
            try {
              await memoryService.storeInternetSearch(userId, searchQuery, result.data, {
                searchSource: result.source || 'web',
                searchType: searchType,
                topic: searchType,
              });
              console.log(`[Chat] Stored internet search in memory: "${searchQuery}"`);
            } catch (memError) {
              console.error('[Chat] Failed to store internet search in memory:', memError);
              // Don't fail the search just because memory storage failed
            }

            return resultText;
          } else {
            return result.error || 'Search failed';
          }
        } catch (error) {
          console.error('[Chat] Web search error:', error);
          return `Failed to fetch real-time data: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
      return 'Unknown tool';
    };

    // Create SSE stream
    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        // Timeout handling - send "thinking longer" message after 10 seconds
        const THINKING_TIMEOUT_MS = 10000;
        const HARD_TIMEOUT_MS = 60000; // Increased for tool use
        let thinkingTimeoutSent = false;
        let responseStarted = false;
        const startTime = Date.now();

        const thinkingTimeout = setTimeout(() => {
          if (!responseStarted) {
            thinkingTimeoutSent = true;
            const thinkingEvent = `data: ${JSON.stringify({
              type: 'thinking',
              content: "I'm taking a moment to think about this carefully..."
            })}\n\n`;
            controller.enqueue(encoder.encode(thinkingEvent));
          }
        }, THINKING_TIMEOUT_MS);

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
                executeToolFn?: (name: string, input: Record<string, unknown>) => Promise<string>
              ) => AsyncGenerator<string, void, unknown>;
            };
            const responseStream = claudeProvider.generateResponseStreamWithTools(
              history,
              undefined,
              executeWebSearchTool
            );

            for await (const chunk of responseStream) {
              if (!responseStarted) {
                responseStarted = true;
                clearTimeout(thinkingTimeout);
              }

              // Check if this is a tool status message
              if (chunk.startsWith('[Fetching')) {
                // Send as a special status event
                const statusEvent = `data: ${JSON.stringify({ type: 'status', content: chunk })}\n\n`;
                controller.enqueue(encoder.encode(statusEvent));
              } else {
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
                clearTimeout(thinkingTimeout);
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
            clearTimeout(thinkingTimeout);
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
            await memoryService.addConversationTurn(userId, 'assistant', finalResponse,
              isHueRelated ? { tags: ['Smart Home', 'Hue'], topic: 'smart-home-control' } : undefined
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
          clearTimeout(thinkingTimeout);
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
  userSettings: UserSettings
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
    prompt += `\n## Notion Integration (CONNECTED)
The user has connected their Notion workspace.\n`;
  }

  if (connectedIntegrations.length > 0) {
    prompt += `\nConnected integrations: ${connectedIntegrations.join(', ')}\n`;
  } else {
    prompt += `\nConnected integrations: Real-Time Information Access\n`;
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
