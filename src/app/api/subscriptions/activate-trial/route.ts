/**
 * API Route: Activate Free Trial
 * POST /api/subscriptions/activate-trial
 *
 * Creates a 90-day free trial subscription for the authenticated user.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    const supabase = getSupabaseClient();
    // Get authenticated user
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Check if user already has an active subscription
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('id, tier, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (existingSubscription) {
      // User already has a subscription - just mark onboarding as complete
      await supabase
        .from('users')
        .update({ onboarding_completed: true })
        .eq('id', userId);

      return NextResponse.json({
        success: true,
        message: 'Onboarding marked complete',
        subscription: {
          id: existingSubscription.id,
          tier: existingSubscription.tier,
          status: existingSubscription.status,
        },
      });
    }

    // Calculate trial end date (90 days from now)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 90);

    // Create trial subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        tier: 'trial',
        status: 'active',
        expires_at: trialEndDate.toISOString(),
        hardware_bundle: false,
      })
      .select()
      .single();

    if (subError) {
      console.error('Error creating subscription:', subError);
      return NextResponse.json(
        { error: 'Failed to create subscription' },
        { status: 500 }
      );
    }

    // Mark onboarding as complete
    await supabase
      .from('users')
      .update({ onboarding_completed: true })
      .eq('id', userId);

    // Initialize user session tracking
    await supabase
      .from('user_session_tracking')
      .upsert({
        user_id: userId,
        session_date: new Date().toISOString().split('T')[0],
        session_count: 0,
      });

    // Initialize user consumption metrics
    await supabase
      .from('user_consumption')
      .upsert({
        user_id: userId,
        metric_date: new Date().toISOString().split('T')[0],
        api_calls: 0,
        tokens_used: 0,
      });

    // Log the activation
    await supabase.from('admin_audit_log').insert({
      admin_user_id: userId,
      admin_email: session.user.email || 'unknown',
      action: 'trial_activated',
      target_user_id: userId,
      target_user_email: session.user.email,
      details: {
        tier: 'trial',
        expires_at: trialEndDate.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        tier: subscription.tier,
        status: subscription.status,
        expiresAt: subscription.expires_at,
      },
    });
  } catch (error) {
    console.error('Trial activation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
