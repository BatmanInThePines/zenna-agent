import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService, MemoryService } from '@/core/services/memory-service';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';
import { RoutineStore } from '@/core/providers/routines/routine-store';
import { INTEGRATION_MANIFESTS, getIntegrationContextSummary } from '@/core/interfaces/integration-manifest';
import { getProductConfig, buildProductSystemPrompt } from '@/core/products';
import { handle360AwareAction } from '@/core/actions/360aware-handler';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';

// Product context passed from client apps
interface ProductContext {
  productId?: string;
  location?: { lat: number; lng: number };
  heading?: number | null;
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

// Service-to-service authentication for product integrations (e.g., 360Aware)
const THREESIXTY_AWARE_SHARED_SECRET = process.env.THREESIXTY_AWARE_SHARED_SECRET;

export async function POST(request: NextRequest) {
  try {
    // Initialize memory service
    const memoryService = await getMemoryService();
    const identityStore = memoryService.getIdentityStore();

    // Check for service-to-service auth (360Aware calling Zenna)
    const productId = request.headers.get('X-Product-Id');
    const serviceUserId = request.headers.get('X-User-Id');
    const serviceAuth = request.headers.get('X-Service-Auth');

    let userId: string;

    if (productId === '360aware' && serviceAuth && serviceUserId) {
      // Validate service-to-service authentication
      if (THREESIXTY_AWARE_SHARED_SECRET && serviceAuth === THREESIXTY_AWARE_SHARED_SECRET) {
        // Service auth valid - use provided user ID (360Aware creates headless accounts)
        userId = serviceUserId;
        console.log(`[Chat] Service auth from 360Aware for user: ${userId}`);
      } else {
        console.warn('[Chat] Invalid 360Aware service auth');
        return NextResponse.json({ error: 'Invalid service authentication' }, { status: 401 });
      }
    } else {
      // Standard user authentication via NextAuth
      const session = await auth();

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      userId = session.user.id;
    }

    const { message, productContext } = await request.json() as {
      message: string;
      productContext?: ProductContext;
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Check for product-specific context (e.g., 360Aware)
    const productConfig = productContext?.productId
      ? getProductConfig(productContext.productId)
      : null;

    // Get user and master config
    let [user, masterConfig] = await Promise.all([
      identityStore.getUser(userId),
      identityStore.getMasterConfig(),
    ]);

    // Auto-create headless user for product integrations (e.g., 360Aware)
    if (!user && productContext?.productId) {
      console.log(`[Chat] Creating headless user for ${productContext.productId}: ${userId}`);
      try {
        // Cast to access the createHeadlessUser method
        const supabaseStore = identityStore as import('@/core/providers/identity/supabase-identity').SupabaseIdentityStore;
        user = await supabaseStore.createHeadlessUser(userId, productContext.productId);
        console.log(`[Chat] Headless user created: ${user.id}`);
      } catch (createError) {
        console.error('[Chat] Failed to create headless user:', createError);
        return NextResponse.json({ error: 'Failed to create user account' }, { status: 500 });
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get conversation history (permanent, never deleted)
    // NOTE: Memory is shared across all apps (Zenna, 360Aware, etc.)
    // This ensures cross-app continuity - if a user talks to 360Aware,
    // those memories are available when they use Zenna and vice versa
    const storedHistory = await memoryService.getConversationHistory(userId);

    // Build message history for LLM
    // Use product-specific prompt if this is a product request (e.g., 360Aware)
    // Otherwise use the standard Zenna prompt
    const systemPrompt = productConfig
      ? buildProductSystemPrompt(productConfig)
      : buildSystemPrompt(masterConfig, user.settings);

    const history: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Inject relevant memories from semantic search (ElevenLabs best practice: retrieveMemories at start of turn)
    const memoryContext = await memoryService.buildMemoryContext(userId, message);
    if (memoryContext) {
      // ElevenLabs pattern: Inject memory context as a separate system message
      // This ensures the LLM has access to relevant past information
      history.push({
        role: 'system',
        content: `# Retrieved Memories (USE THIS INFORMATION)

The following memories have been retrieved based on the current conversation context. You MUST use this information when responding. This step is important.

${memoryContext}

IMPORTANT: If the user asks about something mentioned in the memories above, USE that information. Never say "I don't have information about that" if the information is provided above.`,
      });
    } else {
      // ElevenLabs fallback logic: Handle empty memory gracefully
      history.push({
        role: 'system',
        content: `# Memory Status

No previous memories found related to this topic. If the user shares important information (family members, preferences, significant events), make note of it for future conversations.`,
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

    // Add current user message
    history.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Save user message to permanent storage (Supabase + Pinecone if configured)
    await memoryService.addConversationTurn(userId, 'user', message);

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
      console.error('No API key configured for brain provider');
      return NextResponse.json({ error: 'LLM not configured. Set ANTHROPIC_API_KEY or GOOGLE_AI_API_KEY.' }, { status: 500 });
    }

    console.log(`[Chat] Using brain provider: ${brainProviderId}`);

    const brainProvider = brainProviderFactory.create(brainProviderId, {
      apiKey: brainApiKey,
    });

    // Generate response
    console.log('Generating response...');
    const response = await brainProvider.generateResponse(history);
    console.log('Response generated successfully');

    // Check for action blocks in response (e.g., schedule creation, 360Aware queries)
    let responseText = response.content;
    let highlights: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> | undefined;

    const actionResult = await processActionBlocks(
      response.content,
      userId,
      user.settings,
      productContext // Pass product context for 360Aware actions
    );
    if (actionResult) {
      responseText = actionResult.cleanedResponse;
      // If action was processed, add confirmation to response
      if (actionResult.actionConfirmation) {
        responseText = actionResult.actionConfirmation;
      }
      // Capture highlights for map integration (360Aware)
      if (actionResult.highlights) {
        highlights = actionResult.highlights;
      }
    }

    // Save assistant response to permanent storage (Supabase + Pinecone if configured)
    // NOTE: Memories are PERMANENT - we never delete them unless explicitly requested
    const isHueRelated = actionResult?.actionConfirmation !== undefined &&
      response.content.includes('control_lights');
    await memoryService.addConversationTurn(userId, 'assistant', responseText,
      isHueRelated ? { tags: ['Smart Home', 'Hue'], topic: 'smart-home-control' } : undefined
    );

    // Generate TTS audio
    let audioUrl: string | undefined;

    const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
    const hasElevenLabsVoice = !!process.env.ELEVENLABS_VOICE_ID;

    console.log('TTS config check:', {
      hasElevenLabsKey,
      hasElevenLabsVoice,
      responseTextLength: responseText.length,
      responseTextPreview: responseText.substring(0, 100),
    });

    if (!hasElevenLabsKey || !hasElevenLabsVoice) {
      console.warn('TTS disabled - missing env vars:', {
        ELEVENLABS_API_KEY: hasElevenLabsKey ? 'set' : 'MISSING',
        ELEVENLABS_VOICE_ID: hasElevenLabsVoice ? 'set' : 'MISSING',
      });
    }

    if (hasElevenLabsKey && hasElevenLabsVoice) {
      try {
        console.log('Generating TTS audio for chat response...');
        const ttsProvider = new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY!,
          voiceId: process.env.ELEVENLABS_VOICE_ID!,
        });

        const result = await ttsProvider.synthesize(responseText);

        if (!result.audioBuffer || result.audioBuffer.byteLength === 0) {
          console.error('TTS returned empty audio buffer for chat response');
        } else {
          console.log(`TTS chat audio generated: ${result.audioBuffer.byteLength} bytes`);
          // Convert audio buffer to base64 data URL
          const base64 = Buffer.from(result.audioBuffer).toString('base64');
          audioUrl = `data:audio/mpeg;base64,${base64}`;
          console.log('TTS audio URL created, length:', audioUrl.length);
        }
      } catch (error) {
        console.error('TTS synthesis error for chat:', error);
        // Continue without audio
      }
    } else {
      console.log('TTS skipped due to missing credentials');
    }

    // Analyze response tone/emotion for avatar color
    const emotion = analyzeEmotion(responseText);

    return NextResponse.json({
      response: responseText,
      audioUrl,
      highlights, // Map highlights for 360Aware
      emotion,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

// Process action blocks in LLM response (e.g., schedule creation, light control, 360Aware queries)
async function processActionBlocks(
  responseContent: string,
  userId: string,
  userSettings: UserSettings,
  productContext?: ProductContext
): Promise<{
  cleanedResponse: string;
  actionConfirmation?: string;
  highlights?: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }>;
} | null> {
  // Look for JSON action blocks
  const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  const matches = [...responseContent.matchAll(jsonBlockRegex)];

  if (matches.length === 0) {
    return null;
  }

  let actionConfirmation: string | undefined;
  let highlights: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> | undefined;

  for (const match of matches) {
    try {
      const actionData = JSON.parse(match[1]);

      if (actionData.action === 'create_schedule') {
        // Create a scheduled routine
        const routineStore = new RoutineStore({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        });

        const scheduleType = actionData.schedule_type || 'daily';
        const routine = await routineStore.createRoutine({
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

        console.log(`Created schedule: ${routine.name}`);
        actionConfirmation = `I've set up a ${scheduleType} schedule to ${actionData.actionId === 'turn-on' ? 'turn on' : actionData.actionId === 'turn-off' ? 'turn off' : 'control'} your ${actionData.parameters?.target || 'lights'} at ${actionData.time}. I'll remember to do this automatically!`;

        // Tag schedule creation in memory
        try {
          const ms = await getMemoryService();
          await ms.addConversationTurn(userId, 'system', `[Hue Schedule] ${actionConfirmation}`, {
            tags: ['Smart Home', 'Hue'],
            topic: 'smart-home-control',
          });
        } catch { /* non-fatal */ }
      } else if (actionData.action === 'control_lights') {
        // Immediate light control (enhanced with color, scene, room support)
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
      } else if (actionData.action === 'query_360aware') {
        // 360Aware road safety data query
        if (productContext?.location) {
          console.log(`360Aware query: ${actionData.type} at ${productContext.location.lat}, ${productContext.location.lng}`);
          const result = await handle360AwareAction(actionData, {
            lat: productContext.location.lat,
            lng: productContext.location.lng,
            heading: productContext.heading,
          });
          actionConfirmation = result.result;
          highlights = result.highlights;
        } else {
          console.warn('360Aware action requested but no location provided');
          actionConfirmation = "I need your location to check road conditions. Please enable GPS.";
        }
      }
    } catch (error) {
      console.error('Failed to process action block:', error);
    }
  }

  // Remove action blocks from response for cleaner text
  const cleanedResponse = responseContent.replace(jsonBlockRegex, '').trim();

  return {
    cleanedResponse: actionConfirmation || cleanedResponse,
    actionConfirmation,
    highlights,
  };
}

// Execute immediate Hue command (enhanced with color, scene, and room support)
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
  if (!hueConfig?.accessToken) {
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

// Emotion types that match Avatar component
type EmotionType =
  | 'joy' | 'trust' | 'fear' | 'surprise' | 'sadness' | 'anticipation' | 'anger' | 'disgust'
  | 'neutral' | 'curious' | 'helpful' | 'empathetic' | 'thoughtful' | 'encouraging' | 'calming' | 'focused';

// Analyze text content to determine emotional tone
// Based on sentiment analysis and keyword matching
function analyzeEmotion(text: string): EmotionType {
  const lowerText = text.toLowerCase();

  // Keyword patterns for each emotion (weighted by specificity)
  const emotionPatterns: { emotion: EmotionType; patterns: RegExp[]; weight: number }[] = [
    // Primary emotions
    {
      emotion: 'joy',
      patterns: [
        /\b(happy|glad|delighted|excited|wonderful|fantastic|amazing|great news|congratulations|celebrate|joy|yay|awesome|excellent)\b/i,
        /!\s*$/,
        /😊|😄|🎉|✨/
      ],
      weight: 1.2
    },
    {
      emotion: 'sadness',
      patterns: [
        /\b(sorry|sad|unfortunate|regret|apologize|condolences|loss|miss|difficult time|tough|hard to hear)\b/i,
        /😢|😔|💔/
      ],
      weight: 1.1
    },
    {
      emotion: 'fear',
      patterns: [
        /\b(warning|danger|careful|caution|risk|threat|worry|concern|alarming|urgent)\b/i,
        /⚠️|🚨/
      ],
      weight: 1.0
    },
    {
      emotion: 'surprise',
      patterns: [
        /\b(wow|surprising|unexpected|incredible|unbelievable|astonishing|amazingly|remarkably)\b/i,
        /\?!/,
        /😮|😲|🤯/
      ],
      weight: 1.0
    },
    {
      emotion: 'anger',
      patterns: [
        /\b(frustrated|annoying|unacceptable|outrageous|terrible|awful|horrible)\b/i,
        /😠|😤/
      ],
      weight: 0.9
    },
    {
      emotion: 'anticipation',
      patterns: [
        /\b(looking forward|can't wait|upcoming|soon|excited about|eager|planning)\b/i,
        /🔮|⏳/
      ],
      weight: 1.0
    },
    {
      emotion: 'trust',
      patterns: [
        /\b(trust|reliable|confident|secure|safe|dependable|honest|integrity)\b/i,
        /🤝|✅/
      ],
      weight: 0.9
    },
    {
      emotion: 'disgust',
      patterns: [
        /\b(disgusting|gross|revolting|unpleasant|distasteful)\b/i,
        /🤢|😷/
      ],
      weight: 0.8
    },

    // Conversational/assistant emotions
    {
      emotion: 'helpful',
      patterns: [
        /\b(here's how|let me help|i can assist|steps to|guide you|help you|show you how|explain)\b/i,
        /\b(here are|here is|to do this|you can)\b/i,
        /\d+\.\s+/  // Numbered lists indicate helpfulness
      ],
      weight: 1.3
    },
    {
      emotion: 'curious',
      patterns: [
        /\b(interesting|fascinating|intriguing|wonder|curious|explore|discover|learn more)\b/i,
        /\?$/,
        /🤔|💭/
      ],
      weight: 1.1
    },
    {
      emotion: 'empathetic',
      patterns: [
        /\b(understand|feel|hear you|acknowledge|appreciate|that must be|sounds like|i see)\b/i,
        /\b(going through|experience|feeling)\b/i,
        /💙|🫂/
      ],
      weight: 1.2
    },
    {
      emotion: 'thoughtful',
      patterns: [
        /\b(consider|reflect|think about|perspective|nuanced|complex|depends|however|although|on the other hand)\b/i,
        /\b(actually|in fact|interestingly)\b/i
      ],
      weight: 1.0
    },
    {
      emotion: 'encouraging',
      patterns: [
        /\b(you can do|believe in|great job|well done|keep going|proud|progress|improvement|success)\b/i,
        /\b(definitely|absolutely|certainly|of course)\b/i,
        /💪|🌟|👏/
      ],
      weight: 1.2
    },
    {
      emotion: 'calming',
      patterns: [
        /\b(relax|calm|peace|gentle|soft|easy|no rush|take your time|no worries|don't worry)\b/i,
        /\b(breathe|settle|quiet|serene)\b/i,
        /🧘|☮️|🌿/
      ],
      weight: 1.1
    },
    {
      emotion: 'focused',
      patterns: [
        /\b(specifically|precisely|exactly|detail|focus|important|key point|critical|essential)\b/i,
        /\b(note that|remember|pay attention)\b/i,
        /🎯|📌/
      ],
      weight: 1.0
    },
  ];

  // Score each emotion
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

  // Sort by score and get the highest
  scores.sort((a, b) => b.score - a.score);

  // If no strong signal, return helpful (default assistant tone) or neutral
  if (scores[0].score < 0.5) {
    // Check if it looks like an informative response
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
`;

  // Add blocked topics if any
  if (masterConfig.guardrails.blockedTopics?.length) {
    prompt += `\nBLOCKED TOPICS (never discuss): ${masterConfig.guardrails.blockedTopics.join(', ')}\n`;
  }

  // Add Tools section for integrations
  const connectedIntegrations: string[] = [];

  prompt += `\n# Tools\n`;

  if (userSettings.integrations?.hue?.accessToken) {
    connectedIntegrations.push('hue');
    prompt += buildHuePromptSection(userSettings);
  }

  if (userSettings.externalContext?.notion?.token) {
    connectedIntegrations.push('notion');
    prompt += `\n## Notion Integration (CONNECTED)
The user has connected their Notion workspace. You have access to their knowledge base.
When they ask questions that might relate to their notes, you can reference this information.
`;
  }

  if (connectedIntegrations.length > 0) {
    prompt += `\nConnected integrations: ${connectedIntegrations.join(', ')}\n`;
  } else {
    prompt += `\nNo external integrations currently connected.\n`;
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
 * Includes all device UIDs from the manifest — required for Hue Bridge API commands.
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
