import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const { token, newPassword, confirmPassword, currentPassword } = await request.json();

    if (!token || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Passwords do not match' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Validate token
    const { data: tokenRecord } = await supabase
      .from('auth_tokens')
      .select('id, email, type, expires_at, used_at')
      .eq('token', token)
      .single();

    if (!tokenRecord) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    if (tokenRecord.used_at) {
      return NextResponse.json(
        { success: false, error: 'This link has already been used' },
        { status: 400 }
      );
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // Look up user
    const { data: user } = await supabase
      .from('users')
      .select('id, email, password_hash')
      .eq('email', tokenRecord.email)
      .single();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // If user has existing password, verify current password
    const hasExistingPassword = !!user.password_hash && user.password_hash !== '';
    if (hasExistingPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, error: 'Current password is required' },
          { status: 400 }
        );
      }

      const currentValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!currentValid) {
        return NextResponse.json(
          { success: false, error: 'Current password is incorrect' },
          { status: 400 }
        );
      }
    }

    // Hash new password (12 rounds, matching existing pattern)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user: set password, mark email as verified
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        email_verified: true,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating password:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update password' },
        { status: 500 }
      );
    }

    // Mark token as used
    await supabase
      .from('auth_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRecord.id);

    return NextResponse.json({
      success: true,
      email: user.email,
    });
  } catch (error) {
    console.error('Set password error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
