'use client';

import { useState, useEffect, useCallback } from 'react';

interface VoiceControlsProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
  audioLevel?: number;
  alwaysListening: boolean;
  onMicClick: () => void;
  onStopSpeaking: () => void;
  onToggleAlwaysListening: (enabled: boolean) => void;
  currentTranscript?: string;
  disabled?: boolean;
}

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
  onToggleAlwaysListening,
  currentTranscript,
  disabled = false,
}: VoiceControlsProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Audio level visualization (0-100 scale)
  const levelPercent = Math.round(audioLevel * 100);

  return (
    <div className="flex flex-col items-center pb-8 pt-4 flex-shrink-0">
      {/* Main Action Button */}
      <div className="relative">
        {/* Audio level ring (visible when listening) */}
        {state === 'listening' && (
          <div
            className="absolute inset-0 rounded-full transition-all duration-75"
            style={{
              transform: `scale(${1 + audioLevel * 0.3})`,
              background: `radial-gradient(circle, transparent 50%, rgba(239, 68, 68, ${audioLevel * 0.4}) 100%)`,
            }}
          />
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
            onClick={onMicClick}
            disabled={disabled || state === 'thinking'}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all relative ${
              state === 'listening'
                ? 'bg-red-500 hover:bg-red-600 voice-pulse'
                : state === 'thinking'
                ? 'bg-yellow-500 opacity-50 cursor-wait'
                : 'bg-zenna-accent hover:bg-indigo-600'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={state === 'listening' ? 'Stop listening' : 'Start listening'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {state === 'listening' ? (
                // Stop icon when listening
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              ) : state === 'thinking' ? (
                // Loading spinner when thinking
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

      {/* Audio Level Indicator (when always-listening is active) */}
      {alwaysListening && state === 'listening' && (
        <div className="mt-3 w-32 h-1.5 bg-zenna-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-75"
            style={{ width: `${levelPercent}%` }}
          />
        </div>
      )}

      {/* State Text */}
      <p className="mt-3 text-xs text-zenna-muted/50">
        {state === 'idle' && (alwaysListening ? 'Listening for your voice...' : 'Click to speak')}
        {state === 'listening' && 'Listening...'}
        {state === 'thinking' && 'Thinking...'}
        {state === 'speaking' && 'Click to interrupt'}
        {state === 'error' && 'Error - try again'}
      </p>
    </div>
  );
}

/**
 * Audio Waveform Visualization
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
