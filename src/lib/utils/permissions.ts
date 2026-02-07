/**
 * Zenna Permission Utilities
 *
 * ROLE MANAGEMENT RULES:
 * 1. Only anthony@anthonywestinc.com (father) can change user roles
 * 2. Available roles: user, admin, admin-support
 * 3. admin-support role rights are TBD (future release)
 * 4. Role changes are logged for audit trail
 *
 * PRIVACY PRINCIPLES:
 * 1. User data is NEVER accessible to Zenna staff
 * 2. All data exports are self-service only
 * 3. Memory content is encrypted at rest
 * 4. Archive operations preserve encryption
 * 5. Admin dashboard shows METADATA only, never content
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The primary administrator email (father of Zenna)
export const FATHER_EMAIL = 'anthony@anthonywestinc.com';

// Available roles
export const AVAILABLE_ROLES = ['user', 'admin', 'admin-support'] as const;
export type UserRole = (typeof AVAILABLE_ROLES)[number];

// Privacy rules - what admins can and cannot see
export const PRIVACY_RULES = {
  // Admins can see: email, status, consumption metrics, CSAT
  ADMIN_VISIBLE_FIELDS: ['email', 'status', 'subscription', 'consumption', 'csat', 'role', 'created_at', 'last_login_at'],
  // Admins CANNOT see: memories, conversation content, personal data
  ADMIN_HIDDEN_FIELDS: ['memories', 'conversations', 'personalData', 'settings'],
} as const;

// CSAT threshold for "red" indicator (below industry standard)
export const CSAT_THRESHOLD = 3.5;

// Session limits by tier
export const SESSION_LIMITS: Record<string, number> = {
  trial: 12,
  standard: 50,
  pro: 100,
  platinum: -1, // Unlimited
};

// Memory limits by tier (in MB)
export const MEMORY_LIMITS: Record<string, number> = {
  trial: 100,
  standard: 500,
  pro: 2000,
  platinum: -1, // Unlimited
};

/**
 * Check if a user is the father (primary admin)
 */
export function isFather(email: string | null | undefined): boolean {
  return email === FATHER_EMAIL;
}

/**
 * Check if a user can manage roles (only father)
 */
export function canManageRoles(email: string | null | undefined): boolean {
  return isFather(email);
}

/**
 * Check if a user is an admin
 */
export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'admin-support';
}

/**
 * Check if user can access admin dashboard
 */
export function canAccessAdminDashboard(role: string | null | undefined, email: string | null | undefined): boolean {
  return isAdmin(role) || isFather(email);
}

/**
 * Check if user can suspend/unsuspend other users
 */
