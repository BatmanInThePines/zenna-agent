import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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
    const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID;
    const NOTION_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/notion/callback`;

    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();
    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!NOTION_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Notion integration not configured. Contact administrator.' },
        { status: 500 }
      );
    }

    // Generate state for CSRF protection (store userId in state)
    const state = Buffer.from(JSON.stringify({
      userId: payload.userId,
      timestamp: Date.now(),
    })).toString('base64');

    // Notion OAuth authorization URL
    const authUrl = new URL('https://api.notion.com/v1/oauth/authorize');
    authUrl.searchParams.set('client_id', NOTION_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('owner', 'user');
    authUrl.searchParams.set('redirect_uri', NOTION_REDIRECT_URI);
    authUrl.searchParams.set('state', state);

    return NextResponse.json({
      authUrl: authUrl.toString(),
      message: 'Redirect user to this URL to authorize Notion access',
    });
  } catch (error) {
    console.error('Notion OAuth init error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Notion connection' },
      { status: 500 }
    );
  }
}

// Step 2: Check connection status and get available pages
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();
    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's Notion credentials
    const user = await identityStore.getUser(payload.userId);
    const notionConfig = user?.settings.externalContext?.notion;

    if (!notionConfig?.token) {
      return NextResponse.json({
        connected: false,
        message: 'Not connected to Notion',
      });
    }

    // Verify token is still valid by fetching user info
    try {
      const response = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${notionConfig.token}`,
          'Notion-Version': '2022-06-28',
        },
      });

      if (response.ok) {
        const userData = await response.json();

        // Fetch available pages/databases the user has access to
        const searchResponse = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${notionConfig.token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: { property: 'object', value: 'page' },
            page_size: 100,
          }),
        });

        let pages: Array<{ id: string; title: string; type: string }> = [];
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          pages = searchData.results.map((page: NotionPage) => ({
            id: page.id,
            title: getPageTitle(page),
            type: page.object,
          }));
        }

        return NextResponse.json({
          connected: true,
          user: {
            name: userData.name,
            avatarUrl: userData.avatar_url,
          },
          workspaceName: notionConfig.workspaceName,
          pages,
          ingestionStatus: notionConfig.ingestionStatus,
          ingestionProgress: notionConfig.ingestionProgress,
        });
      }

      return NextResponse.json({
        connected: false,
        message: 'Notion connection expired. Please reconnect.',
      });
    } catch {
      return NextResponse.json({
        connected: false,
        message: 'Failed to verify Notion connection',
      });
    }
  } catch (error) {
    console.error('Notion status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check Notion connection' },
      { status: 500 }
    );
  }
}

// Helper to extract page title from Notion page object
interface NotionPage {
  id: string;
  object: string;
  properties?: {
    title?: {
      title?: Array<{ plain_text: string }>;
    };
    Name?: {
      title?: Array<{ plain_text: string }>;
    };
  };
}

function getPageTitle(page: NotionPage): string {
  const titleProp = page.properties?.title || page.properties?.Name;
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  return 'Untitled';
}
