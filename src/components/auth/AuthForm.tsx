'use client';

import { useState } from 'react';
import { AuthProviderButton } from './AuthProviderButton';

interface AuthFormProps {
  initialMode?: 'signin' | 'signup';
}

export function AuthForm({ initialMode = 'signin' }: AuthFormProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Mode Toggle */}
      <div className="flex items-center justify-center gap-2 mb-8">
        <button
          onClick={() => setMode('signin')}
          className={`
            px-4 py-2 text-sm font-medium rounded-lg transition-all
            ${mode === 'signin'
              ? 'bg-white/10 text-white'
              : 'text-white/60 hover:text-white/80'
            }
          `}
        >
          Sign In
        </button>
        <span className="text-white/30">|</span>
        <button
          onClick={() => setMode('signup')}
          className={`
            px-4 py-2 text-sm font-medium rounded-lg transition-all
            ${mode === 'signup'
              ? 'bg-white/10 text-white'
              : 'text-white/60 hover:text-white/80'
            }
          `}
        >
          Sign Up
        </button>
      </div>

      {/* Auth Card */}
      <div className="glass-card p-8 space-y-4">
        <h2 className="text-xl font-medium text-center mb-6">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h2>

        {/* OAuth Buttons */}
        <AuthProviderButton provider="google" mode={mode} />
        <AuthProviderButton provider="apple" mode={mode} />
        <AuthProviderButton provider="github" mode={mode} />

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-[var(--card-bg)] text-white/40">
              Secure authentication
            </span>
          </div>
        </div>

        {/* Info Text */}
        <p className="text-xs text-center text-white/40 leading-relaxed">
          {mode === 'signup' ? (
            <>
              By signing up, you agree to our{' '}
              <a href="/terms" className="underline hover:text-white/60">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="underline hover:text-white/60">Privacy Policy</a>.
              <br />
              New accounts receive a 90-day free trial.
            </>
          ) : (
            <>
              Secure, passwordless authentication via your preferred provider.
              <br />
              Your data remains private and encrypted.
            </>
          )}
        </p>
      </div>

      {/* Switch Mode Link */}
      <p className="text-center text-white/50 text-sm mt-6">
        {mode === 'signin' ? (
          <>
            New to Zenna?{' '}
            <button
              onClick={() => setMode('signup')}
              className="text-white hover:underline"
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              onClick={() => setMode('signin')}
              className="text-white hover:underline"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
