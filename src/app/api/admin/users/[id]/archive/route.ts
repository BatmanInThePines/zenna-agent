/**
 * API Route: Archive/Restore User
 * POST /api/admin/users/[id]/archive - Archive user (move memories to offline storage)
 * DELETE /api/admin/users/[id]/archive - Restore user (optionally restore memories)
 *
 * Admin-only endpoint for managing user archive status.
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

// Archive user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const supabase = getSupabaseClient();
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Cannot archive father
    if (targetUser.email === FATHER_EMAIL) {
      return NextResponse.json(
        { error: 'Cannot archive the primary administrator' },
        { status: 403 }
      );
    }

    // Update subscription status to archived
    const { error: subError } = await supabase
      .from('subscriptions')
      .update({ status: 'archived' })
      .eq('user_id', targetUserId)
      .in('status', ['active', 'suspended', 'expired']);

    if (subError) {
      console.error('Error archiving subscription:', subError);
    }

    // Update memories to archived storage
    const { error: memError } = await supabase
      .from('user_memories')
      .update({
        storage_location: 'archived',
        archived_at: new Date().toISOString(),
      })
      .eq('user_id', targetUserId);

    if (memError) {
      console.error('Error archiving memories:', memError);
    }

    // Log the action
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'user_archived',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {
        memories_archived: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'User archived. Memories moved to offline storage.',
    });
  } catch (error) {
    console.error('Archive error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Restore user from archive
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetUserId } = await params;
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(session.user.role) && !isFather(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { restoreMemories = false } = body;

    // Get target user
    const supabase = getSupabaseClient();
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update subscription status to active
    const { error: subError } = await supabase
      .from('subscriptions')
      .update({ status: 'active' })
      .eq('user_id', targetUserId)
      .eq('status', 'archived');

    if (subError) {
      console.error('Error restoring subscription:', subError);
    }

    // Optionally restore memories
    if (restoreMemories) {
      const { error: memError } = await supabase
        .from('user_memories')
        .update({
          storage_location: 'active',
          archived_at: null,
        })
        .eq('user_id', targetUserId);

      if (memError) {
        console.error('Error restoring memories:', memError);
      }
    }

    // Log the action
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'user_restored',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {
        memories_restored: restoreMemories,
      },
    });

    return NextResponse.json({
      success: true,
      message: restoreMemories
        ? 'User restored with memories'
        : 'User restored (memories remain archived)',
    });
  } catch (error) {
    console.error('Restore error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
