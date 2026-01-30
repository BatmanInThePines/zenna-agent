'use client';

import { useState, useEffect, useRef } from 'react';

// Welcome narrative content
const WELCOME_NARRATIVE = `Welcome to Zenna, your personal AI assistant for smart living.

I'm here to help you manage your home, conduct research, and be your thoughtful companion throughout your day.

Here's what you can do with your current subscription:

With your Free Trial, you have up to twelve sessions every twenty-four hours. Your memories with me are retained up to one hundred megabytes, so our conversations build context over time.

You can create a custom avatar for me, or choose from our defaults. Connect your favorite cloud AI services to expand my capabilities. I can help with light research activities across the web. And you can access me on both mobile and web.

To customize your experience, just ask me things like: "Change your avatar", "Connect to my cloud AI", or "What smart home devices can you control?"

Your trial lasts ninety days. I'll remind you when it's almost time to choose your subscription plan.

How can I help you today?`;

// Trigger phrases that replay the narrative
const CUSTOMIZATION_TRIGGERS = [
  'what can i do to customize you',
  'what can i do to critique you',
  'how do i customize you',
  'how can i customize you',
  'what are my options',
  'what can you do',
  'help me customize',
];

interface WelcomeNarrativeProps {
  isFirstLogin: boolean;
  onComplete: () => void;
  autoPlay?: boolean;
}

export function WelcomeNarrative({ isFirstLogin, onComplete, autoPlay = true }: WelcomeNarrativeProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLine, setCurrentLine] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = WELCOME_NARRATIVE.split('\n\n');

  // Auto-play on first login
  useEffect(() => {
    if (isFirstLogin && autoPlay) {
      playNarrative();
    }
  }, [isFirstLogin, autoPlay]);

  const playNarrative = async () => {
    setIsLoading(true);
    setError(null);
    setIsPlaying(true);
    setCurrentLine(0);
    setShowTranscript(true);

    try {
      // Generate TTS audio for the welcome narrative
      const response = await fetch('/api/onboarding/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: WELCOME_NARRATIVE }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate welcome audio');
      }

      const data = await response.json();

      if (data.audioUrl) {
        setAudioUrl(data.audioUrl);
      } else {
        // Fallback: just show transcript without audio
        simulateNarrative();
      }
    } catch (err) {
      console.error('Welcome narrative error:', err);
      // Fallback to transcript-only mode
      simulateNarrative();
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate narrative playback with transcript highlighting
  const simulateNarrative = () => {
    let lineIndex = 0;
    const interval = setInterval(() => {
      if (lineIndex >= lines.length) {
        clearInterval(interval);
        setIsPlaying(false);
        onComplete();
        return;
      }
      setCurrentLine(lineIndex);
      lineIndex++;
    }, 3000); // 3 seconds per paragraph

    return () => clearInterval(interval);
  };

  // Handle audio playback
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play().catch(console.error);
    }
  }, [audioUrl]);

  const handleAudioEnd = () => {
    setIsPlaying(false);
    onComplete();
  };

  const handleSkip = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    onComplete();
  };

  if (!isFirstLogin && !isPlaying) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl">
        {/* Card */}
        <div className="bg-gradient-to-br from-[#1a1a24] to-[#0f0f18] rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Avatar placeholder with animation */}
                <div className={`
                  w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30
                  flex items-center justify-center border border-white/20
                  ${isPlaying ? 'animate-pulse' : ''}
                `}>
                  <span className="text-3xl">Z</span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Welcome to Zenna</h2>
                  <p className="text-sm text-white/50">
                    {isLoading ? 'Preparing your introduction...' : isPlaying ? 'Speaking...' : 'Ready'}
                  </p>
                </div>
              </div>

              {/* Audio indicator */}
              {isPlaying && (
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-purple-400 rounded-full animate-pulse"
                      style={{
                        height: `${12 + Math.random() * 12}px`,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Transcript */}
          <div className="p-6 max-h-96 overflow-y-auto">
            {showTranscript && (
              <div className="space-y-4">
                {lines.map((line, index) => (
                  <p
                    key={index}
                    className={`
                      text-sm leading-relaxed transition-all duration-500
                      ${index === currentLine
                        ? 'text-white'
                        : index < currentLine
                          ? 'text-white/60'
                          : 'text-white/30'
                      }
                    `}
                  >
                    {line}
                  </p>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-white/10 flex items-center justify-between">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="text-sm text-white/50 hover:text-white transition-colors"
            >
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>

            <div className="flex items-center gap-3">
              {!isPlaying && !isLoading && (
                <button
                  onClick={playNarrative}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded-lg text-sm transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Play Again
                </button>
              )}

              <button
                onClick={handleSkip}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white transition-colors"
              >
                {isPlaying ? 'Skip' : 'Continue'}
              </button>
            </div>
          </div>
        </div>

        {/* Hidden audio element */}
        <audio ref={audioRef} onEnded={handleAudioEnd} className="hidden" />
      </div>
    </div>
  );
}

// Helper hook to check for customization triggers
export function useCustomizationTrigger(message: string): boolean {
  const normalizedMessage = message.toLowerCase().trim();
  return CUSTOMIZATION_TRIGGERS.some((trigger) => normalizedMessage.includes(trigger));
}

// Export the narrative content for reference
export { WELCOME_NARRATIVE, CUSTOMIZATION_TRIGGERS };
