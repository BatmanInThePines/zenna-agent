/**
 * Auto-Fix Memory API
 *
 * Super Admin endpoint that automatically:
 * 1. Detects userId mismatches between current session and stored memories
 * 2. Migrates memories from old userId to current userId
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

export async function POST() {
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

    const currentUserId = session.user.id;
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

    // Step 1: Get all unique userIds in the collection
    const scrollRes = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        limit: 100,
        with_payload: true,
        with_vector: false,
      }),
    });
    const scrollData = await scrollRes.json();
    const allPoints = scrollData.result?.points || [];

    // Find unique userIds that are NOT the current user
    const otherUserIds = [...new Set(
      allPoints
        .map((p: { payload: { userId: string } }) => p.payload?.userId)
        .filter((id: string) => id && id !== currentUserId)
    )] as string[];

    if (otherUserIds.length === 0) {
      // Check if current user has any memories
      const currentUserPoints = allPoints.filter(
        (p: { payload: { userId: string } }) => p.payload?.userId === currentUserId
      );

      return NextResponse.json({
        success: true,
        message: currentUserPoints.length > 0
          ? `No migration needed. Found ${currentUserPoints.length} memories for current user.`
          : 'No memories found in the collection.',
        currentUserId,
        memoriesCount: currentUserPoints.length,
      });
    }

    // Step 2: Migrate all memories from other userIds to current user
    let totalMigrated = 0;
    const migrations: { fromUserId: string; count: number }[] = [];

    for (const oldUserId of otherUserIds) {
      // Get all points for this old userId
      const oldUserScrollRes = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            must: [{ key: 'userId', match: { value: oldUserId } }],
          },
          limit: 1000,
          with_payload: true,
          with_vector: true,
        }),
      });

      const oldUserData = await oldUserScrollRes.json();
      const pointsToMigrate = oldUserData.result?.points || [];

      if (pointsToMigrate.length === 0) continue;

      // Update each point with the new userId
      const updatedPoints = pointsToMigrate.map((p: { id: string; vector: number[]; payload: Record<string, unknown> }) => ({
        id: p.id,
        vector: p.vector,
        payload: {
          ...p.payload,
          userId: currentUserId,
          migratedFrom: oldUserId,
          migratedAt: new Date().toISOString(),
        },
      }));

      // Upsert the updated points
      const upsertRes = await fetch(`${qdrantUrl}/collections/${collection}/points`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ points: updatedPoints }),
      });

      if (upsertRes.ok) {
        totalMigrated += pointsToMigrate.length;
        migrations.push({ fromUserId: oldUserId, count: pointsToMigrate.length });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${totalMigrated} memories to your account`,
      currentUserId,
      migrations,
      totalMigrated,
    });
  } catch (error) {
    console.error('Auto-fix memory error:', error);
    return NextResponse.json({
      error: 'Failed to auto-fix memories',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

export async function GET() {
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

    const currentUserId = session.user.id;
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

    // Get sample points to analyze
    const scrollRes = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        limit: 100,
        with_payload: true,
        with_vector: false,
      }),
    });
    const scrollData = await scrollRes.json();
    const allPoints = scrollData.result?.points || [];

    // Analyze userIds
    const userIdCounts: Record<string, number> = {};
    for (const point of allPoints) {
      const uid = point.payload?.userId || 'unknown';
      userIdCounts[uid] = (userIdCounts[uid] || 0) + 1;
    }

    const needsMigration = Object.keys(userIdCounts).some(uid => uid !== currentUserId && uid !== 'unknown');
    const currentUserMemories = userIdCounts[currentUserId] || 0;

    return NextResponse.json({
      currentUserId,
      currentUserEmail: session.user.email,
      totalMemories: allPoints.length,
      currentUserMemories,
      userIdBreakdown: userIdCounts,
      needsMigration,
      instruction: needsMigration
        ? 'POST to this endpoint to automatically migrate all memories to your current userId'
        : 'No migration needed',
    });
  } catch (error) {
    console.error('Auto-fix check error:', error);
    return NextResponse.json({
      error: 'Failed to check memories',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
