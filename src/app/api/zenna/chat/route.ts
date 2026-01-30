import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';
import { RoutineStore } from '@/core/providers/routines/routine-store';
import { INTEGRATION_MANIFESTS, getIntegrationContextSummary } from '@/core/interfaces/integration-manifest';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

export async function POST(request: NextRequest) {
  const identityStore = getIdentityStore();
  try {
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

    // Use a session-based ID for conversation history (generate from user ID + date)
    const sessionId = `${userId}-${new Date().toISOString().split('T')[0]}`;
    const storedHistory = await identityStore.getSessionHistory(sessionId, userId);

    // Build message history for LLM
    const systemPrompt = buildSystemPrompt(masterConfig, user.settings);
    const history: Message[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add stored conversation history
    for (const turn of storedHistory) {
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

    // Save user message to Supabase
    await identityStore.addSessionTurn(sessionId, userId, 'user', message);

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

    // Save assistant response to Supabase
    await identityStore.addSessionTurn(sessionId, userId, 'assistant', responseText);

    // Trim old history to keep session manageable (keep last 40 turns)
    await identityStore.trimSessionHistory(sessionId, userId, 40);

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

function buildSystemPrompt(
  masterConfig: Awaited<ReturnType<SupabaseIdentityStore['getMasterConfig']>>,
  userSettings: UserSettings
): string {
  let prompt = masterConfig.systemPrompt;

  // Add immutable rules
  if (masterConfig.immutableRules.length > 0) {
    prompt += `\n\nImmutable rules (never violate these):\n${masterConfig.immutableRules
      .map((r, i) => `${i + 1}. ${r}`)
      .join('\n')}`;
  }

  // Add guardrails
  if (masterConfig.guardrails.blockedTopics?.length) {
    prompt += `\n\nDo not discuss: ${masterConfig.guardrails.blockedTopics.join(', ')}`;
  }

  // Add connected integrations context
  const connectedIntegrations: string[] = [];

  if (userSettings.integrations?.hue?.accessToken) {
    connectedIntegrations.push('hue');
    prompt += `\n\n## Philips Hue Integration (CONNECTED)
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

Schedule types: "once", "daily", "weekly" (with daysOfWeek: [0-6] where 0=Sunday)`;
  }

  if (userSettings.externalContext?.notion?.token) {
    connectedIntegrations.push('notion');
    prompt += `\n\n## Notion Integration (CONNECTED)
The user has connected their Notion workspace. You have access to their knowledge base.
When they ask questions that might relate to their notes, you can reference this information.`;
  }

  if (connectedIntegrations.length > 0) {
    prompt += `\n\nConnected integrations: ${connectedIntegrations.join(', ')}`;
  }

  // Add user's personal prompt
  if (userSettings.personalPrompt) {
    prompt += `\n\nUser preferences:\n${userSettings.personalPrompt}`;
  }

  return prompt;
}
