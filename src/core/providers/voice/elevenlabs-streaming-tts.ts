/**
 * ElevenLabs Streaming TTS Provider
 *
 * Uses WebSocket API for low-latency, chunked audio streaming.
 * Optimized for real-time voice conversations with:
 * - Fast time-to-first-audio (~75-250ms)
 * - Sentence-level chunking for natural breaks
 * - Interruption support
 */

export interface StreamingTTSConfig {
  apiKey: string;
  voiceId: string;
  model?: 'eleven_turbo_v2_5' | 'eleven_flash_v2_5' | 'eleven_multilingual_v2';
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  outputFormat?: 'mp3_44100_128' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000';
}

export interface AudioChunk {
  audio: ArrayBuffer;
  isFinal: boolean;
  alignment?: {
    chars: string[];
    charStartTimesMs: number[];
    charDurationsMs: number[];
  };
}

export type StreamingTTSEventType =
  | 'audio'      // Audio chunk received
  | 'start'      // Generation started
  | 'end'        // Generation complete
  | 'error'      // Error occurred
  | 'interrupted'; // Stream was interrupted

export interface StreamingTTSEvent {
  type: StreamingTTSEventType;
  data?: AudioChunk;
  error?: Error;
}

type EventCallback = (event: StreamingTTSEvent) => void;

/**
 * ElevenLabs WebSocket Streaming TTS Provider
 *
 * Connects to ElevenLabs WebSocket API for real-time text-to-speech streaming.
 * Supports interruption, chunked input, and low-latency audio output.
 */
export class ElevenLabsStreamingTTSProvider {
  private config: Required<StreamingTTSConfig>;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isGenerating = false;
  private eventListeners: Map<StreamingTTSEventType, Set<EventCallback>> = new Map();
  private pendingText: string[] = [];
  private connectionPromise: Promise<void> | null = null;

  // WebSocket base URLs for different regions
  private static readonly WS_BASE_URL = 'wss://api.elevenlabs.io';

  constructor(config: StreamingTTSConfig) {
    this.config = {
      apiKey: config.apiKey,
      voiceId: config.voiceId,
      model: config.model || 'eleven_turbo_v2_5',
      stability: config.stability ?? 0.5,
      similarityBoost: config.similarityBoost ?? 0.75,
      style: config.style ?? 0,
      useSpeakerBoost: config.useSpeakerBoost ?? true,
      outputFormat: config.outputFormat || 'mp3_44100_128',
    };
  }

  /**
   * Add event listener for streaming events
   */
  on(event: StreamingTTSEventType, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove event listener
   */
  off(event: StreamingTTSEventType, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  /**
   * Emit event to listeners
   */
  private emit(event: StreamingTTSEvent): void {
    this.eventListeners.get(event.type)?.forEach(cb => {
      try {
        cb(event);
      } catch (e) {
        console.error('Event listener error:', e);
      }
    });
  }

  /**
   * Connect to ElevenLabs WebSocket API
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve, reject) => {
      const wsUrl = new URL(
        `/v1/text-to-speech/${this.config.voiceId}/stream-input`,
        ElevenLabsStreamingTTSProvider.WS_BASE_URL
      );

      // Add query parameters
      wsUrl.searchParams.set('model_id', this.config.model);
      wsUrl.searchParams.set('output_format', this.config.outputFormat);
      wsUrl.searchParams.set('auto_mode', 'true'); // Auto-trigger generation
      wsUrl.searchParams.set('inactivity_timeout', '20'); // Timeout in seconds

      this.ws = new WebSocket(wsUrl.toString(), [
        `xi-api-key.${this.config.apiKey}`
      ]);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.isConnected = true;

        // Send initial configuration
        const initMessage = {
          text: ' ', // Initial space to establish connection
          voice_settings: {
            stability: this.config.stability,
            similarity_boost: this.config.similarityBoost,
            style: this.config.style,
            use_speaker_boost: this.config.useSpeakerBoost,
          },
          generation_config: {
            // Aggressive chunk schedule for low latency
            // Start generating after fewer characters
            chunk_length_schedule: [50, 100, 150, 200],
          },
        };

        this.ws!.send(JSON.stringify(initMessage));
        this.connectionPromise = null;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const message = JSON.parse(event.data);

            if (message.audio) {
              // Decode base64 audio
              const binaryString = atob(message.audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              this.emit({
                type: 'audio',
                data: {
                  audio: bytes.buffer,
                  isFinal: false,
                  alignment: message.normalizedAlignment || message.alignment,
                },
              });
            }

            if (message.isFinal) {
              this.isGenerating = false;
              this.emit({ type: 'end' });
            }
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
          this.emit({ type: 'error', error: e as Error });
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        const wsError = new Error('WebSocket connection error');
        this.emit({ type: 'error', error: wsError });
        if (!this.isConnected) {
          this.connectionPromise = null;
          reject(wsError);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isGenerating = false;
        this.ws = null;
        this.connectionPromise = null;
      };
    });

    return this.connectionPromise;
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      // Send empty text to close gracefully
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ text: '' }));
      }
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isGenerating = false;
    this.pendingText = [];
  }

  /**
   * Send text chunk for synthesis
   * Text is buffered and sent in chunks for optimal latency
   */
  async sendText(text: string, flush = false): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    if (!this.isGenerating) {
      this.isGenerating = true;
      this.emit({ type: 'start' });
    }

    const message: Record<string, unknown> = {
      text: text,
      try_trigger_generation: true,
    };

    if (flush) {
      message.flush = true;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Flush any buffered text and generate audio
   */
  async flush(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      text: ' ',
      flush: true
    }));
  }

