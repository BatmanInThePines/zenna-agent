'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm } from '@/components/auth';
import { Suspense } from 'react';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const mode = searchParams.get('mode') as 'signin' | 'signup' | null;

  const [isChecking, setIsChecking] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlayed, setAudioPlayed] = useState(false);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (data.authenticated) {
          // Check if user has completed onboarding (selected a subscription)
          if (!data.user?.onboardingCompleted) {
            router.push('/paywall');
          } else {
            router.push('/chat');
          }
        } else {
          setShowAuth(true);
        }
      } catch {
        setShowAuth(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  // Play greeting audio when auth form is shown
  useEffect(() => {
    if (showAuth && !audioPlayed) {
      // Create audio element
      const audio = new Audio('/sounds/Greeting.mp3');
      audio.volume = 0.5; // Set to 50% volume
      audioRef.current = audio;

      // Play with user interaction fallback
      const playAudio = () => {
        audio.play().catch((err) => {
          // Autoplay might be blocked, wait for user interaction
          console.log('Audio autoplay blocked, waiting for interaction:', err);
          const playOnInteraction = () => {
            audio.play().catch(() => {});
            document.removeEventListener('click', playOnInteraction);
            document.removeEventListener('keydown', playOnInteraction);
          };
          document.addEventListener('click', playOnInteraction, { once: true });
          document.addEventListener('keydown', playOnInteraction, { once: true });
        });
        setAudioPlayed(true);
      };

      // Small delay to ensure the page has rendered
      const timer = setTimeout(playAudio, 500);

      return () => {
        clearTimeout(timer);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
      };
    }
  }, [showAuth, audioPlayed]);

  if (isChecking) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">Initializing Zenna...</p>
        </div>
      </main>
    );
  }

  if (!showAuth) {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 mb-6 shadow-xl shadow-purple-500/10">
            <svg
              className="w-10 h-10 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-5xl font-light tracking-[0.4em] text-white mb-3">ZENNA</h1>
          <p className="text-white/50 text-sm tracking-wide">AI-Powered Smart Home Assistant</p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error === 'OAuthSignin' && 'Error connecting to authentication provider.'}
            {error === 'OAuthCallback' && 'Error during authentication callback.'}
            {error === 'OAuthCreateAccount' && 'Could not create account.'}
            {error === 'EmailCreateAccount' && 'Could not create account with this email.'}
            {error === 'Callback' && 'Authentication error. Please try again.'}
            {error === 'AccessDenied' && 'Access denied. Please contact support.'}
            {error === 'Configuration' && 'Server configuration error.'}
            {!['OAuthSignin', 'OAuthCallback', 'OAuthCreateAccount', 'EmailCreateAccount', 'Callback', 'AccessDenied', 'Configuration'].includes(error) && 'An error occurred. Please try again.'}
          </div>
        )}

        {/* Auth Form */}
        <AuthForm initialMode={mode === 'signup' ? 'signup' : 'signin'} />

        {/* Footer */}
        <div className="mt-12 text-center space-y-2">
          <p className="text-white/30 text-xs">
            Part of the Anthony West Inc. ecosystem
          </p>
          <p className="text-white/20 text-xs">
            &copy; {new Date().getFullYear()} Anthony West Inc. All rights reserved.
          </p>
        </div>
      </div>

      {/* Audio element for greeting (hidden) */}
      <audio
        ref={audioRef}
        src="/sounds/Greeting.mp3"
        preload="auto"
        style={{ display: 'none' }}
      />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}
