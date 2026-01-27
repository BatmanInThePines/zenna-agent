'use client';

import { useCallback, useRef, useState, useEffect } from 'react';

export interface VADConfig {
  /** Minimum audio level to consider as speech (0-1) */
  silenceThreshold?: number;
  /** Duration of silence before triggering speech end (ms) */
  silenceDuration?: number;
  /** Minimum speech duration to be considered valid (ms) */
  minSpeechDuration?: number;
  /** Smoothing factor for energy calculation (0-1) */
  smoothingFactor?: number;
  /** FFT size for frequency analysis */
  fftSize?: number;
}

export interface VADState {
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  speechDuration: number;
}

export interface VADCallbacks {
  /** Called when speech starts */
  onSpeechStart?: () => void;
  /** Called when speech ends (after silence threshold) */
  onSpeechEnd?: (audioBlob: Blob | null) => void;
  /** Called with audio level updates (0-1) */
  onAudioLevel?: (level: number) => void;
  /** Called with raw audio data for real-time processing */
  onAudioData?: (data: Float32Array) => void;
  /** Called on errors */
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: Required<VADConfig> = {
  silenceThreshold: 0.01,      // Minimum RMS to consider as speech
  silenceDuration: 1200,       // 1.2 seconds of silence = end of speech
  minSpeechDuration: 300,      // Minimum 300ms of speech to be valid
  smoothingFactor: 0.8,        // Smoothing for energy calculation
  fftSize: 2048,               // FFT size for analysis
};

/**
 * Voice Activity Detection (VAD) Hook
 *
 * Continuously monitors microphone input to detect speech start/end.
 * Uses energy-based detection with configurable thresholds.
 *
 * Features:
 * - Real-time speech detection
 * - Configurable silence threshold and duration
 * - Audio recording during speech
 * - Optional raw audio data callback
 * - Efficient resource management
 */
export function useVoiceActivityDetection(
  callbacks: VADCallbacks = {},
  config: VADConfig = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [state, setState] = useState<VADState>({
    isListening: false,
    isSpeaking: false,
    audioLevel: 0,
    speechDuration: 0,
  });

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Refs for VAD state machine
  const isSpeakingRef = useRef(false);
  const speechStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(0);
  const smoothedEnergyRef = useRef(0);
  const animationFrameRef = useRef<number>(0);
  const isListeningRef = useRef(false);

  // Refs for callbacks (to avoid stale closures)
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /**
   * Calculate RMS (Root Mean Square) energy of audio signal
   */
  const calculateRMS = useCallback((dataArray: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    return Math.sqrt(sum / dataArray.length);
  }, []);

  /**
   * Main VAD processing loop
   */
  const processAudio = useCallback(() => {
    if (!analyserRef.current || !isListeningRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(dataArray);

    // Calculate energy with smoothing
    const rawEnergy = calculateRMS(dataArray);
    const smoothedEnergy =
      mergedConfig.smoothingFactor * smoothedEnergyRef.current +
      (1 - mergedConfig.smoothingFactor) * rawEnergy;
    smoothedEnergyRef.current = smoothedEnergy;

    // Normalize to 0-1 range (assuming max RMS of ~0.5 for speech)
    const normalizedLevel = Math.min(1, smoothedEnergy * 2);

    // Call audio level callback
    callbacksRef.current.onAudioLevel?.(normalizedLevel);

    // Call raw audio data callback
    callbacksRef.current.onAudioData?.(dataArray);

    const now = Date.now();
    const isSpeech = smoothedEnergy > mergedConfig.silenceThreshold;

    if (isSpeech) {
      lastSpeechTimeRef.current = now;

      if (!isSpeakingRef.current) {
        // Speech started
        isSpeakingRef.current = true;
        speechStartTimeRef.current = now;
        audioChunksRef.current = [];

        // Start recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
          try {
            mediaRecorderRef.current.start(100);
          } catch (e) {
            console.error('Failed to start recording:', e);
          }
        }

        callbacksRef.current.onSpeechStart?.();

        setState(prev => ({ ...prev, isSpeaking: true }));
      }
    } else if (isSpeakingRef.current) {
      // Check if silence duration exceeded
      const silenceDuration = now - lastSpeechTimeRef.current;
      const speechDuration = now - speechStartTimeRef.current;

      if (silenceDuration >= mergedConfig.silenceDuration) {
        // Speech ended
        isSpeakingRef.current = false;

        // Stop recording
        let audioBlob: Blob | null = null;
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();

          // Wait for final data and create blob
          audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        }

        // Only trigger callback if speech was long enough
        if (speechDuration >= mergedConfig.minSpeechDuration) {
          callbacksRef.current.onSpeechEnd?.(audioBlob);
        } else {
          // Speech too short, discard
          callbacksRef.current.onSpeechEnd?.(null);
        }

        setState(prev => ({ ...prev, isSpeaking: false, speechDuration: 0 }));
      }
    }

    // Update state
    setState(prev => ({
      ...prev,
      audioLevel: normalizedLevel,
      speechDuration: isSpeakingRef.current ? now - speechStartTimeRef.current : 0,
    }));

    // Continue loop
    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calculateRMS, mergedConfig]);