  /**
   * Interrupt current generation
   * Closes connection and clears pending audio
   */
  interrupt(): void {
    if (this.isGenerating) {
      this.emit({ type: 'interrupted' });
    }
    this.disconnect();
  }

  /**
   * Stream text from an async iterable (e.g., LLM streaming response)
   * Automatically chunks text at sentence boundaries for natural pauses
   */
  async streamText(textStream: AsyncIterable<string>): Promise<void> {
    await this.connect();

    let buffer = '';
    const sentenceEndRegex = /[.!?]\s+/g;

    for await (const chunk of textStream) {
      buffer += chunk;

      // Find sentence boundaries
      let lastIndex = 0;
      let match;

      while ((match = sentenceEndRegex.exec(buffer)) !== null) {
        const sentence = buffer.slice(lastIndex, match.index + 1);
        await this.sendText(sentence);
        lastIndex = match.index + match[0].length;
      }

      // Keep the incomplete sentence in buffer
      buffer = buffer.slice(lastIndex);
    }

    // Send any remaining text
    if (buffer.trim()) {
      await this.sendText(buffer, true);
    } else {
      await this.flush();
    }
  }

  /**
   * Synthesize complete text with streaming output
   * Returns async iterable of audio chunks
   */
  async *synthesizeStreaming(text: string): AsyncIterable<ArrayBuffer> {
    const audioChunks: ArrayBuffer[] = [];
    let resolveNext: ((value: ArrayBuffer | null) => void) | null = null;
    let isDone = false;

    const onAudio = (event: StreamingTTSEvent) => {
      if (event.type === 'audio' && event.data) {
        if (resolveNext) {
          resolveNext(event.data.audio);
          resolveNext = null;
        } else {
          audioChunks.push(event.data.audio);
        }
      }
    };

    const onEnd = () => {
      isDone = true;
      if (resolveNext) {
        resolveNext(null);
        resolveNext = null;
      }
    };

    this.on('audio', onAudio);
    this.on('end', onEnd);
    this.on('interrupted', onEnd);

    try {
      await this.connect();

      // Split text into sentences and send
      const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
      for (const sentence of sentences) {
        await this.sendText(sentence);
      }
      await this.flush();

      // Yield audio chunks as they arrive
      while (!isDone) {
        if (audioChunks.length > 0) {
          yield audioChunks.shift()!;
        } else {
          const chunk = await new Promise<ArrayBuffer | null>((resolve) => {
            resolveNext = resolve;
          });
          if (chunk) {
            yield chunk;
          }
        }
      }

      // Yield any remaining chunks
      while (audioChunks.length > 0) {
        yield audioChunks.shift()!;
      }
    } finally {
      this.off('audio', onAudio);
      this.off('end', onEnd);
      this.off('interrupted', onEnd);
    }
  }

  /**
   * Check if currently generating audio
   */
  get generating(): boolean {
    return this.isGenerating;
  }

  /**
   * Check if connected to WebSocket
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Sentence-level text chunker for optimal TTS streaming
 * Breaks text at natural boundaries while maintaining minimum chunk sizes
 */
export function chunkTextForTTS(
  text: string,
  options: {
    minChunkSize?: number;
    maxChunkSize?: number;
    preferredBreaks?: RegExp;
  } = {}
): string[] {
  const {
    minChunkSize = 50,
    maxChunkSize = 300,
    preferredBreaks = /[.!?]\s+|[,;:]\s+|\n+/g,
  } = options;

  const chunks: string[] = [];
  let currentChunk = '';

  // Split by preferred breaks
  const parts = text.split(preferredBreaks);
  const breaks = text.match(preferredBreaks) || [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const breakChar = breaks[i] || '';
    const segment = part + breakChar;

    if (currentChunk.length + segment.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = segment;
    } else {
      currentChunk += segment;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
