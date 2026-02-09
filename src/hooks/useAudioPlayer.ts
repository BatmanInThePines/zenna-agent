'use client';

import { useCallback, useRef, useState, useEffect } from 'react';

export type AudioPlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface AudioPlayerOptions {
  onStateChange?: (state: AudioPlayerState) => void;
  onPlaybackEnd?: () => void;
  onError?: (error: Error) => void;
  onChunkPlayed?: (chunkIndex: number) => void;
}

interface AudioChunkInfo {
  buffer: AudioBuffer;
  source?: AudioBufferSourceNode;
  startTime: number;
  duration: number;
}

// --- iOS Audio Ducking Helpers ---

/** Detect iOS Safari (iPad, iPhone, iPod) */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * iOS audio ducking volume boost factor.
 * iOS Safari reduces audio volume ~40-50% when it detects mic activity.
 * We compensate by boosting gain on the output node.
 */
const IOS_DUCKING_GAIN_BOOST = 1.8;

/**
 * Reset the AudioContext to clear iOS ducking state.
 * iOS Safari remembers ducking even after mic is released — creating a fresh
 * AudioContext clears the internal flag.
 */
export async function resetAudioContextForDucking(
  currentCtx: AudioContext | null
): Promise<AudioContext> {
  // Close the old context to release the ducked session
  if (currentCtx && currentCtx.state !== 'closed') {
    try { await currentCtx.close(); } catch { /* ignore */ }
  }
  // Create a fresh context — iOS won't duck this one until mic is re-opened
  const newCtx = new AudioContext();
  if (newCtx.state === 'suspended') {
    await newCtx.resume();
  }
  return newCtx;
}

/**
 * Audio player hook for streaming audio playback with interruption support
 *
 * Features:
 * - Queue-based streaming playback (no gaps between chunks)
 * - Instant interruption capability
 * - Web Audio API for low-latency playback
 * - Automatic audio context management
 */
