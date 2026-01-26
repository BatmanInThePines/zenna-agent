import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

export async function POST() {
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

    // Get master config for greeting
    const masterConfig = await identityStore.getMasterConfig();
    const greeting = masterConfig.greeting || 'Welcome. How may I assist?';

    // Generate TTS audio for greeting
    let audioUrl: string | undefined;

    if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
      try {
        const ttsProvider = new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY,
          voiceId: process.env.ELEVENLABS_VOICE_ID,
        });

        const result = await ttsProvider.synthesize(greeting);

        // Convert audio buffer to base64 data URL
        const base64 = Buffer.from(result.audioBuffer).toString('base64');
        audioUrl = `data:audio/mpeg;base64,${base64}`;
      } catch (error) {
        console.error('TTS error:', error);
        // Continue without audio
      }
    }

    return NextResponse.json({
      greeting,
      audioUrl,
      emotion: 'helpful', // Default greeting emotion
    });
  } catch (error) {
    console.error('Greet error:', error);
    return NextResponse.json({ error: 'Failed to generate greeting' }, { status: 500 });
  }
}
