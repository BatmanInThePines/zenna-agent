import { NextRequest, NextResponse } from 'next/server';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

// OAuth callback - exchanges authorization code for access token
export async function GET(request: NextRequest) {
  try {
    const HUE_CLIENT_ID = process.env.HUE_CLIENT_ID;
    const HUE_CLIENT_SECRET = process.env.HUE_CLIENT_SECRET;

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth errors
    if (error) {
      console.error('Hue OAuth error:', error);
      return NextResponse.redirect(
        new URL(`/chat?hue_error=${encodeURIComponent(error)}`, process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/chat?hue_error=missing_params', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    // Decode state to get userId
    let userId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;

      // Check timestamp (state should be recent - within 10 minutes)
      if (Date.now() - decoded.timestamp > 10 * 60 * 1000) {
        return NextResponse.redirect(
          new URL('/chat?hue_error=expired_state', process.env.NEXT_PUBLIC_APP_URL!)
        );
      }
    } catch {
      return NextResponse.redirect(
        new URL('/chat?hue_error=invalid_state', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    if (!HUE_CLIENT_ID || !HUE_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL('/chat?hue_error=not_configured', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.meethue.com/v2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${HUE_CLIENT_ID}:${HUE_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Hue token exchange failed:', errorText);
      return NextResponse.redirect(
        new URL('/chat?hue_error=token_exchange_failed', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    const tokens = await tokenResponse.json();

    // Get the whitelisted username for the Remote API
    // This links the OAuth token to a bridge username
    const usernameResponse = await fetch('https://api.meethue.com/route/api/0/config', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkbutton: true,
      }),
    });

    // Create a username on the bridge
    const createUserResponse = await fetch('https://api.meethue.com/route/api', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        devicetype: 'zenna#agent',
      }),
    });

    let username: string | undefined;
    if (createUserResponse.ok) {
      const userResult = await createUserResponse.json();
      if (userResult[0]?.success?.username) {
        username = userResult[0].success.username;
      }
    }

    // Store tokens and username in user settings
    const identityStore = getIdentityStore();
    await identityStore.updateSettings(userId, {
      integrations: {
        hue: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          username: username,
        },
      },
    });

    // Redirect back to chat with success, opening settings to integrations tab
    return NextResponse.redirect(
      new URL('/chat?hue_connected=true&open_settings=integrations', process.env.NEXT_PUBLIC_APP_URL!)
    );
  } catch (error) {
    console.error('Hue callback error:', error);
    return NextResponse.redirect(
      new URL('/chat?hue_error=callback_failed', process.env.NEXT_PUBLIC_APP_URL!)
    );
  }
}
