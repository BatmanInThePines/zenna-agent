/**
 * Trial Status Utilities
 *
 * Handles trial expiration logic:
 * - Day 80: Warning notification about trial expiration
 * - Day 91: Paywall blocks access until subscription selected
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface TrialStatus {
  isTrialUser: boolean;
  daysRemaining: number;
  expiresAt: Date | null;
  shouldShowWarning: boolean;
  shouldBlockAccess: boolean;
  warningSent: boolean;
}

/**
 * Calculate trial status for a user
 */
export function calculateTrialStatus(
  tier: string,
  status: string,
  expiresAt: string | null,
  warningSent: boolean
): TrialStatus {
  // Not a trial user
  if (tier !== 'trial' || status !== 'active') {
    return {
      isTrialUser: false,
      daysRemaining: -1,
      expiresAt: null,
      shouldShowWarning: false,
      shouldBlockAccess: status === 'suspended' || status === 'expired' || status === 'archived',
      warningSent: false,
    };
  }

  // Calculate days remaining
  const now = new Date();
  const expiry = expiresAt ? new Date(expiresAt) : null;

  if (!expiry) {
    return {
      isTrialUser: true,
      daysRemaining: 90, // Default to full trial
      expiresAt: null,
      shouldShowWarning: false,
      shouldBlockAccess: false,
      warningSent: false,
    };
  }

  const diffTime = expiry.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return {
    isTrialUser: true,
    daysRemaining,
    expiresAt: expiry,
    // Show warning at Day 80 (10 days remaining) through Day 90
    shouldShowWarning: daysRemaining <= 10 && daysRemaining > 0 && !warningSent,
    // Block access at Day 91+ (0 or negative days remaining)
    shouldBlockAccess: daysRemaining < 0,
    warningSent,
  };
}

/**
 * Mark trial warning as sent
 */
export async function markTrialWarningSent(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: SupabaseClient<any, any, any>
): Promise<boolean> {
  try {
    const { error } = await supabaseClient
      .from('subscriptions')
      .update({
        trial_warning_sent: true,
        trial_warning_sent_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('tier', 'trial')
      .eq('status', 'active');

    return !error;
  } catch {
    return false;
  }
}

/**
 * Expire trial subscription
 */
export async function expireTrialSubscription(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: SupabaseClient<any, any, any>
): Promise<boolean> {
  try {
    const { error } = await supabaseClient
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('user_id', userId)
      .eq('tier', 'trial')
      .eq('status', 'active');

    return !error;
  } catch {
    return false;
  }
}

/**
 * Get trial status for a user from database
 */
export async function getTrialStatusFromDB(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: SupabaseClient<any, any, any>
): Promise<TrialStatus | null> {
  try {
    const { data, error } = await supabaseClient
      .from('subscriptions')
      .select('tier, status, expires_at, trial_warning_sent')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return calculateTrialStatus(
      data.tier,
      data.status,
      data.expires_at,
      data.trial_warning_sent
    );
  } catch {
    return null;
  }
}

/**
 * Format days remaining for display
 */
export function formatDaysRemaining(days: number): string {
  if (days < 0) {
    return 'Expired';
  }
  if (days === 0) {
    return 'Expires today';
  }
  if (days === 1) {
    return '1 day remaining';
  }
  return `${days} days remaining`;
}

/**
 * Get warning message for trial users
 */
export function getTrialWarningMessage(daysRemaining: number): string {
  if (daysRemaining <= 0) {
    return 'Your free trial has ended. Please select a subscription to continue using Zenna.';
  }
  if (daysRemaining === 1) {
    return 'Your free trial ends tomorrow! Select a subscription to keep your memories and continue using Zenna.';
  }
  if (daysRemaining <= 3) {
    return `Your free trial ends in ${daysRemaining} days. Don't lose your memories - select a subscription now.`;
  }
  if (daysRemaining <= 10) {
    return `Your free trial ends in ${daysRemaining} days. Choose a subscription plan to continue your Zenna experience.`;
  }
  return '';
}
