/**
 * API Route: Generate Welcome Narrative TTS
 * POST /api/onboarding/welcome
 *
 * Generates TTS audio for the welcome narrative using ElevenLabs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Check for ElevenLabs API key
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'NNl6r8mD7vthiJatiJt1';

    if (!elevenLabsApiKey) {
      // Return null audioUrl to fallback to transcript-only mode
      return NextResponse.json({
        audioUrl: null,
        message: 'TTS not configured, using transcript mode',
      });
    }

    // Call ElevenLabs TTS API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error:', errorText);
      return NextResponse.json({
        audioUrl: null,
        message: 'TTS generation failed, using transcript mode',
      });
    }

    // Get audio data
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const audioUrl = `data:audio/mpeg;base64,${base64Audio}`;

    return NextResponse.json({ audioUrl });
  } catch (error) {
    console.error('Welcome TTS error:', error);
    return NextResponse.json({
      audioUrl: null,
      message: 'TTS error, using transcript mode',
    });
  }
}
