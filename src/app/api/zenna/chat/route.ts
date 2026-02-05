import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService, MemoryService } from '@/core/services/memory-service';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';
import { RoutineStore } from '@/core/providers/routines/routine-store';
import { INTEGRATION_MANIFESTS, getIntegrationContextSummary } from '@/core/interfaces/integration-manifest';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';

// Singleton memory service instance
let memoryServiceInstance: MemoryService | null = null;

async function getMemoryService(): Promise<MemoryService> {
  if (!memoryServiceInstance) {
    memoryServiceInstance = createMemoryService();
    await memoryServiceInstance.initialize();
  }
  return memoryServiceInstance;
}

export async function POST(request: NextRequest) {
  try {
    // Initialize memory service
    const memoryService = await getMemoryService();
    const identityStore = memoryService.getIdentityStore();

    // Verify authentication using NextAuth
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Get user and master config
    const [user, masterConfig] = await Promise.all([
      identityStore.getUser(userId),
      identityStore.getMasterConfig(),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get conversation history (permanent, never deleted)
    const storedHistory = await memoryService.getConversationHistory(userId);

    // Build message history for LLM
    const systemPrompt = buildSystemPrompt(masterConfig, user.settings);
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

    // Get brain provider - default to gemini-2.5-flash
    const brainProviderId = user.settings.preferredBrainProvider || masterConfig.defaultBrain.providerId || 'gemini-2.5-flash';
    const brainApiKey = user.settings.brainApiKey || masterConfig.defaultBrain.apiKey || process.env.GOOGLE_AI_API_KEY;

    if (!brainApiKey) {
      console.error('No API key configured for brain provider');
      return NextResponse.json({ error: 'LLM not configured' }, { status: 500 });
    }

    console.log(`Using brain provider: ${brainProviderId}`);

    const brainProvider = brainProviderFactory.create(brainProviderId, {
      apiKey: brainApiKey,
    });

    // Generate response
    console.log('Generating response...');
    const response = await brainProvider.generateResponse(history);
    console.log('Response generated successfully');

    // Check for action blocks in response (e.g., schedule creation)
    let responseText = response.content;
    const actionResult = await processActionBlocks(response.content, userId, user.settings);
    if (actionResult) {
      responseText = actionResult.cleanedResponse;
      // If action was processed, add confirmation to response
      if (actionResult.actionConfirmation) {
        responseText = actionResult.actionConfirmation;
      }
    }

    // Save assistant response to permanent storage (Supabase + Pinecone if configured)
    // NOTE: Memories are PERMANENT - we never delete them unless explicitly requested
    await memoryService.addConversationTurn(userId, 'assistant', responseText);

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
      emotion,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

// Process action blocks in LLM response (e.g., schedule creation, light control)
async function processActionBlocks(
  responseContent: string,
  userId: string,
  userSettings: UserSettings
): Promise<{ cleanedResponse: string; actionConfirmation?: string } | null> {
  // Look for JSON action blocks
  const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/g;
  const matches = [...responseContent.matchAll(jsonBlockRegex)];

  if (matches.length === 0) {
    return null;
  }

  let actionConfirmation: string | undefined;

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
      } else if (actionData.action === 'control_lights') {
        // Immediate light control
        const hueConfig = userSettings.integrations?.hue;
        if (hueConfig?.accessToken) {
          await executeHueCommand(hueConfig, actionData);
          actionConfirmation = `Done! I've ${actionData.state === 'on' ? 'turned on' : 'turned off'} the ${actionData.target || 'lights'}.`;
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
  };
}

// Execute immediate Hue command
async function executeHueCommand(
  hueConfig: NonNullable<UserSettings['integrations']>['hue'],
  command: { target?: string; state?: string; brightness?: number; scene?: string }
): Promise<void> {
  if (!hueConfig?.accessToken) {
    throw new Error('Hue not connected');
  }

  // Get lights
  const lightsResponse = await fetch(
    'https://api.meethue.com/route/clip/v2/resource/light',
    {
      headers: {
        Authorization: `Bearer ${hueConfig.accessToken}`,
        'hue-application-key': hueConfig.username || '',
      },
    }
  );

  if (!lightsResponse.ok) {
    throw new Error('Failed to get lights');
  }

  const lightsData = await lightsResponse.json();
  const targetLower = (command.target || '').toLowerCase();

  // Find matching light
  const light = lightsData.data?.find((l: { metadata?: { name?: string } }) =>
    l.metadata?.name?.toLowerCase().includes(targetLower)
  );

  if (light) {
    const stateUpdate: Record<string, unknown> = {
      on: { on: command.state === 'on' },
    };

    if (command.brightness !== undefined) {
      stateUpdate.dimming = { brightness: command.brightness };
    }

    await fetch(
      `https://api.meethue.com/route/clip/v2/resource/light/${light.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${hueConfig.accessToken}`,
          'hue-application-key': hueConfig.username || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stateUpdate),
      }
    );
  }
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
    prompt += `\n## Philips Hue Integration (CONNECTED)
You can control the user's Philips Hue lights. Available actions:
- Turn lights on/off (say "turn on the [room/light name] lights" or "turn off the lights")
- Adjust brightness (say "dim the lights to 50%" or "set brightness to 80%")
- Change colors (for color-capable lights)
- Activate scenes (say "activate the [scene name] scene")

You can also CREATE SCHEDULES for the user. When they ask to schedule light actions:
- Extract the time (e.g., "7 AM", "sunset", "10:30 PM")
- Extract the action (turn on, turn off, dim, scene)
- Extract the target (which lights or rooms)
- Confirm the schedule with the user before creating it

When the user wants to schedule something, respond with a JSON action block like:
\`\`\`json
{"action": "create_schedule", "integration": "hue", "actionId": "turn-on", "time": "07:00", "schedule_type": "daily", "parameters": {"target": "bedroom", "brightness": 100}}
\`\`\`

Schedule types: "once", "daily", "weekly" (with daysOfWeek: [0-6] where 0=Sunday)
`;
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
