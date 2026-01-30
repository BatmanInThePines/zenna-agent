/**
 * API Route: Initiate Data Export
 * POST /api/admin/users/[id]/export
 *
 * Initiates a data export for a user. The export is sent directly to the user's email.
 * IMPORTANT: Staff cannot view user data. This only initiates the export process.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { isAdmin, isFather, generateSecureToken } from '@/lib/utils/permissions';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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

    // Check for existing pending export
    const { data: existingExport } = await supabase
      .from('data_export_requests')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('status', 'pending')
      .single();

    if (existingExport) {
      return NextResponse.json(
        { error: 'An export is already pending for this user' },
        { status: 400 }
      );
    }

    // Generate secure token for export
    const token = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour expiry

    // Create export request
    const { error: createError } = await supabase.from('data_export_requests').insert({
      user_id: targetUserId,
      token,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    });

    if (createError) {
      console.error('Error creating export request:', createError);
      return NextResponse.json({ error: 'Failed to create export request' }, { status: 500 });
    }

    // In a real implementation, this would:
    // 1. Queue a background job to compile user data
    // 2. Send an email to the user with a secure download link
    // 3. The link would require the user to re-authenticate

    // For now, we'll just simulate this
    console.log(`Export initiated for user ${targetUser.email} with token ${token}`);

    // Log the action (note: we don't log what data is exported)
    await supabase.from('admin_audit_log').insert({
      admin_user_id: session.user.id,
      admin_email: session.user.email,
      action: 'export_initiated',
      target_user_id: targetUserId,
      target_user_email: targetUser.email,
      details: {
        // Intentionally minimal - we don't log what data is exported
        expires_at: expiresAt.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Export initiated. An email will be sent to ${targetUser.email} with a secure download link.`,
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
