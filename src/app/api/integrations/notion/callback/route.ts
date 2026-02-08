import { NextRequest, NextResponse } from 'next/server';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

/**
 * Render an HTML page that sends a postMessage to the parent/opener window
 * and closes the popup. Falls back to redirect if not in a popup.
 */
function popupResponse(success: boolean, error?: string): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const message = JSON.stringify({
    type: 'notion-oauth-complete',
    success,
    error: error || null,
  });

  const html = `<!DOCTYPE html>
<html>
<head><title>Notion Connection</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
  <div style="text-align: center; padding: 2rem;">
    <p>${success ? 'Notion connected successfully! This window will close.' : 'Connection failed: ' + (error || 'Unknown error')}</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage(${message}, '${appUrl}');
        setTimeout(function() { window.close(); }, 500);
      } else {
        // Not a popup — redirect back to chat
        window.location.href = '${appUrl}/chat?${success ? 'notion_connected=true' : 'notion_error=' + encodeURIComponent(error || 'unknown')}';
      }
    } catch (e) {
      window.location.href = '${appUrl}/chat?${success ? 'notion_connected=true' : 'notion_error=' + encodeURIComponent(error || 'unknown')}';
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
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
      return popupResponse(false, error);
    }

    if (!code || !state) {
      return popupResponse(false, 'Missing authorization parameters');
    }

    // Decode state to get userId
    let userId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;

      // Check timestamp (state should be recent - within 10 minutes)
      if (Date.now() - decoded.timestamp > 10 * 60 * 1000) {
        return popupResponse(false, 'Authorization expired. Please try again.');
      }
    } catch {
      return popupResponse(false, 'Invalid authorization state');
    }

    if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
      return popupResponse(false, 'Notion integration not configured');
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
      return popupResponse(false, 'Token exchange failed. Please try again.');
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
          ingestionStatus: 'idle',
          ingestionProgress: 0,
        },
      },
    });

    // Send success to popup opener and close
    return popupResponse(true);
  } catch (error) {
    console.error('Notion callback error:', error);
    return popupResponse(false, 'Connection failed. Please try again.');
  }
}
