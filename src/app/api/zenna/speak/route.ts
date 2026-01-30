import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { ElevenLabsTTSProvider } from '@/core/providers/voice/elevenlabs-tts';

/**
 * Speak endpoint - converts text to speech without LLM processing
 * Used for speaking pre-defined messages (e.g., integration education)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication using NextAuth
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Generate TTS audio
    let audioUrl: string | undefined;

    const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
    const hasElevenLabsVoice = !!process.env.ELEVENLABS_VOICE_ID;

    if (!hasElevenLabsKey || !hasElevenLabsVoice) {
      console.warn('TTS disabled - missing env vars:', {
        ELEVENLABS_API_KEY: hasElevenLabsKey ? 'set' : 'MISSING',
        ELEVENLABS_VOICE_ID: hasElevenLabsVoice ? 'set' : 'MISSING',
      });
    }

    if (hasElevenLabsKey && hasElevenLabsVoice) {
      try {
        console.log('Generating TTS audio for speak request...');
        const ttsProvider = new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY!,
          voiceId: process.env.ELEVENLABS_VOICE_ID!,
        });

        const result = await ttsProvider.synthesize(text);

        if (!result.audioBuffer || result.audioBuffer.byteLength === 0) {
          console.error('TTS returned empty audio buffer');
        } else {
          console.log(`TTS audio generated: ${result.audioBuffer.byteLength} bytes`);
          // Convert audio buffer to base64 data URL
          const base64 = Buffer.from(result.audioBuffer).toString('base64');
          audioUrl = `data:audio/mpeg;base64,${base64}`;
        }
      } catch (error) {
        console.error('TTS synthesis error:', error);
        // Continue without audio
      }
    }

    return NextResponse.json({
      audioUrl,
      success: true,
    });
  } catch (error) {
    console.error('Speak error:', error);
    return NextResponse.json({ error: 'Failed to generate speech' }, { status: 500 });
  }
}
