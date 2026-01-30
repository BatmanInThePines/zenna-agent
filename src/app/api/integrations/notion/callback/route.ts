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
    const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID;
    const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET;
    const NOTION_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/notion/callback`;

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Handle OAuth errors
    if (error) {
      console.error('Notion OAuth error:', error);
      return NextResponse.redirect(
        new URL(`/chat?notion_error=${encodeURIComponent(error)}`, process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL('/chat?notion_error=missing_params', process.env.NEXT_PUBLIC_APP_URL!)
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
          new URL('/chat?notion_error=expired_state', process.env.NEXT_PUBLIC_APP_URL!)
        );
      }
    } catch {
      return NextResponse.redirect(
        new URL('/chat?notion_error=invalid_state', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL('/chat?notion_error=not_configured', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NOTION_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Notion token exchange failed:', errorText);
      return NextResponse.redirect(
        new URL('/chat?notion_error=token_exchange_failed', process.env.NEXT_PUBLIC_APP_URL!)
      );
    }

    const tokenData = await tokenResponse.json();

    // Get current user settings to preserve existing external context
    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(userId);
    const existingExternalContext = user?.settings.externalContext || {};

    // Store access token in user settings
    await identityStore.updateSettings(userId, {
      externalContext: {
        ...existingExternalContext,
        notion: {
          enabled: true,
          token: tokenData.access_token,
          workspaceId: tokenData.workspace_id,
          workspaceName: tokenData.workspace_name,
          botId: tokenData.bot_id,
          connectedAt: Date.now(),
          ingestionStatus: 'idle', // 'idle' | 'processing' | 'completed' | 'error'
          ingestionProgress: 0,
        },
      },
    });

    // Redirect back to chat with success, opening settings to integrations tab
    return NextResponse.redirect(
      new URL('/chat?notion_connected=true&open_settings=integrations', process.env.NEXT_PUBLIC_APP_URL!)
    );
  } catch (error) {
    console.error('Notion callback error:', error);
    return NextResponse.redirect(
      new URL('/chat?notion_error=callback_failed', process.env.NEXT_PUBLIC_APP_URL!)
    );
  }
}
