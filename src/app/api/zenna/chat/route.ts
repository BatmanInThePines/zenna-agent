import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { brainProviderFactory } from '@/core/providers/brain';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';
import type { Message } from '@/core/interfaces/brain-provider';
import type { UserSettings } from '@/core/interfaces/user-identity';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Get user and master config
    const [user, masterConfig] = await Promise.all([
      identityStore.getUser(payload.userId),
      identityStore.getMasterConfig(),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get conversation history from Supabase
    const sessionId = payload.sessionId;
    const storedHistory = await identityStore.getSessionHistory(sessionId, payload.userId);

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
    await identityStore.addSessionTurn(sessionId, payload.userId, 'user', message);

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

    // Save assistant response to Supabase
    await identityStore.addSessionTurn(sessionId, payload.userId, 'assistant', response.content);

    // Trim old history to keep session manageable (keep last 40 turns)
    await identityStore.trimSessionHistory(sessionId, payload.userId, 40);

    // Generate TTS audio
    let audioUrl: string | undefined;

    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
      try {
        const ttsProvider = new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY,
          voiceId: process.env.ELEVENLABS_VOICE_ID,
        });

        const result = await ttsProvider.synthesize(response.content);

        // Convert audio buffer to base64 data URL
        const base64 = Buffer.from(result.audioBuffer).toString('base64');
        audioUrl = `data:audio/mpeg;base64,${base64}`;
      } catch (error) {
        console.error('TTS error:', error);
        // Continue without audio
      }
    }

    // Analyze response tone/emotion for avatar color
    const emotion = analyzeEmotion(response.content);

    return NextResponse.json({
      response: response.content,
      audioUrl,
      emotion,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
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
  masterConfig: Awaited<ReturnType<typeof identityStore.getMasterConfig>>,
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

  // Add user's personal prompt
  if (userSettings.personalPrompt) {
    prompt += `\n\nUser preferences:\n${userSettings.personalPrompt}`;
  }

  return prompt;
}