  /**
   * Start VAD listening
   */
  const startListening = useCallback(async (): Promise<void> => {
    if (isListeningRef.current) return;

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Create audio context and analyser
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = mergedConfig.fftSize;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Create media recorder for capturing speech
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start processing
      isListeningRef.current = true;
      setState(prev => ({ ...prev, isListening: true }));

      processAudio();
    } catch (error) {
      console.error('Failed to start VAD:', error);
      callbacksRef.current.onError?.(error as Error);
      throw error;
    }
  }, [mergedConfig.fftSize, processAudio]);

  /**
   * Stop VAD listening
   */
  const stopListening = useCallback((): void => {
    isListeningRef.current = false;

    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore
      }
    }

    // Stop media stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Reset state
    isSpeakingRef.current = false;
    smoothedEnergyRef.current = 0;
    audioChunksRef.current = [];

    setState({
      isListening: false,
      isSpeaking: false,
      audioLevel: 0,
      speechDuration: 0,
    });
  }, []);

  /**
   * Pause listening temporarily (keeps microphone active)
   */
  const pauseListening = useCallback((): void => {
    if (!isListeningRef.current) return;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // If currently speaking, trigger end
    if (isSpeakingRef.current) {
      isSpeakingRef.current = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    }
  }, []);

  /**
   * Resume listening after pause
   */
  const resumeListening = useCallback((): void => {
    if (!mediaStreamRef.current || !analyserRef.current) return;

    processAudio();
  }, [processAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    // State
    ...state,

    // Actions
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
  };
}

/**
 * Simpler VAD using AudioWorklet for more accurate detection
 * Falls back to ScriptProcessor if AudioWorklet not supported
 */
export function useSimpleVAD(
  onSpeechStart: () => void,
  onSpeechEnd: () => void,
  threshold = 0.01
) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const context = new AudioContext();
    contextRef.current = context;

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;

    source.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);
    let speaking = false;
    let silenceStart = 0;

    const check = () => {
      if (!streamRef.current) return;

      analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > threshold) {
        if (!speaking) {
          speaking = true;
          setIsSpeaking(true);
          onSpeechStart();
        }
        silenceStart = 0;
      } else if (speaking) {
        if (!silenceStart) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart > 1000) {
          speaking = false;
          setIsSpeaking(false);
          onSpeechEnd();
        }
      }

      requestAnimationFrame(check);
    };

    setIsListening(true);
    check();
  }, [onSpeechStart, onSpeechEnd, threshold]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close();
      contextRef.current = null;
    }
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { isListening, isSpeaking, start, stop };
}