export function useAudioPlayer(options: AudioPlayerOptions = {}) {
  const [state, setState] = useState<AudioPlayerState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<AudioChunkInfo[]>([]);
  const currentChunkIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const startTimeRef = useRef(0);
  const scheduledEndTimeRef = useRef(0);
  const animationFrameRef = useRef<number>(0);
  const pendingBuffersRef = useRef<ArrayBuffer[]>([]);
  const isProcessingRef = useRef(false);

  // Initialize audio context (must be called after user interaction)
  const initializeAudioContext = useCallback(async () => {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      return audioContextRef.current;
    }

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    // Create gain node for volume control
    const gainNode = ctx.createGain();
    // On iOS, boost gain to counteract audio ducking
    if (isIOS()) {
      gainNode.gain.value = IOS_DUCKING_GAIN_BOOST;
      console.log('[iOS Audio] Applied ducking compensation gain:', IOS_DUCKING_GAIN_BOOST);
    }
    gainNode.connect(ctx.destination);
    gainNodeRef.current = gainNode;

    return ctx;
  }, []);

  // Update current time during playback
  useEffect(() => {
    const updateTime = () => {
      if (isPlayingRef.current && audioContextRef.current) {
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        setCurrentTime(Math.max(0, elapsed));
        animationFrameRef.current = requestAnimationFrame(updateTime);
      }
    };

    if (state === 'playing') {
      animationFrameRef.current = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state]);

  // Update state and notify listeners
  const updateState = useCallback((newState: AudioPlayerState) => {
    setState(newState);
    options.onStateChange?.(newState);
  }, [options]);

  // Decode audio buffer
  const decodeAudio = useCallback(async (arrayBuffer: ArrayBuffer): Promise<AudioBuffer> => {
    const ctx = await initializeAudioContext();
    // Clone the buffer since decodeAudioData detaches it
    const clonedBuffer = arrayBuffer.slice(0);
    return ctx.decodeAudioData(clonedBuffer);
  }, [initializeAudioContext]);

  // Schedule a chunk to play at a specific time
  const scheduleChunk = useCallback((chunk: AudioChunkInfo, startAt: number) => {
    if (!audioContextRef.current || !gainNodeRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = chunk.buffer;
    source.connect(gainNodeRef.current);

    source.onended = () => {
      currentChunkIndexRef.current++;
      options.onChunkPlayed?.(currentChunkIndexRef.current - 1);

      // Check if this was the last chunk
      if (currentChunkIndexRef.current >= chunksRef.current.length && !isProcessingRef.current) {
        // All chunks played
        isPlayingRef.current = false;
        updateState('idle');
        options.onPlaybackEnd?.();
      }
    };

    source.start(startAt);
    chunk.source = source;
    chunk.startTime = startAt;

    return startAt + chunk.duration;
  }, [options, updateState]);

  // Process pending audio buffers
  const processPendingBuffers = useCallback(async () => {
    if (isProcessingRef.current || pendingBuffersRef.current.length === 0) return;

    isProcessingRef.current = true;

    while (pendingBuffersRef.current.length > 0) {
      const arrayBuffer = pendingBuffersRef.current.shift()!;

      try {
        const audioBuffer = await decodeAudio(arrayBuffer);

        const chunkInfo: AudioChunkInfo = {
          buffer: audioBuffer,
          startTime: 0,
          duration: audioBuffer.duration,
        };

        chunksRef.current.push(chunkInfo);

        // Update total duration
        const totalDuration = chunksRef.current.reduce((sum, c) => sum + c.duration, 0);
        setDuration(totalDuration);

        // If playing, schedule this chunk
        if (isPlayingRef.current && audioContextRef.current) {
          const scheduleAt = Math.max(
            scheduledEndTimeRef.current,
            audioContextRef.current.currentTime
          );
          scheduledEndTimeRef.current = scheduleChunk(chunkInfo, scheduleAt) || scheduleAt;
        }
      } catch (error) {
        console.error('Failed to decode audio chunk:', error);
      }
    }

    isProcessingRef.current = false;
  }, [decodeAudio, scheduleChunk]);

  // Add audio chunk to queue
  const addChunk = useCallback((arrayBuffer: ArrayBuffer) => {
    pendingBuffersRef.current.push(arrayBuffer);
    processPendingBuffers();
  }, [processPendingBuffers]);

  // Start playback from queue
  const play = useCallback(async () => {
    if (isPlayingRef.current) return;

    try {
      const ctx = await initializeAudioContext();

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      isPlayingRef.current = true;
      startTimeRef.current = ctx.currentTime;
      scheduledEndTimeRef.current = ctx.currentTime;
      currentChunkIndexRef.current = 0;

      updateState('playing');

      // Schedule all existing chunks
      for (const chunk of chunksRef.current) {
        scheduledEndTimeRef.current = scheduleChunk(chunk, scheduledEndTimeRef.current) || scheduledEndTimeRef.current;
      }

      // Process any pending buffers
      await processPendingBuffers();
    } catch (error) {
      console.error('Playback error:', error);
      updateState('error');
      options.onError?.(error as Error);
    }
  }, [initializeAudioContext, processPendingBuffers, scheduleChunk, updateState, options]);

  // Stop and clear all audio
  const stop = useCallback(() => {
    // Stop all scheduled sources
    for (const chunk of chunksRef.current) {
      if (chunk.source) {
        try {
          chunk.source.stop();
          chunk.source.disconnect();
        } catch {
          // Ignore errors from already stopped sources
        }
      }
    }

    // Clear state
    chunksRef.current = [];
    pendingBuffersRef.current = [];
    currentChunkIndexRef.current = 0;
    isPlayingRef.current = false;
    isProcessingRef.current = false;
    scheduledEndTimeRef.current = 0;
    setCurrentTime(0);
    setDuration(0);

    updateState('idle');
  }, [updateState]);

  // Interrupt playback immediately
  const interrupt = useCallback(() => {
    stop();
  }, [stop]);

  // Pause playback (note: Web Audio API doesn't support true pause, so we stop)
  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;

    // Stop all sources
    for (const chunk of chunksRef.current) {
      if (chunk.source) {
        try {
          chunk.source.stop();
        } catch {
          // Ignore
        }
      }
    }

    isPlayingRef.current = false;
    updateState('paused');
  }, [updateState]);

  // Play a complete audio URL (data URL or blob URL)
  const playUrl = useCallback(async (url: string) => {
    stop();
    updateState('loading');

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();

      addChunk(arrayBuffer);
      await play();
    } catch (error) {
      console.error('Failed to load audio:', error);
      updateState('error');
      options.onError?.(error as Error);
    }
  }, [stop, updateState, addChunk, play, options]);

  // Play a complete ArrayBuffer
  const playBuffer = useCallback(async (arrayBuffer: ArrayBuffer) => {
    stop();
    addChunk(arrayBuffer);
    await play();
  }, [stop, addChunk, play]);

  // Set volume (0-1, automatically scaled for iOS ducking compensation)
  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      const clamped = Math.max(0, Math.min(1, volume));
      // On iOS, scale the requested volume by the ducking boost factor
      gainNodeRef.current.gain.value = isIOS() ? clamped * IOS_DUCKING_GAIN_BOOST : clamped;
    }
  }, []);

  // Reset AudioContext to clear iOS audio ducking state.
  // Call this after microphone usage ends, before playing TTS audio.
  const resetForIOSDucking = useCallback(async () => {
    if (!isIOS()) return;

    console.log('[iOS Audio] Resetting AudioContext to clear ducking state');
    const newCtx = await resetAudioContextForDucking(audioContextRef.current);
    audioContextRef.current = newCtx;

    // Recreate gain node on the new context with boost
    const gainNode = newCtx.createGain();
    gainNode.gain.value = IOS_DUCKING_GAIN_BOOST;
    gainNode.connect(newCtx.destination);
    gainNodeRef.current = gainNode;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stop]);

  return {
    // State
    state,
    currentTime,
    duration,
    isPlaying: isPlayingRef.current,

    // Actions
    play,
    pause,
    stop,
    interrupt,
    addChunk,
    playUrl,
    playBuffer,
    setVolume,
    initializeAudioContext,
    resetForIOSDucking,
  };
}

/**
 * Simple audio player for single audio files
 * Lighter weight alternative when streaming isn't needed
 */
export function useSimpleAudioPlayer(options: AudioPlayerOptions = {}) {
  const [state, setState] = useState<AudioPlayerState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const updateState = useCallback((newState: AudioPlayerState) => {
    setState(newState);
    options.onStateChange?.(newState);
  }, [options]);

  const play = useCallback(async (url: string) => {
    // Stop any existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    updateState('loading');

    const audio = new Audio(url);
    // iOS ducking compensation: boost volume on HTML5 audio elements
    if (isIOS()) {
      audio.volume = Math.min(1.0, 0.95); // Max out volume on iOS
    }
    audioRef.current = audio;

    audio.oncanplaythrough = () => {
      updateState('playing');
    };

    audio.onended = () => {
      updateState('idle');
      options.onPlaybackEnd?.();
    };

    audio.onerror = () => {
      updateState('error');
      options.onError?.(new Error('Audio playback failed'));
    };

    try {
      await audio.play();
    } catch (error) {
      updateState('error');
      options.onError?.(error as Error);
    }
  }, [updateState, options]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    updateState('idle');
  }, [updateState]);

  const interrupt = useCallback(() => {
    stop();
  }, [stop]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  return {
    state,
    play,
    stop,
    interrupt,
  };
}
