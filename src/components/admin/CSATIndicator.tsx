'use client';

import { getCSATColor, CSAT_THRESHOLD } from '@/lib/utils/permissions';

interface CSATIndicatorProps {
  score: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function CSATIndicator({ score, showLabel = true, size = 'md' }: CSATIndicatorProps) {
  const color = getCSATColor(score);

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const colorClasses = {
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    gray: 'bg-white/10 text-white/50 border-white/20',
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={`
          inline-flex items-center gap-1 rounded-full border font-medium
          ${sizeClasses[size]}
          ${colorClasses[color]}
        `}
      >
        {color === 'red' && (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {color === 'green' && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span>{score > 0 ? score.toFixed(2) : 'N/A'}</span>
      </span>
      {showLabel && score > 0 && (
        <span className={`text-xs ${color === 'red' ? 'text-red-400' : 'text-white/40'}`}>
          {color === 'red'
            ? `Below industry standard (${CSAT_THRESHOLD})`
            : 'Good'}
        </span>
      )}
    </div>
  );
}
