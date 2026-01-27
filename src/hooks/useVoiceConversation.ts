'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useAudioPlayer, type AudioPlayerState } from './useAudioPlayer';
import { useVoiceActivityDetection, type VADConfig } from './useVoiceActivityDetection';

export type ConversationState =
  | 'idle'           // Ready for input
  | 'listening'      // Actively listening to user speech
  | 'processing'     // Processing speech to text
  | 'thinking'       // LLM is generating response
  | 'speaking'       // Playing TTS audio
  | 'error';         // Error state

export interface VoiceConversationConfig {
  /** Enable always-listening mode */
  alwaysListening?: boolean;
  /** VAD configuration for always-listening mode */
  vadConfig?: VADConfig;
  /** Enable streaming text response */
  streamingText?: boolean;
  /** Enable streaming TTS audio */
  streamingAudio?: boolean;
  /** Auto-start listening after response completes */
  autoResumeListen?: boolean;
}

export interface VoiceConversationCallbacks {
  /** Called when conversation state changes */
  onStateChange?: (state: ConversationState) => void;
  /** Called when user speech is detected */
  onSpeechStart?: () => void;
  /** Called when user speech ends */
  onSpeechEnd?: () => void;
  /** Called with user's transcribed text */
  onTranscript?: (text: string) => void;
  /** Called with streaming text chunks from LLM */
  onTextChunk?: (chunk: string, fullText: string) => void;
  /** Called with complete response */
  onResponse?: (response: string, emotion?: string) => void;
  /** Called when TTS audio playback starts */
  onAudioStart?: () => void;
  /** Called when TTS audio playback ends */
  onAudioEnd?: () => void;
  /** Called when interrupted */
  onInterrupted?: () => void;
  /** Called on errors */
  onError?: (error: Error) => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * Voice Conversation Hook
 *
 * Provides a complete voice conversation experience with:
 * - Push-to-talk or always-listening modes
 * - Real-time speech-to-text
 * - Streaming LLM responses
 * - Streaming TTS playback
 * - Barge-in interruption support
 *
 * Usage:
 * ```tsx
 * const { state, startListening, stopListening, interrupt, transcript } = useVoiceConversation({
 *   onResponse: (response) => setMessages(prev => [...prev, { role: 'assistant', content: response }]),
 * });
 * ```
 */
export function useVoiceConversation(
  callbacks: VoiceConversationCallbacks = {},
  config: VoiceConversationConfig = {}
) {
  const [state, setState] = useState<ConversationState>('idle');
  const [transcript, setTranscript] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs for async state
  const stateRef = useRef<ConversationState>('idle');
  const callbacksRef = useRef(callbacks);
  const configRef = useRef(config);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Update refs
  callbacksRef.current = callbacks;
  configRef.current = config;

  // Audio player for TTS playback
  const audioPlayer = useAudioPlayer({
    onStateChange: (audioState: AudioPlayerState) => {
      if (audioState === 'playing' && stateRef.current === 'speaking') {
        callbacksRef.current.onAudioStart?.();
      }
    },
    onPlaybackEnd: () => {
      if (stateRef.current === 'speaking') {
        updateState('idle');
        callbacksRef.current.onAudioEnd?.();

        // Auto-resume listening if enabled
        if (configRef.current.alwaysListening || configRef.current.autoResumeListen) {
          startListening();
        }
      }
    },
    onError: (error) => {
      console.error('Audio playback error:', error);
      updateState('error');
    },
  });

  // Update state with notifications
  const updateState = useCallback((newState: ConversationState) => {
    stateRef.current = newState;
    setState(newState);
    callbacksRef.current.onStateChange?.(newState);
  }, []);

  // Interrupt current activity (speaking, processing, etc.)
  const interrupt = useCallback(() => {
    // Cancel any ongoing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop audio playback
    audioPlayer.interrupt();

    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Clear streaming state
    setStreamingText('');
    setTranscript('');

    callbacksRef.current.onInterrupted?.();
    updateState('idle');
  }, [audioPlayer, updateState]);

  // VAD for always-listening mode
  const vad = useVoiceActivityDetection(
    {
      onSpeechStart: () => {
        if (configRef.current.alwaysListening) {
          // User started speaking - interrupt any ongoing response if speaking
          if (stateRef.current === 'speaking') {
            interrupt();
          }
          if (stateRef.current === 'idle' || stateRef.current === 'speaking') {
            updateState('listening');
            callbacksRef.current.onSpeechStart?.();
          }
        }
      },
      onSpeechEnd: async (audioBlob) => {
        if (configRef.current.alwaysListening && audioBlob && stateRef.current === 'listening') {
          callbacksRef.current.onSpeechEnd?.();
          await processAudio(audioBlob);
        }
      },
      onAudioLevel: (level) => {
        setAudioLevel(level);
      },
      onError: (error) => {
        console.error('VAD error:', error);
        updateState('error');
        callbacksRef.current.onError?.(error);
      },
    },
    config.vadConfig
  );

  // Process recorded audio (transcribe and get response)
  const processAudio = useCallback(async (audioBlob: Blob) => {
    updateState('processing');
    setTranscript('Transcribing...');

    try {
      // Transcribe audio
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const transcribeResponse = await fetch('/api/zenna/transcribe', {
        method: 'POST',
        body: formData,
      });

      const transcribeData = await transcribeResponse.json();

      if (!transcribeData.transcript || !transcribeData.transcript.trim()) {
        setTranscript('');
        updateState('idle');
        return;
      }

      const userText = transcribeData.transcript.trim();
      setTranscript(userText);
      callbacksRef.current.onTranscript?.(userText);

      // Get response
      await getResponse(userText);
    } catch (error) {
      console.error('Processing error:', error);
      updateState('error');
      callbacksRef.current.onError?.(error as Error);
    }
  }, [updateState]);

  // Get response from LLM and play TTS
  const getResponse = useCallback(async (text: string) => {
    updateState('thinking');
    setStreamingText('');

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      if (configRef.current.streamingText) {
        // Use streaming endpoint for real-time text
        const response = await fetch('/api/zenna/chat-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: abortControllerRef.current.signal,
        });

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let emotion: string | undefined;

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'text') {
                  fullText += data.content;
                  setStreamingText(fullText);
                  callbacksRef.current.onTextChunk?.(data.content, fullText);
                } else if (data.type === 'complete') {
                  fullText = data.fullResponse;
                  emotion = data.emotion;
                } else if (data.type === 'error') {
                  throw new Error(data.error);
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

        // Play TTS for the response
        if (fullText && stateRef.current !== 'idle') {
          updateState('speaking');
          callbacksRef.current.onResponse?.(fullText, emotion);
          await playTTS(fullText);
        }
      } else {
        // Use standard chat endpoint
        const response = await fetch('/api/zenna/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: abortControllerRef.current.signal,
        });

        const data = await response.json();

        if (data.response) {
          setStreamingText(data.response);
          callbacksRef.current.onResponse?.(data.response, data.emotion);

          if (data.audioUrl) {
            updateState('speaking');
            await audioPlayer.playUrl(data.audioUrl);
          } else {
            updateState('idle');
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      console.error('Response error:', error);
      updateState('error');
      callbacksRef.current.onError?.(error as Error);
    }
  }, [updateState, audioPlayer]);

  // Play TTS audio with streaming support
  const playTTS = useCallback(async (text: string) => {
    try {
      // Use streaming TTS endpoint
      const response = await fetch('/api/zenna/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('TTS request failed');
      }

      // Get audio as array buffer and play
      const arrayBuffer = await response.arrayBuffer();
      await audioPlayer.playBuffer(arrayBuffer);
    } catch (error) {
      console.error('TTS error:', error);
      // Fall back to non-streaming
      const response = await fetch('/api/zenna/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();
      if (data.audioUrl) {
        await audioPlayer.playUrl(data.audioUrl);
      } else {
        updateState('idle');
      }
    }
  }, [audioPlayer, updateState]);

  // Start listening (manual or push-to-talk)
  const startListening = useCallback(async () => {
    if (stateRef.current === 'speaking') {
      // Barge-in: interrupt current speech
      interrupt();
    }

    if (configRef.current.alwaysListening) {
      // Use VAD for always-listening mode
      await vad.startListening();
      updateState('listening');
    } else {
      // Manual recording mode
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        updateState('listening');
        callbacksRef.current.onSpeechStart?.();
        audioChunksRef.current = [];

        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          callbacksRef.current.onSpeechEnd?.();

          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          await processAudio(audioBlob);
        };

        mediaRecorder.start(100);
      } catch (error) {
        console.error('Microphone error:', error);
        updateState('error');
        callbacksRef.current.onError?.(error as Error);
      }
    }
  }, [interrupt, vad, processAudio, updateState]);