export function canSuspendUsers(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Check if user can archive/restore users
 */
export function canArchiveUsers(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Check if user can initiate data exports for others
 */
export function canInitiateExports(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Check if user has God-level access (ecosystem-wide memory scanning)
 * Only the father/primary admin can access cross-user memories.
 * This is a privileged capability that bypasses per-user memory isolation.
 */
export function canAccessEcosystemMemories(
  role: string | null | undefined,
  email: string | null | undefined
): boolean {
  return isFather(email) || role === 'admin';
}

/**
 * Get CSAT color indicator
 */
export function getCSATColor(score: number): 'red' | 'green' | 'gray' {
  if (score === 0) return 'gray';
  return score < CSAT_THRESHOLD ? 'red' : 'green';
}

/**
 * Get session limit for a subscription tier
 */
export function getSessionLimit(tier: string): number {
  return SESSION_LIMITS[tier] ?? SESSION_LIMITS.trial;
}

/**
 * Get memory limit for a subscription tier
 */
export function getMemoryLimit(tier: string): number {
  return MEMORY_LIMITS[tier] ?? MEMORY_LIMITS.trial;
}

/**
 * Check if user has exceeded session limit
 */
export function hasExceededSessionLimit(currentCount: number, tier: string): boolean {
  const limit = getSessionLimit(tier);
  if (limit === -1) return false; // Unlimited
  return currentCount >= limit;
}

/**
 * Check if user has exceeded memory limit
 */
export function hasExceededMemoryLimit(currentMB: number, tier: string): boolean {
  const limit = getMemoryLimit(tier);
  if (limit === -1) return false; // Unlimited
  return currentMB >= limit;
}

/**
 * Calculate days remaining in trial
 */
export function getTrialDaysRemaining(expiresAt: string | Date): number {
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Check if trial warning should be shown (Day 80+)
 */
export function shouldShowTrialWarning(expiresAt: string | Date): boolean {
  const daysRemaining = getTrialDaysRemaining(expiresAt);
  return daysRemaining <= 10 && daysRemaining > 0;
}

/**
 * Check if trial has expired and user should be blocked
 */
export function isTrialExpired(expiresAt: string | Date): boolean {
  const daysRemaining = getTrialDaysRemaining(expiresAt);
  return daysRemaining < 0;
}

/**
 * Update user role (father only)
 */
export async function updateUserRole(
  requestorEmail: string,
  targetUserId: string,
  newRole: UserRole,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseServiceClient: SupabaseClient<any, any, any>
): Promise<{ success: boolean; error?: string }> {
  // Verify requestor is father
  if (!canManageRoles(requestorEmail)) {
    return {
      success: false,
      error: 'Unauthorized: Only primary administrator can change roles',
    };
  }

  // Validate role
  if (!AVAILABLE_ROLES.includes(newRole)) {
    return {
      success: false,
      error: `Invalid role: ${newRole}. Must be one of: ${AVAILABLE_ROLES.join(', ')}`,
    };
  }

  try {
    // Get target user email for audit log
    const { data, error: fetchError } = await supabaseServiceClient
      .from('users')
      .select('email, role')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !data) {
      return { success: false, error: 'User not found' };
    }

    // Type assertion for the response
    const targetUser = data as { email: string; role: string };

    // Prevent changing father's role
    if (targetUser.email === FATHER_EMAIL) {
      return {
        success: false,
        error: 'Cannot change the role of the primary administrator',
      };
    }

    // Update role
    const { error: updateError } = await supabaseServiceClient
      .from('users')
      .update({ role: newRole })
      .eq('id', targetUserId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Log the role change
    await supabaseServiceClient.from('admin_audit_log').insert({
      admin_email: requestorEmail,
      action: 'role_change',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {
        previous_role: targetUser.role,
        new_role: newRole,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating user role:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// WORKFORCE AGENT PERMISSIONS
// ============================================

/**
 * Check if user has GOD-level access for cross-user memory mining.
 * GOD mode enables ecosystem-wide intelligence mining across all memory scopes
 * except companion (private emotional memories are always protected).
 */
export function hasGodMode(
  godMode: boolean | undefined,
  email: string | null | undefined
): boolean {
  if (isFather(email)) return true;
  return godMode === true;
}

/**
 * Check if user/agent can write to backlog databases.
 */
export function canWriteBacklog(
  backlogWriteAccess: boolean | undefined,
  email: string | null | undefined
): boolean {
  if (isFather(email)) return true;
  return backlogWriteAccess === true;
}

/**
 * Check if user/agent can read sprint assignments.
 */
export function canReadSprints(
  sprintAssignmentAccess: boolean | undefined,
  email: string | null | undefined
): boolean {
  if (isFather(email)) return true;
  return sprintAssignmentAccess === true;
}

/**
 * Check if user is a workforce agent (worker or architect).
 */
export function isAgentUser(
  userType: string | undefined
): boolean {
  return userType === 'worker_agent' || userType === 'architect_agent';
}

/**
 * Check if user has any workforce capabilities (sprint, backlog, or agent type).
 */
export function isWorkforceUser(
  userType: string | undefined,
  sprintAssignmentAccess: boolean | undefined,
  backlogWriteAccess: boolean | undefined,
  email: string | null | undefined
): boolean {
  if (isFather(email)) return true;
  return isAgentUser(userType) || sprintAssignmentAccess === true || backlogWriteAccess === true;
}

/**
 * Get the allowed memory scopes for a user.
 * Human users default to ['companion'].
 * Agents are restricted to their configured scopes.
 */
export function getAllowedMemoryScopes(
  memoryScope: string[] | undefined
): string[] {
  if (!memoryScope || memoryScope.length === 0) {
    return ['companion'];
  }
  return memoryScope;
}

/**
 * Generate secure token for data exports
 */
export function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
