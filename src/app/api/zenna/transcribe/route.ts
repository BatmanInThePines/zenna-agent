import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication using NextAuth
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get audio data from request
    const formData = await request.formData();
    const audioFile = formData.get('audio') as Blob;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
    }

    // Convert blob to buffer
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    // Send to Deepgram for transcription
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

    if (!deepgramApiKey) {
      return NextResponse.json({ error: 'Deepgram not configured' }, { status: 500 });
    }

    const response = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBuffer,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Deepgram error:', errorText);
      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 });
    }

    const result = await response.json();
    const transcript =
      result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('Transcribe error:', error);
    return NextResponse.json({ error: 'Failed to transcribe audio' }, { status: 500 });
  }
}
