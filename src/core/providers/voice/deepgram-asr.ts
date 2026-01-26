/**
 * Deepgram ASR Provider
 *
 * Real-time speech-to-text using Deepgram's low-latency API.
 * Supports streaming transcription for voice-first conversation.
 */

import type {
  ASRProvider,
  ASRConfig,
  ASRResult,
} from '../../interfaces/voice-pipeline';

type DeepgramModel = 'nova-2' | 'nova' | 'enhanced' | 'base';

interface DeepgramConfig extends ASRConfig {
  model?: string;
  tier?: 'nova' | 'enhanced' | 'base';
}

export class DeepgramASRProvider implements ASRProvider {
  readonly providerId = 'deepgram';
  readonly providerName = 'Deepgram';

  private config: DeepgramConfig;
  private websocket: WebSocket | null = null;
  private isListening = false;

  constructor(config: ASRConfig) {
    this.config = {
      ...config,
      model: (config.model as DeepgramModel) || 'nova-2',
      language: config.language || 'en-US',
      punctuate: config.punctuate ?? true,
      interimResults: config.interimResults ?? true,
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }

  async *startListening(config?: Partial<ASRConfig>): AsyncIterable<ASRResult> {
    if (this.isListening) {
      throw new Error('Already listening');
    }

    const mergedConfig = { ...this.config, ...config };
    this.isListening = true;

    // Build query params for Deepgram streaming API
    const params = new URLSearchParams({
      model: mergedConfig.model || 'nova-2',
      language: mergedConfig.language || 'en-US',
      punctuate: String(mergedConfig.punctuate ?? true),
      interim_results: String(mergedConfig.interimResults ?? true),
      encoding: mergedConfig.encoding || 'linear16',
      sample_rate: String(mergedConfig.sampleRate || 16000),
    });

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    // Create WebSocket connection
    const ws = new WebSocket(wsUrl, ['token', this.config.apiKey!]);
    this.websocket = ws;

    // Create a queue for results
    const resultQueue: ASRResult[] = [];
    let resolveNext: ((result: ASRResult | null) => void) | null = null;
    let done = false;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
          const alt = data.channel.alternatives[0];
          const result: ASRResult = {
            transcript: alt.transcript,
            isFinal: data.is_final ?? false,
            confidence: alt.confidence,
            words: alt.words?.map((w: { word: string; start: number; end: number; confidence: number }) => ({
              word: w.word,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
            })),
          };

          if (resolveNext) {
            resolveNext(result);
            resolveNext = null;
          } else {
            resultQueue.push(result);
          }
        }
      } catch {
        console.error('Error parsing Deepgram message');
      }
    };

    ws.onerror = () => {
      done = true;
      if (resolveNext) {
        resolveNext(null);
      }
    };

    ws.onclose = () => {
      done = true;
      this.isListening = false;
      if (resolveNext) {
        resolveNext(null);
      }
    };

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    // Yield results as they come in
    while (!done) {
      if (resultQueue.length > 0) {
        yield resultQueue.shift()!;
      } else {
        const result = await new Promise<ASRResult | null>((resolve) => {
          resolveNext = resolve;
        });
        if (result === null) break;
        yield result;
      }
    }
  }

  stopListening(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.isListening = false;
  }

  async transcribeAudio(
    audioBuffer: ArrayBuffer,
    config?: Partial<ASRConfig>
  ): Promise<ASRResult> {
    const mergedConfig = { ...this.config, ...config };

    const params = new URLSearchParams({
      model: mergedConfig.model || 'nova-2',
      language: mergedConfig.language || 'en-US',
      punctuate: String(mergedConfig.punctuate ?? true),
    });

    const response = await fetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': 'audio/wav',
        },
        body: audioBuffer,
      }
    );

    if (!response.ok) {
      throw new Error(`Deepgram transcription failed: ${response.statusText}`);
    }

    const data = await response.json();
    const alt = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      transcript: alt?.transcript || '',
      isFinal: true,
      confidence: alt?.confidence,
      words: alt?.words,
    };
  }

  /**
   * Send audio data to the WebSocket for streaming transcription
   */
  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(audioData);
    }
  }
}
