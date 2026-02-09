'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'success' | 'error'>('loading');
  const [email, setEmail] = useState('');
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  // Verify token on mount
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided.');
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await fetch('/api/auth/verify-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();

        if (data.valid) {
          setEmail(data.email);
          setHasExistingPassword(data.hasExistingPassword);
          setIsNewUser(data.isNewUser);
          setStatus('ready');
        } else {
          setStatus('error');
          setErrorMessage(data.error || 'Invalid verification link.');
        }
      } catch {
        setStatus('error');
        setErrorMessage('Failed to verify link. Please try again.');
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Client-side validation
    if (newPassword.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }
    if (hasExistingPassword && !currentPassword) {
      setFormError('Current password is required');
      return;
    }

    setStatus('submitting');

    try {
      // Set the password
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword,
          confirmPassword,
          currentPassword: hasExistingPassword ? currentPassword : undefined,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setFormError(data.error || 'Failed to set password');
        setStatus('ready');
        return;
      }

      setStatus('success');

      // Auto sign-in via NextAuth Credentials provider
      const signInResult = await signIn('credentials', {
        email: data.email,
        password: newPassword,
        redirect: false,
      });

      if (signInResult?.error) {
        // Sign-in failed — redirect to login with success message
        router.push('/login?message=password_set');
        return;
      }

      // SECURITY: Verify the session belongs to the correct user
      // A stale JWT cookie from a previous login could cause a session mismatch
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();

      // Validate session email matches the user who just set their password
      const sessionEmail = sessionData.user?.email?.toLowerCase();
      const expectedEmail = data.email?.toLowerCase();

      if (!sessionEmail || sessionEmail !== expectedEmail) {
        // Session mismatch — stale cookie from a different user
        // New user should go to paywall, redirect to login as safe fallback
        console.warn('[set-password] Session mismatch: expected', expectedEmail, 'got', sessionEmail);
        router.push(isNewUser ? '/paywall' : '/login?message=password_set');
        return;
      }

      const sub = sessionData.user?.subscription;
      const isAdminOrFather = sessionData.user?.isAdmin || sessionData.user?.isFather;
      const hasActiveSub = sub?.status === 'active' &&
        !(sub?.tier === 'trial' && sub?.expiresAt && new Date(sub.expiresAt) <= new Date());

      if (isAdminOrFather || hasActiveSub) {
        router.push('/chat');
      } else {
        router.push('/paywall');
      }
    } catch {
      setFormError('An unexpected error occurred. Please try again.');
      setStatus('ready');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f] flex items-center justify-center px-4">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* ZENNA Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light tracking-[0.2em] text-white">ZENNA</h1>
          <p className="text-white/40 text-sm mt-2">Your AI Companion</p>
        </div>

        {/* Loading State */}
        {status === 'loading' && (
          <div className="glass-card p-8 text-center">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/50">Verifying your link...</p>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && (
          <div className="glass-card p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-white mb-2">Link Invalid</h2>
            <p className="text-white/50 text-sm mb-6">{errorMessage}</p>
            <button
              onClick={() => router.push('/login')}
              className="px-6 py-2.5 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white text-sm font-medium rounded-lg transition-all"
            >
              Back to Sign In
            </button>
          </div>
        )}

        {/* Success State (brief, auto-redirects) */}
        {status === 'success' && (
          <div className="glass-card p-8 text-center">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/70 font-medium">Password set successfully!</p>
            <p className="text-white/40 text-sm mt-2">Signing you in...</p>
          </div>
        )}

        {/* Password Form */}
        {(status === 'ready' || status === 'submitting') && (
          <div className="glass-card p-8">
            <h2 className="text-xl font-medium text-center text-white mb-2">
              {hasExistingPassword ? 'Reset Your Password' : 'Set Your Password'}
            </h2>
            <p className="text-white/40 text-sm text-center mb-6">
              {email}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current Password (only for existing users) */}
              {hasExistingPassword && (
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    required
                    className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-lg px-4 py-3 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-colors"
                  />
                </div>
              )}

              {/* New Password */}
              <div>
                <label className="block text-sm text-white/60 mb-1.5">
                  {hasExistingPassword ? 'New Password' : 'Password'}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  minLength={8}
                  className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-lg px-4 py-3 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-colors"
                />
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm text-white/60 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  minLength={8}
                  className="w-full bg-white/5 border border-white/10 text-white placeholder-white/30 rounded-lg px-4 py-3 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/25 transition-colors"
                />
              </div>

              {/* Form Error */}
              {formError && (
                <p className="text-red-400 text-sm text-center">{formError}</p>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              >
                {status === 'submitting' ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Setting password...
                  </span>
                ) : hasExistingPassword ? (
                  'Reset Password'
                ) : (
                  'Set Password & Continue'
                )}
              </button>
            </form>

            {/* Back to login */}
            <p className="text-center mt-6">
              <button
                onClick={() => router.push('/login')}
                className="text-white/40 text-sm hover:text-white/60 transition-colors"
              >
                Back to sign in
              </button>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f] flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/50">Loading...</p>
          </div>
        </main>
      }
    >
      <SetPasswordContent />
    </Suspense>
  );
}
