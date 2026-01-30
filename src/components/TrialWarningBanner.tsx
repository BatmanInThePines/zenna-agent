'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDaysRemaining, getTrialWarningMessage } from '@/lib/utils/trialStatus';

interface TrialWarningBannerProps {
  daysRemaining: number;
  onDismiss?: () => void;
}

export function TrialWarningBanner({ daysRemaining, onDismiss }: TrialWarningBannerProps) {
  const router = useRouter();
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed || daysRemaining > 10) {
    return null;
  }

  const message = getTrialWarningMessage(daysRemaining);
  const isUrgent = daysRemaining <= 3;
  const isExpired = daysRemaining <= 0;

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const handleUpgrade = () => {
    router.push('/paywall');
  };

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-40 px-4 py-3
        ${isExpired
          ? 'bg-red-500/90 text-white'
          : isUrgent
            ? 'bg-orange-500/90 text-white'
            : 'bg-yellow-500/90 text-black'
        }
      `}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={`
            p-1.5 rounded-full
            ${isExpired ? 'bg-white/20' : isUrgent ? 'bg-white/20' : 'bg-black/10'}
          `}>
            {isExpired ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>

          {/* Message */}
          <div>
            <p className="text-sm font-medium">{message}</p>
            <p className={`text-xs ${isExpired || isUrgent ? 'text-white/70' : 'text-black/60'}`}>
              {formatDaysRemaining(daysRemaining)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Upgrade button */}
          <button
            onClick={handleUpgrade}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${isExpired
                ? 'bg-white text-red-600 hover:bg-red-50'
                : isUrgent
                  ? 'bg-white text-orange-600 hover:bg-orange-50'
                  : 'bg-black text-yellow-500 hover:bg-black/80'
              }
            `}
          >
            {isExpired ? 'Choose a Plan' : 'Upgrade Now'}
          </button>

          {/* Dismiss button (only if not expired) */}
          {!isExpired && (
            <button
              onClick={handleDismiss}
              className={`
                p-1.5 rounded-lg transition-colors
                ${isUrgent ? 'hover:bg-white/20' : 'hover:bg-black/10'}
              `}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
