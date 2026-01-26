/**
 * ElevenLabs TTS Provider
 *
 * High-quality text-to-speech using ElevenLabs.
 * Supports streaming synthesis for low-latency voice response.
 */

import type {
  TTSProvider,
  TTSConfig,
  TTSResult,
} from '../../interfaces/voice-pipeline';

type ElevenLabsModel = 'eleven_turbo_v2_5' | 'eleven_turbo_v2' | 'eleven_multilingual_v2' | 'eleven_monolingual_v1';

interface ElevenLabsConfig extends TTSConfig {
  model?: string;
}

export class ElevenLabsTTSProvider implements TTSProvider {
  readonly providerId = 'elevenlabs';
  readonly providerName = 'ElevenLabs';

  private config: ElevenLabsConfig;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(config: TTSConfig) {
    this.config = {
      ...config,
      model: (config.model as ElevenLabsModel) || 'eleven_turbo_v2_5',
      stability: config.stability ?? 0.5,
      similarityBoost: config.similarityBoost ?? 0.75,
      style: config.style ?? 0,
      useSpeakerBoost: config.useSpeakerBoost ?? true,
      outputFormat: config.outputFormat || 'mp3_44100_128',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey && !!this.config.voiceId;
  }

  async validateCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.config.apiKey) {
      return { valid: false, error: 'API key not configured' };
    }

    if (!this.config.voiceId) {
      return { valid: false, error: 'Voice ID not configured' };
    }

    try {
      // Validate by fetching voice info
      const response = await fetch(
        `${this.baseUrl}/voices/${this.config.voiceId}`,
        {
          headers: {
            'xi-api-key': this.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          return { valid: false, error: 'Invalid API key' };
        }
        if (response.status === 404) {
          return { valid: false, error: 'Voice ID not found' };
        }
        return { valid: false, error: `API error: ${response.statusText}` };
      }

      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async synthesize(text: string, config?: Partial<TTSConfig>): Promise<TTSResult> {
    const mergedConfig = { ...this.config, ...config };

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${mergedConfig.voiceId}?output_format=${mergedConfig.outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': mergedConfig.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: mergedConfig.model,
          voice_settings: {
            stability: mergedConfig.stability,
            similarity_boost: mergedConfig.similarityBoost,
            style: mergedConfig.style,
            use_speaker_boost: mergedConfig.useSpeakerBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs synthesis failed: ${response.statusText}`);
    }

    const audioBuffer = await response.arrayBuffer();

    return {
      audioBuffer,
      format: mergedConfig.outputFormat || 'mp3_44100_128',
    };
  }

  async *synthesizeStream(
    textStream: AsyncIterable<string>,
    config?: Partial<TTSConfig>
  ): AsyncIterable<ArrayBuffer> {
    const mergedConfig = { ...this.config, ...config };

    // Collect text chunks and synthesize in batches for streaming
    // ElevenLabs streaming API expects continuous text input

    let textBuffer = '';
    const minChunkSize = 50; // Minimum characters before synthesizing

    for await (const chunk of textStream) {
      textBuffer += chunk;

      // When we have enough text, synthesize and yield audio
      if (textBuffer.length >= minChunkSize) {
        const result = await this.synthesize(textBuffer, mergedConfig);
        yield result.audioBuffer;
        textBuffer = '';
      }
    }

    // Synthesize any remaining text
    if (textBuffer.trim().length > 0) {
      const result = await this.synthesize(textBuffer, mergedConfig);
      yield result.audioBuffer;
    }
  }

  /**
   * Stream synthesis using ElevenLabs streaming endpoint
   * More efficient for real-time voice output
   */
  async synthesizeStreamDirect(
    text: string,
    config?: Partial<TTSConfig>
  ): Promise<ReadableStream<Uint8Array>> {
    const mergedConfig = { ...this.config, ...config };

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${mergedConfig.voiceId}/stream?output_format=${mergedConfig.outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': mergedConfig.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: mergedConfig.model,
          voice_settings: {
            stability: mergedConfig.stability,
            similarity_boost: mergedConfig.similarityBoost,
            style: mergedConfig.style,
            use_speaker_boost: mergedConfig.useSpeakerBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs stream synthesis failed: ${response.statusText}`);
    }

    return response.body!;
  }

  async getVoices(): Promise<Array<{ id: string; name: string; preview_url?: string }>> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.config.apiKey!,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }

    const data = await response.json();

    return data.voices.map((voice: { voice_id: string; name: string; preview_url?: string }) => ({
      id: voice.voice_id,
      name: voice.name,
      preview_url: voice.preview_url,
    }));
  }
}
