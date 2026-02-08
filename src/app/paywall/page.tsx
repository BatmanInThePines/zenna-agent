'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SubscriptionCard, HardwareCheckbox } from '@/components/paywall';
import { SUBSCRIPTION_TIERS } from '@/lib/stripe/config';

interface SessionUser {
  id: string;
  email: string;
  role: string;
  isAdmin: boolean;
  onboardingCompleted: boolean;
  subscription?: {
    tier: string;
    status: string;
    expiresAt: string;
  };
}

function PaywallContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [hardwareBundleSelected, setHardwareBundleSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paymentStatus = searchParams.get('payment');

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (!data.authenticated) {
          router.push('/login');
          return;
        }

        // Admin/Father users NEVER see paywall - redirect immediately
        const isAdminOrFather = data.user?.isAdmin || data.user?.isFather || data.user?.role === 'admin';
        if (isAdminOrFather) {
          router.push('/chat?welcome=true');
          return;
        }

        // If already onboarded, redirect to chat
        if (data.user?.onboardingCompleted) {
          router.push('/chat');
          return;
        }

        // If has active subscription, redirect to chat
        if (data.user?.subscription?.status === 'active') {
          router.push('/chat?welcome=true');
          return;
        }

        setUser(data.user);
      } catch {
        router.push('/login');
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();
  }, [router]);

  // Check if user has an active subscription
  const hasActiveSubscription = user?.subscription?.status === 'active';
  const currentTier = user?.subscription?.tier;

  // Handle continuing with existing subscription
  const handleContinueToZenna = async () => {
    setIsLoading(true);
    try {
      // Mark onboarding as complete
      await fetch('/api/subscriptions/activate-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Ignore errors - we'll proceed anyway
    }
    // Always redirect with welcome param to bypass stale JWT check
    router.push('/chat?welcome=true');
  };

  const handleSelectTier = async (tierId: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const tier = SUBSCRIPTION_TIERS.find(t => t.id === tierId);

      if (!tier) {
        throw new Error('Invalid subscription tier');
      }

      // For free trial, just activate and redirect
      if (tier.priceType === 'free') {
        const response = await fetch('/api/subscriptions/activate-trial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to activate trial');
        }

        // Redirect to chat/onboarding
        router.push('/chat?welcome=true');
        return;
      }

      // For paid tiers, redirect to Stripe checkout
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId,
          includeHardware: hardwareBundleSelected,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">Loading subscription options...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f] py-12 px-4">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse delay-1000" />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-green-500/5 rounded-full blur-[80px] animate-pulse delay-500" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-light tracking-[0.2em] text-white mb-4">
            ZENNA
          </h1>
          <p className="text-xl text-white/60 mb-2">
            Choose your experience
          </p>
          {user?.email && (
            <p className="text-sm text-white/40">
              Signed in as {user.email}
            </p>
          )}
        </div>

        {/* Active Subscription Banner */}
        {hasActiveSubscription && (
          <div className="mb-8 p-6 rounded-xl bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="text-center md:text-left">
                <p className="text-green-400 font-medium text-lg">
                  You have an active {currentTier} subscription
                </p>
                <p className="text-white/50 text-sm mt-1">
                  Continue using Zenna or manage your subscription below
                </p>
              </div>
              <button
                onClick={handleContinueToZenna}
                disabled={isLoading}
                className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-medium rounded-xl transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isLoading ? 'Loading...' : 'Continue to Zenna →'}
              </button>
            </div>
          </div>
        )}

        {/* Payment Status Messages */}
        {paymentStatus === 'success' && (
          <div className="mb-8 p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-center">
            Payment successful! Welcome to Zenna.
          </div>
        )}
        {paymentStatus === 'cancelled' && (
          <div className="mb-8 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-center">
            Payment cancelled. You can try again or start with the free trial.
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-8 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Subscription Tiers Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {SUBSCRIPTION_TIERS.map((tier) => (
            <SubscriptionCard
              key={tier.id}
              id={tier.id}
              name={tier.name}
              price={tier.price}
              priceType={tier.priceType}
              features={tier.features}
              isAvailable={tier.isAvailable}
              highlighted={tier.highlighted}
              comingSoon={tier.comingSoon}
              onSelect={handleSelectTier}
              isLoading={isLoading}
            />
          ))}
        </div>

        {/* Hardware Bundle */}
        <div className="max-w-2xl mx-auto mb-12">
          <HardwareCheckbox
            checked={hardwareBundleSelected}
            onChange={setHardwareBundleSelected}
            disabled={true} // Coming soon
          />
        </div>

        {/* Trial Info */}
        <div className="max-w-2xl mx-auto text-center">
          <div className="p-6 rounded-xl bg-white/5 border border-white/10">
            <h3 className="text-lg font-medium text-white mb-3">
              Free Trial Details
            </h3>
            <ul className="text-sm text-white/60 space-y-2">
              <li>90-day free trial with full access to core features</li>
              <li>Day 80: We will notify you that your trial is ending soon</li>
              <li>Day 91: Choose a subscription to continue using Zenna</li>
              <li>Your memories and settings are preserved when you upgrade</li>
            </ul>
          </div>
        </div>

        {/* Smart Home Systems */}
        <div className="max-w-4xl mx-auto mt-12 text-center">
          <p className="text-sm text-white/40 mb-4">
            Compatible with leading smart home systems
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-white/30">
            {[
              'Philips Hue',
              'Home Assistant',
              'SwitchBot',
              'Lutron',
              'Denon',
              'Crestron',
              'Control4',
              'Govee',
              'SmartThings',
            ].map((system) => (
              <span key={system} className="px-3 py-1 rounded-full bg-white/5">
                {system}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 text-center space-y-2">
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

export default function PaywallPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#0f0f18] to-[#0a0a0f]">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white/50">Loading subscription options...</p>
          </div>
        </main>
      }
    >
      <PaywallContent />
    </Suspense>
  );
}
