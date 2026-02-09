'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { AuthProviderButton } from './AuthProviderButton';

type AuthMode = 'default' | 'email_sent' | 'password_login';

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('default');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.hasPassword) {
          // Existing user with password — show inline password field
          setMode('password_login');
        } else {
          // New user or needs verification — check your email
          setMode('email_sent');
        }
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Failed to send. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
        setIsLoading(false);
        return;
      }

      // SECURITY: Verify the session belongs to the correct user
      // A stale JWT cookie from a previous login could cause a session mismatch
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();

      // Validate session email matches the user who just signed in
      const sessionEmail = sessionData.user?.email?.toLowerCase();
      const expectedEmail = email.trim().toLowerCase();

      if (!sessionEmail || sessionEmail !== expectedEmail) {
        // Session mismatch — stale cookie from a different user
        console.warn('[AuthForm] Session mismatch: expected', expectedEmail, 'got', sessionEmail);
        // Force a full page reload to /login to clear stale state
        window.location.href = '/login';
        return;
      }

      const sub = sessionData.user?.subscription;
      const isAdminOrFather = sessionData.user?.isAdmin || sessionData.user?.isFather;
      const hasActiveSub = sub?.status === 'active' &&
        !(sub?.tier === 'trial' && sub?.expiresAt && new Date(sub.expiresAt) <= new Date());

      window.location.href = (isAdminOrFather || hasActiveSub) ? '/chat' : '/paywall';
    } catch {
      setError('Sign in failed. Please try again.');
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), forceReset: true }),
      });
      const data = await res.json();

      if (data.success) {
        setMode('email_sent');
      } else {
        setError(data.error || 'Failed to send reset link');
      }
    } catch {
      setError('Failed to send. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetToDefault = () => {
    setMode('default');
    setEmail('');
    setPassword('');
    setError(null);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="glass-card p-8 space-y-4">
        <h2 className="text-xl font-medium text-center mb-6">
          Welcome to Zenna
        </h2>

        {/* ─── DEFAULT MODE: OAuth + Email ─── */}
        {mode === 'default' && (
          <>
            {/* OAuth Buttons */}
            <AuthProviderButton provider="google" />
            <AuthProviderButton provider="github" />

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-[var(--card-bg)] text-white/40">
                  Or continue with email
                </span>
              </div>
            </div>

            {/* Email Input */}
            <form onSubmit={handleEmailSubmit}>
              <div className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  required
                  className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-lg px-4 py-3 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-colors text-sm"
                />
                <button
                  type="submit"
                  disabled={isLoading || !email.trim()}
                  className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Checking...
                    </span>
                  ) : (
                    'Continue with Email'
                  )}
                </button>
              </div>
            </form>

            {/* Error */}
            {error && (
              <p className="text-red-400 text-xs text-center mt-2">{error}</p>
            )}

            {/* Info Text */}
            <p className="text-xs text-center text-white/40 leading-relaxed mt-4">
              Secure authentication via your preferred method.
              <br />
              Your data remains private and encrypted.
            </p>
          </>
        )}

        {/* ─── EMAIL SENT MODE ─── */}
        {mode === 'email_sent' && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Check your email</h3>
            <p className="text-white/50 text-sm mb-1">
              We sent a verification link to
            </p>
            <p className="text-white/70 text-sm font-medium mb-4">{email}</p>
            <p className="text-white/40 text-xs mb-6">
              Click the link in the email to set your password and get started.
              <br />
              The link expires in 1 hour.
            </p>
            <button
              onClick={resetToDefault}
              className="text-purple-400 text-sm hover:text-purple-300 transition-colors"
            >
              Use a different email
            </button>
          </div>
        )}

        {/* ─── PASSWORD LOGIN MODE ─── */}
        {mode === 'password_login' && (
          <>
            <form onSubmit={handlePasswordLogin} className="space-y-3">
              {/* Email (read-only) */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Email</label>
                <div className="w-full bg-white/5 border border-white/10 text-white/60 rounded-lg px-4 py-3 text-sm">
                  {email}
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs text-white/50 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoFocus
                  className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-lg px-4 py-3 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-colors text-sm"
                />
              </div>

              {/* Error */}
              {error && (
                <p className="text-red-400 text-xs text-center">{error}</p>
              )}

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={isLoading || !password.trim()}
                className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Forgot password & back links */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={handleForgotPassword}
                disabled={isLoading}
                className="text-purple-400 text-xs hover:text-purple-300 transition-colors disabled:opacity-50"
              >
                Forgot password?
              </button>
              <button
                onClick={resetToDefault}
                className="text-white/40 text-xs hover:text-white/60 transition-colors"
              >
                Use a different email
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
