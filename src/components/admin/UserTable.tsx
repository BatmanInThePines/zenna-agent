'use client';

import { useState } from 'react';
import { CSATIndicator } from './CSATIndicator';
import { RoleSelector } from './RoleSelector';
import type { UserRole } from '@/lib/utils/permissions';

export interface UserData {
  id: string;
  email: string;
  role: UserRole;
  subscription: {
    tier: string;
    status: string;
    expiresAt: string | null;
  } | null;
  csatScore: number;
  consumption: {
    apiCalls: number;
    tokensUsed: number;
  };
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserTableProps {
  users: UserData[];
  canEditRoles: boolean;
  onRoleChange: (userId: string, newRole: UserRole) => Promise<void>;
  onSuspend: (userId: string) => Promise<void>;
  onUnsuspend: (userId: string) => Promise<void>;
  onArchive: (userId: string) => Promise<void>;
  onRestore: (userId: string, restoreMemories: boolean) => Promise<void>;
  onExport: (userId: string) => Promise<void>;
}

export function UserTable({
  users,
  canEditRoles,
  onRoleChange,
  onSuspend,
  onUnsuspend,
  onArchive,
  onRestore,
  onExport,
}: UserTableProps) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [restoreWithMemories, setRestoreWithMemories] = useState(false);

  const handleAction = async (
    userId: string,
    action: 'suspend' | 'unsuspend' | 'archive' | 'restore' | 'export'
  ) => {
    setActionLoading(`${userId}-${action}`);
    try {
      switch (action) {
        case 'suspend':
          await onSuspend(userId);
          break;
        case 'unsuspend':
          await onUnsuspend(userId);
          break;
        case 'archive':
          await onArchive(userId);
          break;
        case 'restore':
          await onRestore(userId, restoreWithMemories);
          setRestoreWithMemories(false);
          break;
        case 'export':
          await onExport(userId);
          break;
      }
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-500/20 text-green-400 border-green-500/30',
      suspended: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      expired: 'bg-red-500/20 text-red-400 border-red-500/30',
      archived: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
    };

    return (
      <span
        className={`
          inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
          ${styles[status] || styles.active}
        `}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getTierBadge = (tier: string) => {
    const styles: Record<string, string> = {
      trial: 'bg-blue-500/20 text-blue-400',
      standard: 'bg-purple-500/20 text-purple-400',
      pro: 'bg-orange-500/20 text-orange-400',
      platinum: 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400',
    };

    return (
      <span
        className={`
          inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
          ${styles[tier] || styles.trial}
        `}
      >
        {tier.charAt(0).toUpperCase() + tier.slice(1)}
      </span>
    );
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              User
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              Role
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              Subscription
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              Status
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              CSAT
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              Usage
            </th>
            <th className="text-right py-3 px-4 text-xs font-medium text-white/50 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <>
              <tr
                key={user.id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-4 px-4">
                  <div>
                    <p className="text-sm font-medium text-white">{user.email}</p>
                    <p className="text-xs text-white/40">
                      Joined {formatDate(user.createdAt)} | Last login {formatDate(user.lastLoginAt)}
                    </p>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <RoleSelector
                    userId={user.id}
                    currentRole={user.role}
                    canEditRoles={canEditRoles}
                    onRoleChange={onRoleChange}
                  />
                </td>
                <td className="py-4 px-4">
                  {user.subscription ? (
                    <div className="flex items-center gap-2">
                      {getTierBadge(user.subscription.tier)}
                      {user.subscription.expiresAt && (
                        <span className="text-xs text-white/40">
                          Exp: {formatDate(user.subscription.expiresAt)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-white/40">None</span>
                  )}
                </td>
                <td className="py-4 px-4">
                  {user.subscription ? getStatusBadge(user.subscription.status) : getStatusBadge('none')}
                </td>
                <td className="py-4 px-4">
                  <CSATIndicator score={user.csatScore} showLabel={false} size="sm" />
                </td>
                <td className="py-4 px-4">
                  <div className="text-xs text-white/60">
                    <p>{formatNumber(user.consumption.apiCalls)} calls</p>
                    <p className="text-white/40">{formatNumber(user.consumption.tokensUsed)} tokens</p>
                  </div>
                </td>
                <td className="py-4 px-4 text-right">
                  <button
                    onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 text-white/60 transition-transform ${
                        expandedUser === user.id ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </td>
              </tr>

              {/* Expanded Actions Row */}
              {expandedUser === user.id && (
                <tr className="bg-white/5">
                  <td colSpan={7} className="py-4 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Suspend/Unsuspend */}
                        {user.subscription?.status === 'suspended' || user.subscription?.status === 'archived' ? (
                          <button
                            onClick={() => handleAction(user.id, 'unsuspend')}
                            disabled={actionLoading === `${user.id}-unsuspend`}
                            className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === `${user.id}-unsuspend` ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            Unsuspend
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction(user.id, 'suspend')}
                            disabled={actionLoading === `${user.id}-suspend`}
                            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === `${user.id}-suspend` ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                            Suspend
                          </button>
                        )}

                        {/* Archive/Restore */}
                        {user.subscription?.status === 'archived' ? (
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs text-white/60">
                              <input
                                type="checkbox"
                                checked={restoreWithMemories}
                                onChange={(e) => setRestoreWithMemories(e.target.checked)}
                                className="w-3 h-3 rounded"
                              />
                              Restore memories
                            </label>
                            <button
                              onClick={() => handleAction(user.id, 'restore')}
                              disabled={actionLoading === `${user.id}-restore`}
                              className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/30 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === `${user.id}-restore` ? (
                                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                              )}
                              Restore
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAction(user.id, 'archive')}
                            disabled={actionLoading === `${user.id}-archive`}
                            className="flex items-center gap-2 px-3 py-1.5 bg-gray-500/20 text-gray-400 rounded-lg text-sm hover:bg-gray-500/30 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === `${user.id}-archive` ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            )}
                            Archive
                          </button>
                        )}

                        {/* Export Data */}
                        <button
                          onClick={() => handleAction(user.id, 'export')}
                          disabled={actionLoading === `${user.id}-export`}
                          className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded-lg text-sm hover:bg-purple-500/30 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === `${user.id}-export` ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          )}
                          Export Data
                        </button>
                      </div>

                      <p className="text-xs text-white/40 max-w-xs text-right">
                        User data exports are sent directly to the user's email.
                        Staff cannot view user memories.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {users.length === 0 && (
        <div className="text-center py-12 text-white/40">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p>No users found</p>
        </div>
      )}
    </div>
  );
}
