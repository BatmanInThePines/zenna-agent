'use client';

import { AuthProviderButton } from './AuthProviderButton';

export function AuthForm() {
  return (
    <div className="w-full max-w-md mx-auto">
      {/* Auth Card */}
      <div className="glass-card p-8 space-y-4">
        <h2 className="text-xl font-medium text-center mb-6">
          Welcome to Zenna
        </h2>

        {/* OAuth Buttons */}
        <AuthProviderButton provider="google" />
        <AuthProviderButton provider="apple" />
        <AuthProviderButton provider="github" />

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
          Secure, passwordless authentication via your preferred provider.
          <br />
          Your data remains private and encrypted.
        </p>
      </div>
    </div>
  );
}
