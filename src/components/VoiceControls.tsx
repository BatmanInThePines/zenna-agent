'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface VoiceControlsProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  audioLevel?: number;
  alwaysListening: boolean;
  onMicClick: () => void;
  onStopSpeaking: () => void;
  onInterrupt?: () => void;
  onToggleAlwaysListening: (enabled: boolean) => void;
  currentTranscript?: string;
  disabled?: boolean;
  thinkingStatus?: string;
  thinkingElapsed?: number;
}

// Smooth audio level history for waveform animation
const LEVEL_HISTORY_SIZE = 20;

/**
 * Voice Controls Component
 *
 * Provides:
 * - Push-to-talk microphone button
 * - Stop speaking button (interrupt TTS)
 * - Always-listening mode toggle
 * - Audio level visualization
 * - State indicators
 */
export default function VoiceControls({
  state,
  audioLevel = 0,
  alwaysListening,
  onMicClick,
  onStopSpeaking,
  onInterrupt,
  onToggleAlwaysListening,
  currentTranscript,
  disabled = false,
  thinkingStatus,
  thinkingElapsed = 0,
}: VoiceControlsProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [levelHistory, setLevelHistory] = useState<number[]>(new Array(LEVEL_HISTORY_SIZE).fill(0));
  const animationFrameRef = useRef<number | null>(null);

  // Smooth audio level tracking for waveform
  useEffect(() => {
    if (state === 'listening') {
      setLevelHistory(prev => {
        const newHistory = [...prev.slice(1), audioLevel];
        return newHistory;
      });
    } else {
      // Gradually fade out when not listening
      setLevelHistory(prev => {
        const decayedHistory = prev.map(l => l * 0.85);
        return decayedHistory;
      });
    }
  }, [audioLevel, state]);

  // Audio level visualization (0-100 scale)
  const levelPercent = Math.round(audioLevel * 100);
  const isActivelySpeaking = audioLevel > 0.02;
  const isSilent = state === 'listening' && audioLevel < 0.005;

  return (
    <div className="flex flex-col items-center pb-8 pt-4 flex-shrink-0">
      {/* Voice Waveform Visualization - Shows when listening */}
      {state === 'listening' && (
        <div className="mb-4">
          <VoiceWaveform
            levelHistory={levelHistory}
            isActive={isActivelySpeaking}
            isSilent={isSilent}
          />
        </div>
      )}

      {/* Main Action Button */}
      <div className="relative">
        {/* Audio level ring (visible when listening and speaking) */}
        {state === 'listening' && isActivelySpeaking && (
          <div
            className="absolute inset-0 rounded-full transition-all duration-100"
            style={{
              transform: `scale(${1 + audioLevel * 0.4})`,
              background: `radial-gradient(circle, transparent 60%, rgba(34, 197, 94, ${audioLevel * 0.5}) 100%)`,
            }}
          />
        )}

        {/* Pulsing ring when idle but always-listening */}
        {state === 'idle' && alwaysListening && (
          <div className="absolute inset-0 rounded-full border-2 border-green-500/30 animate-ping" />
        )}

        {/* Stop Speaking Button (shown when speaking) */}
        {state === 'speaking' && (
          <button
            onClick={onStopSpeaking}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all bg-orange-500 hover:bg-orange-600 animate-pulse"
            aria-label="Stop speaking"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Microphone Button (shown when not speaking) */}
        {state !== 'speaking' && (
          <button
            onClick={state === 'thinking' ? onInterrupt : onMicClick}
            disabled={disabled}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all relative ${
              state === 'listening'
                ? isActivelySpeaking
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-red-500 hover:bg-red-600 voice-pulse'
                : state === 'thinking'
                ? 'bg-yellow-500 hover:bg-yellow-600 cursor-pointer'
                : alwaysListening
                ? 'bg-green-500 hover:bg-green-600 ring-2 ring-green-500/50'
                : 'bg-zenna-accent hover:bg-indigo-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={state === 'thinking' ? 'Stop thinking' : state === 'listening' ? 'Stop listening' : 'Start listening'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {state === 'listening' ? (
                // Stop icon when listening
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              ) : state === 'thinking' ? (
                // Loading spinner when thinking (clickable to cancel)
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" className="animate-spin origin-center" />
              ) : (
                // Microphone icon when idle
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Current transcript preview */}
      {currentTranscript && (
        <p className="mt-4 text-sm text-zenna-muted text-center max-w-[250px] line-clamp-2">
          &ldquo;{currentTranscript}&rdquo;
        </p>
      )}

      {/* Always-Listening Toggle */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onToggleAlwaysListening(!alwaysListening)}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all ${
            alwaysListening
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-zenna-surface text-zenna-muted border border-zenna-border hover:border-zenna-accent/50'
          }`}
          aria-label={alwaysListening ? 'Disable always-listening' : 'Enable always-listening'}
        >
          {/* Mic icon */}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <span>{alwaysListening ? 'Always On' : 'Push to Talk'}</span>
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full ${alwaysListening ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
        </button>

        {/* Tooltip */}
        {showTooltip && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-zenna-surface border border-zenna-border rounded-lg text-xs text-zenna-muted whitespace-nowrap z-20">
            {alwaysListening
              ? 'Click to switch to push-to-talk'
              : 'Enable hands-free conversation'}
          </div>
        )}
      </div>

      {/* State Text */}
      <p className="mt-3 text-xs text-zenna-muted/50 text-center max-w-[250px]">
        {state === 'idle' && (alwaysListening ? 'Listening for your voice...' : 'Click to speak')}
        {state === 'listening' && (isActivelySpeaking ? 'I hear you...' : isSilent ? 'Waiting for speech...' : 'Listening...')}
        {state === 'thinking' && (
          thinkingElapsed < 10
            ? `Thinking... (${thinkingElapsed}s)`
            : thinkingElapsed < 30
            ? `${thinkingStatus || 'Working on it...'} (${thinkingElapsed}s) — Click to cancel`
            : `${thinkingStatus || 'Taking longer than usual...'} (${thinkingElapsed}s) — Click to stop`
        )}
        {state === 'speaking' && 'Click to interrupt'}
        {state === 'error' && 'Error - try again'}
      </p>
    </div>
  );
}

/**
 * Voice Waveform Visualization
 * Shows a smooth animated waveform based on audio level history
 * - Vibrates when user is speaking
 * - Gets bigger with louder sounds
 * - Flattens to horizontal line during silence
 */
export function VoiceWaveform({
  levelHistory,
  isActive,
  isSilent,
}: {
  levelHistory: number[];
  isActive: boolean;
  isSilent: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // Calculate average level from history
      const avgLevel = levelHistory.reduce((a, b) => a + b, 0) / levelHistory.length;
      const maxLevel = Math.max(...levelHistory);

      // Phase for smooth animation
      phaseRef.current += isActive ? 0.15 : 0.03;

      // Draw waveform
      ctx.beginPath();
      ctx.moveTo(0, centerY);

      const segments = 60;
      for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * width;
        const normalizedX = i / segments;

        // Get level from history for this position
        const historyIndex = Math.floor(normalizedX * (levelHistory.length - 1));
        const localLevel = levelHistory[historyIndex] || 0;

        // Create smooth wave with multiple frequencies
        let y = centerY;

        if (isActive || avgLevel > 0.01) {
          // Amplitude based on local audio level
          const amplitude = Math.min(height * 0.4, (localLevel * 2 + avgLevel) * height * 0.6);

          // Multiple sine waves for organic movement
          const wave1 = Math.sin(normalizedX * Math.PI * 4 + phaseRef.current) * amplitude * 0.5;
          const wave2 = Math.sin(normalizedX * Math.PI * 6 + phaseRef.current * 1.3) * amplitude * 0.3;
          const wave3 = Math.sin(normalizedX * Math.PI * 10 + phaseRef.current * 0.7) * amplitude * 0.2;

          // Envelope to taper edges
          const envelope = Math.sin(normalizedX * Math.PI);

          y = centerY + (wave1 + wave2 + wave3) * envelope;
        }

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Style based on state
      if (isActive) {
        // Bright green gradient when speaking
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.1)');
        gradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.8)');
        gradient.addColorStop(1, 'rgba(34, 197, 94, 0.1)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 3;
      } else if (isSilent) {
        // Dim when silent
        ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
        ctx.lineWidth = 2;
      } else {
        // Normal listening state
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.1)');
        gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.5)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)');
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2;
      }

      ctx.stroke();

      // Draw subtle glow when active
      if (isActive && maxLevel > 0.1) {
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i <= segments; i++) {
          const x = (i / segments) * width;
          const normalizedX = i / segments;
          const historyIndex = Math.floor(normalizedX * (levelHistory.length - 1));
          const localLevel = levelHistory[historyIndex] || 0;
          const amplitude = Math.min(height * 0.4, (localLevel * 2 + avgLevel) * height * 0.6);
          const wave1 = Math.sin(normalizedX * Math.PI * 4 + phaseRef.current) * amplitude * 0.5;
          const wave2 = Math.sin(normalizedX * Math.PI * 6 + phaseRef.current * 1.3) * amplitude * 0.3;
          const wave3 = Math.sin(normalizedX * Math.PI * 10 + phaseRef.current * 0.7) * amplitude * 0.2;
          const envelope = Math.sin(normalizedX * Math.PI);
          const y = centerY + (wave1 + wave2 + wave3) * envelope;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(34, 197, 94, ${maxLevel * 0.3})`;
        ctx.lineWidth = 8;
        ctx.filter = 'blur(4px)';
        ctx.stroke();
        ctx.filter = 'none';
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [levelHistory, isActive, isSilent]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={200}
        height={40}
        className="rounded-lg"
      />
      {/* Label under waveform */}
      <div className="absolute -bottom-5 left-0 right-0 text-center">
        <span className={`text-[10px] ${isActive ? 'text-green-400' : isSilent ? 'text-gray-500' : 'text-zenna-muted'}`}>
          {isActive ? 'Speaking detected' : isSilent ? 'Silent' : 'Listening'}
        </span>
      </div>
    </div>
  );
}

/**
 * Simple Audio Waveform for compact layouts
 * Animates based on audio level input
 */
export function AudioWaveform({ level, isActive }: { level: number; isActive: boolean }) {
  const bars = 5;

  return (
    <div className="flex items-center gap-0.5 h-4">
      {Array.from({ length: bars }).map((_, i) => {
        const baseHeight = 4;
        const maxHeight = 16;
        const variance = Math.sin((i / bars) * Math.PI) * 0.5 + 0.5;
        const height = isActive
          ? baseHeight + (maxHeight - baseHeight) * level * variance * (0.5 + Math.random() * 0.5)
          : baseHeight;

        return (
          <div
            key={i}
            className="w-1 bg-zenna-accent rounded-full transition-all duration-75"
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

/**
 * Minimal Voice Button for compact layouts
 */
export function VoiceButton({
  state,
  onClick,
  size = 'md',
}: {
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-16 h-16',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <button
      onClick={onClick}
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center transition-all ${
        state === 'listening'
          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
          : state === 'speaking'
          ? 'bg-orange-500 hover:bg-orange-600'
          : state === 'thinking'
          ? 'bg-yellow-500 opacity-70'
          : 'bg-zenna-accent hover:bg-indigo-600'
      }`}
    >
      <svg className={iconSizes[size]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {state === 'listening' ? (
          <rect x="6" y="6" width="12" height="12" rx="2" strokeWidth={2} />
        ) : state === 'speaking' ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        )}
      </svg>
    </button>
  );
}
