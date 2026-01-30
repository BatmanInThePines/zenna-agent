'use client';

import { useState } from 'react';
import { AVAILABLE_ROLES, type UserRole } from '@/lib/utils/permissions';

interface RoleSelectorProps {
  userId: string;
  currentRole: UserRole;
  canEditRoles: boolean;
  onRoleChange: (userId: string, newRole: UserRole) => Promise<void>;
}

const roleLabels: Record<UserRole, string> = {
  user: 'User',
  admin: 'Administrator',
  'admin-support': 'Admin Support',
};

const roleDescriptions: Record<UserRole, string> = {
  user: 'Standard user access',
  admin: 'Full admin access',
  'admin-support': 'Limited admin access (TBD)',
};

export function RoleSelector({ userId, currentRole, canEditRoles, onRoleChange }: RoleSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleRoleChange = async (newRole: UserRole) => {
    if (newRole === currentRole) {
      setShowDropdown(false);
      return;
    }

    setIsUpdating(true);
    try {
      await onRoleChange(userId, newRole);
    } finally {
      setIsUpdating(false);
      setShowDropdown(false);
    }
  };

  // Non-editable display (for non-father users)
  if (!canEditRoles) {
    return (
      <span
        className={`
          inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium
          ${currentRole === 'admin'
            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
            : currentRole === 'admin-support'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'bg-white/10 text-white/60 border border-white/20'
          }
        `}
      >
        {roleLabels[currentRole]}
      </span>
    );
  }

  // Editable dropdown (for father only)
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isUpdating}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
          transition-colors
          ${currentRole === 'admin'
            ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
            : currentRole === 'admin-support'
              ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              : 'bg-white/10 text-white/60 hover:bg-white/20'
          }
          ${isUpdating ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
        `}
      >
        {isUpdating ? (
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {roleLabels[currentRole]}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {showDropdown && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />

          {/* Dropdown */}
          <div className="absolute z-50 mt-1 w-56 bg-[#1a1a24] border border-white/10 rounded-lg shadow-xl overflow-hidden">
            {AVAILABLE_ROLES.map((role) => (
              <button
                key={role}
                onClick={() => handleRoleChange(role)}
                className={`
                  w-full px-4 py-3 text-left hover:bg-white/5 transition-colors
                  ${role === currentRole ? 'bg-white/10' : ''}
                `}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{roleLabels[role]}</p>
                    <p className="text-xs text-white/50">{roleDescriptions[role]}</p>
                  </div>
                  {role === currentRole && (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
