/**
 * VoicePipeline Interface
 *
 * Abstraction layer for Speech-to-Text (ASR) and Text-to-Speech (TTS) providers.
 * Designed for real-time, low-latency voice conversation.
 *
 * Design Principle: Modular and swappable.
 * STT: Deepgram (default), Web Speech API, Whisper, etc.
 * TTS: ElevenLabs (default), Google TTS, local TTS, etc.
 */

// ============================================
// SPEECH-TO-TEXT (ASR) INTERFACES
// ============================================

export interface ASRConfig {
  apiKey: string;
  language?: string;
  model?: string;
  sampleRate?: number;
  encoding?: 'linear16' | 'opus' | 'flac';
  punctuate?: boolean;
  interimResults?: boolean;
}

export interface ASRResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface ASRProvider {
  /**
   * Provider identifier
   */
  readonly providerId: string;

  /**
   * Human-readable provider name
   */
  readonly providerName: string;

  /**
   * Check if provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Start real-time speech recognition
   * Returns a stream of transcription results
   */
  startListening(config?: Partial<ASRConfig>): AsyncIterable<ASRResult>;

  /**
   * Stop listening
   */
  stopListening(): void;

  /**
   * Transcribe a complete audio buffer (non-streaming)
   */
  transcribeAudio(
    audioBuffer: ArrayBuffer,
    config?: Partial<ASRConfig>
  ): Promise<ASRResult>;
}

// ============================================
// TEXT-TO-SPEECH (TTS) INTERFACES
// ============================================

export interface TTSConfig {
  apiKey: string;
  voiceId: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  outputFormat?: 'mp3_44100_128' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
}

export interface TTSResult {
  audioBuffer: ArrayBuffer;
  duration?: number;
  format: string;
}

export interface TTSProvider {
  /**
   * Provider identifier
   */
  readonly providerId: string;

  /**
   * Human-readable provider name
   */
  readonly providerName: string;

  /**
   * Check if provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Validate API credentials and voice ID
   */
  validateCredentials(): Promise<{ valid: boolean; error?: string }>;

  /**
   * Convert text to speech (complete audio)
   */
  synthesize(text: string, config?: Partial<TTSConfig>): Promise<TTSResult>;

  /**
   * Stream audio as text is generated (for low-latency response)
   * Critical: Audio chunks are returned as they're synthesized
   */
  synthesizeStream(
    textStream: AsyncIterable<string>,
    config?: Partial<TTSConfig>
  ): AsyncIterable<ArrayBuffer>;

  /**
   * Get available voices for this provider
   */
  getVoices(): Promise<Array<{ id: string; name: string; preview_url?: string }>>;
}

// ============================================
// COMBINED VOICE PIPELINE
// ============================================

export interface VoicePipelineConfig {
  asr: {
    providerId: string;
    config: Partial<ASRConfig>;
  };
  tts: {
    providerId: string;
    config: Partial<TTSConfig>;
  };
}

/**
 * Combined voice pipeline for full duplex conversation
 */
export interface VoicePipeline {
  /**
   * ASR provider instance
   */
  readonly asr: ASRProvider;

  /**
   * TTS provider instance
   */
  readonly tts: TTSProvider;

  /**
   * Initialize the pipeline
   */
  initialize(): Promise<void>;

  /**
   * Start listening for user speech
   */
  startListening(): AsyncIterable<ASRResult>;

  /**
   * Stop listening
   */
  stopListening(): void;

  /**
   * Speak text (blocking until complete)
   */
  speak(text: string): Promise<void>;

  /**
   * Stream speech as text is generated
   */
  speakStream(textStream: AsyncIterable<string>): Promise<void>;

  /**
   * Get current pipeline state
   */
  getState(): VoicePipelineState;
}

export type VoicePipelineState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking';

/**
 * Supported ASR providers
 */
export const ASR_PROVIDERS = {
  DEEPGRAM: 'deepgram',
  WEB_SPEECH: 'web-speech-api',
  WHISPER: 'whisper', // Future: local Whisper
} as const;

/**
 * Supported TTS providers
 */
export const TTS_PROVIDERS = {
  ELEVENLABS: 'elevenlabs',
  GOOGLE: 'google-tts',
  LOCAL: 'local-tts', // Future: Piper, Coqui, etc.
} as const;

export type ASRProviderId = typeof ASR_PROVIDERS[keyof typeof ASR_PROVIDERS];
export type TTSProviderId = typeof TTS_PROVIDERS[keyof typeof TTS_PROVIDERS];