  // Stop listening (for push-to-talk mode)
  const stopListening = useCallback(() => {
    if (configRef.current.alwaysListening) {
      vad.stopListening();
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, [vad]);

  // Toggle always-listening mode
  const setAlwaysListening = useCallback((enabled: boolean) => {
    configRef.current = { ...configRef.current, alwaysListening: enabled };

    if (enabled && stateRef.current === 'idle') {
      vad.startListening();
    } else if (!enabled) {
      vad.stopListening();
    }
  }, [vad]);

  // Send text message directly (bypass speech)
  const sendMessage = useCallback(async (text: string) => {
    if (stateRef.current === 'speaking') {
      interrupt();
    }

    setTranscript(text);
    callbacksRef.current.onTranscript?.(text);
    await getResponse(text);
  }, [interrupt, getResponse]);

  // Initialize audio context on first interaction
  const initialize = useCallback(async () => {
    await audioPlayer.initializeAudioContext();
  }, [audioPlayer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      interrupt();
      vad.stopListening();
    };
  }, [interrupt, vad]);

  return {
    // State
    state,
    transcript,
    streamingText,
    audioLevel,
    isListening: state === 'listening',
    isSpeaking: state === 'speaking',
    isThinking: state === 'thinking',

    // Actions
    startListening,
    stopListening,
    interrupt,
    sendMessage,
    setAlwaysListening,
    initialize,

    // VAD state (for always-listening mode)
    vadState: {
      isListening: vad.isListening,
      isSpeaking: vad.isSpeaking,
      audioLevel: vad.audioLevel,
    },
  };
}
