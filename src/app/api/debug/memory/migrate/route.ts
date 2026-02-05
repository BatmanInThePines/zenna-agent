/**
 * Memory Migration API
 *
 * Super Admin endpoint to migrate memories from one userId to another.
 * This is useful when memories were stored with the wrong userId.
 */

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

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();

    // Check if user is Father (Super Admin)
    const isFather = await identityStore.isFather(session.user.id);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Admin access only' }, { status: 403 });
    }

    const { fromUserId, toUserId } = await request.json();

    if (!fromUserId || !toUserId) {
      return NextResponse.json({ error: 'fromUserId and toUserId required' }, { status: 400 });
    }

    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;
    const collection = process.env.QDRANT_COLLECTION || 'zenna-memories';

    if (!qdrantUrl) {
      return NextResponse.json({ error: 'QDRANT_URL not configured' }, { status: 500 });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (qdrantApiKey) {
      headers['api-key'] = qdrantApiKey;
    }

    // First, scroll through all points with the fromUserId
    const scrollRes = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter: {
          must: [{ key: 'userId', match: { value: fromUserId } }],
        },
        limit: 1000,
        with_payload: true,
        with_vector: true,
      }),
    });

    const scrollData = await scrollRes.json();
    const points = scrollData.result?.points || [];

    if (points.length === 0) {
      return NextResponse.json({
        success: true,
        message: `No memories found for userId: ${fromUserId}`,
        migratedCount: 0,
      });
    }

    // Update each point with the new userId
    const updatedPoints = points.map((p: { id: string; vector: number[]; payload: Record<string, unknown> }) => ({
      id: p.id,
      vector: p.vector,
      payload: {
        ...p.payload,
        userId: toUserId,
        migratedFrom: fromUserId,
        migratedAt: new Date().toISOString(),
      },
    }));

    // Upsert the updated points
    const upsertRes = await fetch(`${qdrantUrl}/collections/${collection}/points`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        points: updatedPoints,
      }),
    });

    if (!upsertRes.ok) {
      const error = await upsertRes.text();
      return NextResponse.json({ error: `Failed to migrate: ${error}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${points.length} memories from ${fromUserId} to ${toUserId}`,
      migratedCount: points.length,
    });
  } catch (error) {
    console.error('Memory migration error:', error);
    return NextResponse.json({
      error: 'Failed to migrate memories',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
