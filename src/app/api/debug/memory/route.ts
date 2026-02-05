/**
 * Debug Memory API
 *
 * Super Admin endpoint to debug memory service configuration and status.
 * This helps verify:
 * 1. What userId is being used for the current user
 * 2. Whether Qdrant is properly initialized
 * 3. Whether embeddings are working correctly
 * 4. What memories exist for the user
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { createMemoryService } from '@/core/services/memory-service';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

// Direct Qdrant query helper
async function queryQdrantDirect(): Promise<{
  collectionInfo: unknown;
  samplePoints: unknown[];
  uniqueUserIds: string[];
}> {
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const collection = process.env.QDRANT_COLLECTION || 'zenna-memories';

  if (!qdrantUrl) {
    throw new Error('QDRANT_URL not configured');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (qdrantApiKey) {
    headers['api-key'] = qdrantApiKey;
  }

  // Get collection info
  const collectionRes = await fetch(`${qdrantUrl}/collections/${collection}`, {
    method: 'GET',
    headers,
  });
  const collectionInfo = await collectionRes.json();

  // Get some sample points to see what userIds are stored
  const scrollRes = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      limit: 20,
      with_payload: true,
      with_vector: false,
    }),
  });
  const scrollData = await scrollRes.json();
  const samplePoints = scrollData.result?.points || [];

  // Extract unique userIds
  const uniqueUserIds = [...new Set(samplePoints.map((p: { payload: { userId: string } }) => p.payload?.userId).filter(Boolean))] as string[];

  return {
    collectionInfo: collectionInfo.result,
    samplePoints: samplePoints.slice(0, 5).map((p: { id: string; payload: { userId: string; content: string; type: string } }) => ({
      id: p.id,
      userId: p.payload?.userId,
      contentPreview: p.payload?.content?.substring(0, 80) + '...',
      type: p.payload?.type,
    })),
    uniqueUserIds,
  };
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

    // Get current user details
    const user = await identityStore.getUser(session.user.id);

    // Initialize memory service
    const memoryService = createMemoryService();
    await memoryService.initialize();

    // Test memory search
    const testQuery = 'family';
    const testResults = await memoryService.searchMemories(session.user.id, testQuery, {
      topK: 10,
      threshold: 0.3, // Lower threshold to see more results
    });

    // Get direct Qdrant info
    let qdrantDirect = null;
    try {
      qdrantDirect = await queryQdrantDirect();
    } catch (e) {
      qdrantDirect = { error: e instanceof Error ? e.message : String(e) };
    }

    // Get environment config (redacted)
    const envConfig = {
      hasQdrantUrl: !!process.env.QDRANT_URL,
      qdrantUrl: process.env.QDRANT_URL ? process.env.QDRANT_URL.substring(0, 50) + '...' : null,
      hasQdrantApiKey: !!process.env.QDRANT_API_KEY,
      qdrantCollection: process.env.QDRANT_COLLECTION,
      embeddingProvider: process.env.EMBEDDING_PROVIDER || 'gemini (default)',
      hasGoogleApiKey: !!process.env.GOOGLE_AI_API_KEY,
      hasOpenAIApiKey: !!process.env.OPENAI_API_KEY,
      vectorProvider: process.env.VECTOR_PROVIDER || 'qdrant (default)',
    };

    return NextResponse.json({
      status: 'ok',
      currentUser: {
        internalId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      memoryService: {
        vectorProvider: memoryService.getVectorProvider(),
        hasLongTermMemory: memoryService.hasLongTermMemory(),
      },
      envConfig,
      qdrantDirect,
      testSearch: {
        query: testQuery,
        resultsCount: testResults.length,
        results: testResults.map((r) => ({
          score: r.score,
          type: r.type,
          contentPreview: r.content.substring(0, 100) + '...',
        })),
      },
      note: 'If uniqueUserIds does not include your internalId, memories were stored with a different userId',
    });
  } catch (error) {
    console.error('Debug memory error:', error);
    return NextResponse.json({
      error: 'Failed to debug memory',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
