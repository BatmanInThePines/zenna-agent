import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Look up the token
    const { data: tokenRecord } = await supabase
      .from('auth_tokens')
      .select('id, email, type, expires_at, used_at')
      .eq('token', token)
      .single();

    if (!tokenRecord) {
      return NextResponse.json(
        { valid: false, error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    // Check if already used
    if (tokenRecord.used_at) {
      return NextResponse.json(
        { valid: false, error: 'This link has already been used' },
        { status: 400 }
      );
    }

    // Check if expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { valid: false, error: 'This link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // Look up the user
    const { data: user } = await supabase
      .from('users')
      .select('id, email, password_hash, auth_provider')
      .eq('email', tokenRecord.email)
      .single();

    if (!user) {
      return NextResponse.json(
        { valid: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const hasExistingPassword = !!user.password_hash && user.password_hash !== '';
    const isNewUser = tokenRecord.type === 'email_verification';

    return NextResponse.json({
      valid: true,
      email: user.email,
      hasExistingPassword,
      isNewUser,
    });
  } catch (error) {
    console.error('Verify token error:', error);
    return NextResponse.json(
      { valid: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
