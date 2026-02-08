'use client';

import { useState } from 'react';

interface SubscriptionCardProps {
  id: string;
  name: string;
  price: string;
  priceType: 'free' | 'one-time' | 'monthly' | 'contact';
  features: string[];
  isAvailable: boolean;
  highlighted?: boolean;
  comingSoon?: boolean;
  subtitle?: string;
  description?: string;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}

export function SubscriptionCard({
  id,
  name,
  price,
  priceType,
  features,
  isAvailable,
  highlighted = false,
  comingSoon = false,
  subtitle,
  description,
  onSelect,
  isLoading = false,
}: SubscriptionCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const priceLabel = {
    free: 'for 7 days',
    'one-time': 'one-time',
    monthly: '/month',
    contact: '',
  }[priceType];

  return (
    <div
      className={`
        relative rounded-2xl p-6 transition-all duration-300
        ${highlighted
          ? 'bg-gradient-to-br from-purple-500/20 to-blue-500/20 border-2 border-purple-500/50 shadow-lg shadow-purple-500/10'
          : 'bg-white/5 border border-white/10'
        }
        ${!isAvailable ? 'opacity-60' : 'hover:border-white/30'}
        ${isHovered && isAvailable ? 'transform scale-[1.02]' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Coming Soon Badge */}
      {comingSoon && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-full">
            Coming Soon
          </span>
        </div>
      )}

      {/* Highlighted Badge */}
      {highlighted && !comingSoon && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <span className="px-3 py-1 text-xs font-medium bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-full">
            Start Here
          </span>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-white mb-2">{name}</h3>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl font-bold text-white">{price}</span>
          {priceLabel && <span className="text-white/50 text-sm">{priceLabel}</span>}
        </div>
        {subtitle && (
          <p className="text-sm font-medium text-purple-300 mt-2">{subtitle}</p>
        )}
        {description && (
          <p className="text-xs text-white/40 mt-2 leading-relaxed">{description}</p>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-3 mb-6">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-3">
            <svg
              className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                isAvailable ? 'text-green-400' : 'text-white/30'
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className={`text-sm ${isAvailable ? 'text-white/80' : 'text-white/40'}`}>
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA Button */}
      <button
        onClick={() => onSelect(id)}
        disabled={!isAvailable || isLoading}
        className={`
          w-full py-3 px-4 rounded-lg font-medium transition-all duration-200
          ${isAvailable
            ? highlighted
              ? 'bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600 shadow-lg shadow-purple-500/25'
              : 'bg-white text-gray-900 hover:bg-gray-100'
            : 'bg-white/10 text-white/40 cursor-not-allowed'
          }
        `}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Processing...
          </span>
        ) : isAvailable ? (
          priceType === 'free' ? 'Start Free Trial' : 'Select Plan'
        ) : (
          'Coming Soon'
        )}
      </button>
    </div>
  );
}
