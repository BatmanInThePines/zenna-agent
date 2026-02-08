'use client';

import { useSearchParams } from 'next/navigation';
import { AuthForm } from '@/components/auth';
import { Suspense } from 'react';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse delay-1000" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 mb-4">
            <svg
              className="w-8 h-8 text-white"
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
          <h1 className="text-4xl font-light tracking-[0.3em] text-white mb-2">ZENNA</h1>
          <p className="text-white/50 text-sm">AI-Powered Smart Home Assistant</p>
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
        <AuthForm />

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
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </main>
    }>
      <LoginContent />
    </Suspense>
  );
}
