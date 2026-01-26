/**
 * Voice Provider Factory
 *
 * Creates ASR and TTS provider instances.
 */

import type {
  ASRProvider,
  TTSProvider,
  ASRConfig,
  TTSConfig,
  VoicePipeline,
  VoicePipelineConfig,
  VoicePipelineState,
  ASRResult,
} from '../../interfaces/voice-pipeline';
import { DeepgramASRProvider } from './deepgram-asr';
import { ElevenLabsTTSProvider } from './elevenlabs-tts';

// ============================================
// ASR Factory
// ============================================

export function createASRProvider(
  providerId: string,
  config: Partial<ASRConfig>
): ASRProvider {
  switch (providerId) {
    case 'deepgram':
      return new DeepgramASRProvider(config as ASRConfig);

    case 'web-speech-api':
      // Future: Web Speech API implementation
      throw new Error('Web Speech API provider not yet implemented');

    case 'whisper':
      // Future: Local Whisper implementation
      throw new Error('Local Whisper provider not yet implemented');

    default:
      throw new Error(`Unknown ASR provider: ${providerId}`);
  }
}

// ============================================
// TTS Factory
// ============================================

export function createTTSProvider(
  providerId: string,
  config: Partial<TTSConfig>
): TTSProvider {
  switch (providerId) {
    case 'elevenlabs':
      return new ElevenLabsTTSProvider(config as TTSConfig);

    case 'google-tts':
      // Future: Google TTS implementation
      throw new Error('Google TTS provider not yet implemented');

    case 'local-tts':
      // Future: Piper/Coqui implementation
      throw new Error('Local TTS provider not yet implemented');

    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}

// ============================================
// Combined Voice Pipeline
// ============================================

export class DefaultVoicePipeline implements VoicePipeline {
  readonly asr: ASRProvider;
  readonly tts: TTSProvider;

  private state: VoicePipelineState = 'idle';
  private audioContext: AudioContext | null = null;

  constructor(config: VoicePipelineConfig) {
    this.asr = createASRProvider(config.asr.providerId, config.asr.config);
    this.tts = createTTSProvider(config.tts.providerId, config.tts.config);
  }

  async initialize(): Promise<void> {
    // Check providers are available
    const [asrAvailable, ttsAvailable] = await Promise.all([
      this.asr.isAvailable(),
      this.tts.isAvailable(),
    ]);

    if (!asrAvailable) {
      throw new Error('ASR provider not available');
    }

    if (!ttsAvailable) {
      throw new Error('TTS provider not available');
    }

    // Initialize audio context (browser only)
    if (typeof window !== 'undefined') {
      this.audioContext = new AudioContext();
    }
  }

  async *startListening(): AsyncIterable<ASRResult> {
    this.state = 'listening';

    try {
      for await (const result of this.asr.startListening()) {
        yield result;
      }
    } finally {
      this.state = 'idle';
    }
  }

  stopListening(): void {
    this.asr.stopListening();
    this.state = 'idle';
  }

  async speak(text: string): Promise<void> {
    this.state = 'speaking';

    try {
      const result = await this.tts.synthesize(text);
      await this.playAudio(result.audioBuffer);
    } finally {
      this.state = 'idle';
    }
  }

  async speakStream(textStream: AsyncIterable<string>): Promise<void> {
    this.state = 'speaking';

    try {
      for await (const audioChunk of this.tts.synthesizeStream(textStream)) {
        await this.playAudio(audioChunk);
      }
    } finally {
      this.state = 'idle';
    }
  }

  getState(): VoicePipelineState {
    return this.state;
  }

  private async playAudio(audioBuffer: ArrayBuffer): Promise<void> {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    const decodedAudio = await this.audioContext.decodeAudioData(audioBuffer.slice(0));
    const source = this.audioContext.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(this.audioContext.destination);

    return new Promise((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
  }
}

// ============================================
// Factory function
// ============================================

export function createVoicePipeline(config: VoicePipelineConfig): VoicePipeline {
  return new DefaultVoicePipeline(config);
}

// Re-export providers
export { DeepgramASRProvider } from './deepgram-asr';
export { ElevenLabsTTSProvider } from './elevenlabs-tts';
