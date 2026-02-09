import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getResend, RESEND_FROM } from '@/lib/resend';
import { ADMIN_EMAIL } from '@/lib/auth/config';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getBaseUrl() {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://zenna.anthonywestinc.com';
}

function buildEmailHtml(type: 'welcome' | 'reset', link: string): string {
  const isWelcome = type === 'welcome';
  const heading = isWelcome ? 'Welcome to Zenna' : 'Reset Your Password';
  const message = isWelcome
    ? 'You\'re one step away from your AI companion. Click the button below to set up your password and get started.'
    : 'We received a request to reset your password. Click the button below to choose a new password.';
  const buttonText = isWelcome ? 'Set Up Password' : 'Reset Password';
  const footer = isWelcome
    ? 'This link expires in 1 hour. If you didn\'t create this account, you can safely ignore this email.'
    : 'This link expires in 1 hour. If you didn\'t request a password reset, you can safely ignore this email.';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: #13131d; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden;">
              <!-- Header -->
              <tr>
                <td style="padding: 40px 32px 24px; text-align: center;">
                  <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px; font-weight: 300; letter-spacing: 0.2em;">ZENNA</h1>
                  <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px; letter-spacing: 0.1em;">YOUR AI COMPANION</p>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 0 32px 32px;">
                  <h2 style="margin: 0 0 16px; color: #ffffff; font-size: 20px; font-weight: 500;">${heading}</h2>
                  <p style="margin: 0 0 28px; color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.6;">${message}</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center">
                        <a href="${link}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;">${buttonText}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding: 0 32px 32px;">
                  <p style="margin: 0 0 16px; color: rgba(255,255,255,0.3); font-size: 12px; line-height: 1.5;">${footer}</p>
                  <p style="margin: 0; color: rgba(255,255,255,0.2); font-size: 11px;">If the button doesn't work, copy and paste this link into your browser:</p>
                  <p style="margin: 8px 0 0; word-break: break-all;"><a href="${link}" style="color: #8b5cf6; font-size: 11px; text-decoration: none;">${link}</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export async function POST(request: NextRequest) {
  try {
    const { email, forceReset } = await request.json();

    // Validate email format
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit: check if a token was sent to this email in the last 60 seconds
    const { data: recentToken } = await supabase
      .from('auth_tokens')
      .select('id, created_at')
      .eq('email', normalizedEmail)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (recentToken) {
      const tokenAge = Date.now() - new Date(recentToken.created_at).getTime();
      if (tokenAge < 60000) {
        return NextResponse.json(
          { success: false, error: 'Please wait before requesting another link' },
          { status: 429 }
        );
      }
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email, password_hash, auth_provider, email_verified')
      .eq('email', normalizedEmail)
      .single();

    let isNewUser = false;
    let hasPassword = false;

    if (existingUser) {
      hasPassword = !!existingUser.password_hash && existingUser.password_hash !== '';

      // If user has a password and this isn't a force reset, just tell the UI to show password field
      if (hasPassword && !forceReset) {
        return NextResponse.json({
          success: true,
          hasPassword: true,
          message: 'Enter your password to sign in',
        });
      }
    } else {
      // Create new user with empty password (will be set after email verification)
      isNewUser = true;
      const isAdmin = normalizedEmail === ADMIN_EMAIL;
      const role = isAdmin ? 'admin' : 'user';

      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: normalizedEmail,
          username: normalizedEmail.split('@')[0],
          password_hash: '',
          auth_provider: 'email',
          auth_provider_id: '',
          role,
          email_verified: false,
          first_login_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
          onboarding_completed: false,
          settings: {},
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating user:', createError);
        return NextResponse.json(
          { success: false, error: 'Failed to create account' },
          { status: 500 }
        );
      }

      // Initialize user memories metadata (same as OAuth signIn callback)
      await supabase.from('user_memories').insert({
        user_id: newUser.id,
        storage_location: 'active',
        memory_size_mb: 0,
        memory_count: 0,
      });
    }

    // Generate secure token
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token in auth_tokens table
    const { error: tokenError } = await supabase
      .from('auth_tokens')
      .insert({
        email: normalizedEmail,
        token,
        type: isNewUser ? 'email_verification' : 'password_reset',
        expires_at: expiresAt.toISOString(),
      });

    if (tokenError) {
      console.error('Error storing token:', tokenError);
      return NextResponse.json(
        { success: false, error: 'Failed to generate verification link' },
        { status: 500 }
      );
    }

    // Build the verification link
    const baseUrl = getBaseUrl();
    const link = `${baseUrl}/auth/set-password?token=${token}`;

    // Send email via Resend
    const resend = getResend();
    const emailType = isNewUser ? 'welcome' : 'reset';
    const subject = isNewUser
      ? 'Welcome to Zenna - Set Up Your Password'
      : 'Zenna - Reset Your Password';

    const { error: emailError } = await resend.emails.send({
      from: RESEND_FROM,
      to: normalizedEmail,
      subject,
      html: buildEmailHtml(emailType, link),
    });

    if (emailError) {
      console.error('Error sending email:', emailError);
      return NextResponse.json(
        { success: false, error: 'Failed to send verification email' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      hasPassword: false,
      isNewUser,
      message: 'Check your email for a verification link',
    });
  } catch (error) {
    console.error('Send link error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
