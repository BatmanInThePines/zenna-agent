/**
 * API Route: Change User Role (Father Only)
 * PATCH /api/admin/users/[id]/role
 *
 * Only anthony@anthonywestinc.com can change user roles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { canManageRoles, AVAILABLE_ROLES, FATHER_EMAIL, type UserRole } from '@/lib/utils/permissions';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function PATCH(
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

    // Only father can change roles
    if (!canManageRoles(session.user.email)) {
      return NextResponse.json(
        { error: 'Only the primary administrator can change user roles' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { role } = body;

    // Validate role
    if (!AVAILABLE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${AVAILABLE_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    // Get target user
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', targetUserId)
      .single();

    if (fetchError || !targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Cannot change father's role
    if (targetUser.email === FATHER_EMAIL) {
      return NextResponse.json(
        { error: 'Cannot change the role of the primary administrator' },
        { status: 403 }
      );
    }

    // Update role
    const { error: updateError } = await supabase
      .from('users')
      .update({ role })
      .eq('id', targetUserId);

    if (updateError) {
      console.error('Error updating role:', updateError);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }

    // Log the action
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'role_change',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {
        previous_role: targetUser.role,
        new_role: role,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Role updated to ${role}`,
    });
  } catch (error) {
    console.error('Role change error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
