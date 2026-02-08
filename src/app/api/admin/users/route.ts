/**
 * API Route: List All Users (Admin)
 * GET /api/admin/users
 *
 * Returns list of all users with their metadata (not their private data).
 * Only accessible by admin users.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { isAdmin, isFather } from '@/lib/utils/permissions';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    // Get authenticated user
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin access
    if (!isAdmin(session.user.role) && !isFather(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch users with subscription and consumption data
    // Include settings to check for integration pairings (Notion, Hue, etc.)
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        email,
        role,
        created_at,
        last_login_at,
        settings
      `)
      .order('created_at', { ascending: false });

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Fetch subscriptions for all users
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('user_id, tier, status, expires_at');

    // Fetch CSAT averages for all users
    const { data: csatData } = await supabase
      .from('user_csat')
      .select('user_id, score');

    // Fetch consumption metrics (aggregated)
    const { data: consumptionData } = await supabase
      .from('user_consumption')
      .select('user_id, api_calls, tokens_used');

    // Build user data map
    const subscriptionMap = new Map(
      subscriptions?.map((s) => [s.user_id, s]) || []
    );

    // Calculate CSAT averages per user
    const csatMap = new Map<string, { total: number; count: number }>();
    csatData?.forEach((c) => {
      const existing = csatMap.get(c.user_id) || { total: 0, count: 0 };
      csatMap.set(c.user_id, {
        total: existing.total + (c.score || 0),
        count: existing.count + 1,
      });
    });

    // Aggregate consumption per user
    const consumptionMap = new Map<string, { apiCalls: number; tokensUsed: number }>();
    consumptionData?.forEach((c) => {
      const existing = consumptionMap.get(c.user_id) || { apiCalls: 0, tokensUsed: 0 };
      consumptionMap.set(c.user_id, {
        apiCalls: existing.apiCalls + (c.api_calls || 0),
        tokensUsed: existing.tokensUsed + (c.tokens_used || 0),
      });
    });

    // Build response
    const usersWithData = users?.map((user) => {
      const subscription = subscriptionMap.get(user.id);
      const csatStats = csatMap.get(user.id);
      const consumption = consumptionMap.get(user.id) || { apiCalls: 0, tokensUsed: 0 };

      // Extract integration pairing status from user settings (metadata only, never content)
      const userSettings = (user.settings || {}) as Record<string, unknown>;
      const externalContext = (userSettings.externalContext || {}) as Record<string, unknown>;
      const notionConfig = (externalContext.notion || null) as {
        enabled?: boolean;
        workspaceName?: string;
        connectedAt?: number;
        capabilities?: { read?: boolean; write?: boolean; create?: boolean };
      } | null;

      return {
        id: user.id,
        email: user.email,
        role: user.role || 'user',
        subscription: subscription
          ? {
              tier: subscription.tier,
              status: subscription.status,
              expiresAt: subscription.expires_at,
            }
          : null,
        csatScore: csatStats ? csatStats.total / csatStats.count : 0,
        consumption,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        // Integration pairings — metadata only, never tokens or content
        integrations: {
          notion: notionConfig?.enabled ? {
            paired: true,
            workspaceName: notionConfig.workspaceName || null,
            connectedAt: notionConfig.connectedAt || null,
            capabilities: notionConfig.capabilities || { read: true, write: true, create: true },
          } : { paired: false },
        },
      };
    });

    return NextResponse.json({ users: usersWithData });
  } catch (error) {
    console.error('Error in users list:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
