import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

// Step 1: Initiate OAuth - returns the authorization URL
export async function GET() {
  try {
    const HUE_CLIENT_ID = process.env.HUE_CLIENT_ID;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    if (!HUE_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Hue integration not configured. Contact administrator.' },
        { status: 500 }
      );
    }

    // Generate state for CSRF protection (store userId in state)
    const state = Buffer.from(JSON.stringify({
      userId,
      timestamp: Date.now(),
    })).toString('base64');

    // Philips Hue OAuth authorization URL
    const authUrl = new URL('https://api.meethue.com/v2/oauth2/authorize');
    authUrl.searchParams.set('client_id', HUE_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    return NextResponse.json({
      authUrl: authUrl.toString(),
      message: 'Redirect user to this URL to authorize Hue access',
    });
  } catch (error) {
    console.error('Hue OAuth init error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Hue connection' },
      { status: 500 }
    );
  }
}

// Step 2: Check connection status
export async function POST() {
  try {
    const HUE_CLIENT_ID = process.env.HUE_CLIENT_ID;
    const HUE_CLIENT_SECRET = process.env.HUE_CLIENT_SECRET;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const identityStore = getIdentityStore();

    // Get user's Hue credentials
    const user = await identityStore.getUser(userId);
    const hueConfig = user?.settings.integrations?.hue;

    if (!hueConfig?.accessToken) {
      return NextResponse.json({
        connected: false,
        message: 'Not connected to Hue',
      });
    }

    // Verify token is still valid by making a test request
    try {
      const response = await fetch('https://api.meethue.com/route/api/0/config', {
        headers: {
          Authorization: `Bearer ${hueConfig.accessToken}`,
        },
      });

      if (response.ok) {
        return NextResponse.json({
          connected: true,
          username: hueConfig.username,
        });
      }

      // Token expired - try to refresh
      if (response.status === 401 && hueConfig.refreshToken) {
        const refreshed = await refreshHueToken(userId, hueConfig.refreshToken, HUE_CLIENT_ID, HUE_CLIENT_SECRET);
        if (refreshed) {
          return NextResponse.json({
            connected: true,
            username: hueConfig.username,
            message: 'Token refreshed',
          });
        }
      }

      return NextResponse.json({
        connected: false,
        message: 'Hue connection expired. Please reconnect.',
      });
    } catch {
      return NextResponse.json({
        connected: false,
        message: 'Failed to verify Hue connection',
      });
    }
  } catch (error) {
    console.error('Hue status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check Hue connection' },
      { status: 500 }
    );
  }
}

async function refreshHueToken(
  userId: string,
  refreshToken: string,
  clientId: string | undefined,
  clientSecret: string | undefined
): Promise<boolean> {
  if (!clientId || !clientSecret) {
    return false;
  }

  try {
    const response = await fetch('https://api.meethue.com/v2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      return false;
    }

    const tokens = await response.json();

    // Update stored tokens
    const identityStore = getIdentityStore();
    await identityStore.updateSettings(userId, {
      integrations: {
        hue: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        },
      },
    });

    return true;
  } catch {
    return false;
  }
}
