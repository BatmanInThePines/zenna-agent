/**
 * API Route: Suspend/Unsuspend User
 * POST /api/admin/users/[id]/suspend - Suspend user
 * DELETE /api/admin/users/[id]/suspend - Unsuspend user
 *
 * Admin-only endpoint for managing user suspension status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { isAdmin, isFather, FATHER_EMAIL } from '@/lib/utils/permissions';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Suspend user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { id: targetUserId } = await params;
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(session.user.role) && !isFather(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get target user
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Cannot suspend father
    if (targetUser.email === FATHER_EMAIL) {
      return NextResponse.json(
        { error: 'Cannot suspend the primary administrator' },
        { status: 403 }
      );
    }

    // Update subscription status
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({ status: 'suspended' })
      .eq('user_id', targetUserId)
      .in('status', ['active', 'expired']);

    if (updateError) {
      console.error('Error suspending user:', updateError);
      return NextResponse.json({ error: 'Failed to suspend user' }, { status: 500 });
    }

    // Log the action
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'user_suspended',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {},
    });

    return NextResponse.json({
      success: true,
      message: 'User suspended',
    });
  } catch (error) {
    console.error('Suspend error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Unsuspend user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { id: targetUserId } = await params;
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(session.user.role) && !isFather(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get target user
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update subscription status
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({ status: 'active' })
      .eq('user_id', targetUserId)
      .eq('status', 'suspended');

    if (updateError) {
      console.error('Error unsuspending user:', updateError);
      return NextResponse.json({ error: 'Failed to unsuspend user' }, { status: 500 });
    }

    // Log the action
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'user_unsuspended',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {},
    });

    return NextResponse.json({
      success: true,
      message: 'User unsuspended',
    });
  } catch (error) {
    console.error('Unsuspend error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
