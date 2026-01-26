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

    return NextResponse.json({
      response: response.content,
      audioUrl,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
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
