'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserTable, type UserData } from './UserTable';
import { isFather, type UserRole } from '@/lib/utils/permissions';

interface UserManagementDashboardProps {
  currentUserEmail: string;
}

export function UserManagementDashboard({ currentUserEmail }: UserManagementDashboardProps) {
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const canEditRoles = isFather(currentUserEmail);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();

      if (response.ok) {
        setUsers(data.users || []);
      } else {
        setError(data.error || 'Failed to fetch users');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Handle role change
  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await response.json();

      if (response.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
        setMessage({ type: 'success', text: 'Role updated successfully' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update role' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to update role' });
    }
  };

  // Handle suspend
  const handleSuspend = async (userId: string) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/suspend`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, subscription: u.subscription ? { ...u.subscription, status: 'suspended' } : null }
              : u
          )
        );
        setMessage({ type: 'success', text: 'User suspended' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to suspend user' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to suspend user' });
    }
  };

  // Handle unsuspend
  const handleUnsuspend = async (userId: string) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/suspend`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, subscription: u.subscription ? { ...u.subscription, status: 'active' } : null }
              : u
          )
        );
        setMessage({ type: 'success', text: 'User unsuspended' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to unsuspend user' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to unsuspend user' });
    }
  };

  // Handle archive
  const handleArchive = async (userId: string) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/archive`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, subscription: u.subscription ? { ...u.subscription, status: 'archived' } : null }
              : u
          )
        );
        setMessage({ type: 'success', text: 'User archived. Memories moved to offline storage.' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to archive user' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to archive user' });
    }
  };

  // Handle restore
  const handleRestore = async (userId: string, restoreMemories: boolean) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/archive`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restoreMemories }),
      });

      const data = await response.json();

      if (response.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? { ...u, subscription: u.subscription ? { ...u.subscription, status: 'active' } : null }
              : u
          )
        );
        setMessage({
          type: 'success',
          text: restoreMemories
            ? 'User restored with memories'
            : 'User restored (memories remain archived)',
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to restore user' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to restore user' });
    }
  };

  // Handle export
  const handleExport = async (userId: string) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/export`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: 'Export initiated. User will receive an email with download link.',
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to initiate export' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to initiate export' });
    }
  };

  // Filter users
  const filteredUsers = users.filter((user) => {
    const matchesSearch = (user.email || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' || user.subscription?.status === statusFilter;
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesStatus && matchesRole;
  });

  // Stats
  const stats = {
    total: users.length,
    active: users.filter((u) => u.subscription?.status === 'active').length,
    suspended: users.filter((u) => u.subscription?.status === 'suspended').length,
    archived: users.filter((u) => u.subscription?.status === 'archived').length,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
        <button
          onClick={fetchUsers}
          className="mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">User Management</h2>
          <p className="text-sm text-white/50 mt-1">
            Manage user accounts, subscriptions, and data
          </p>
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-4 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Privacy Notice */}
      <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div>
            <p className="text-sm text-purple-400 font-medium">Privacy Protected</p>
            <p className="text-xs text-purple-400/70 mt-1">
              User memories and conversation content are never visible to staff.
              Data exports are sent directly to users via secure, authenticated links.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 bg-white/5 rounded-lg border border-white/10">
          <p className="text-2xl font-semibold text-white">{stats.total}</p>
          <p className="text-xs text-white/50">Total Users</p>
        </div>
        <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
          <p className="text-2xl font-semibold text-green-400">{stats.active}</p>
          <p className="text-xs text-green-400/70">Active</p>
        </div>
        <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
          <p className="text-2xl font-semibold text-yellow-400">{stats.suspended}</p>
          <p className="text-xs text-yellow-400/70">Suspended</p>
        </div>
        <div className="p-4 bg-gray-500/10 rounded-lg border border-gray-500/20">
          <p className="text-2xl font-semibold text-gray-400">{stats.archived}</p>
          <p className="text-xs text-gray-400/70">Archived</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="archived">Archived</option>
          <option value="expired">Expired</option>
        </select>

        {/* Role Filter */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30"
        >
          <option value="all">All Roles</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="admin-support">Admin Support</option>
        </select>
      </div>

      {/* User Table */}
      <div className="bg-white/5 rounded-lg border border-white/10 overflow-hidden">
        <UserTable
          users={filteredUsers}
          canEditRoles={canEditRoles}
          onRoleChange={handleRoleChange}
          onSuspend={handleSuspend}
          onUnsuspend={handleUnsuspend}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onExport={handleExport}
        />
      </div>

      {/* Role Management Notice */}
      {canEditRoles && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
          <strong>Role Management:</strong> As the primary administrator, you can change user roles.
          The "Admin Support" role is reserved for future use (rights TBD).
        </div>
      )}
    </div>
  );
}
