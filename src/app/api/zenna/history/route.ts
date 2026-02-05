import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService, MemoryService } from '@/core/services/memory-service';

// Singleton memory service instance
let memoryServiceInstance: MemoryService | null = null;

async function getMemoryService(): Promise<MemoryService> {
  if (!memoryServiceInstance) {
    memoryServiceInstance = createMemoryService();
    await memoryServiceInstance.initialize();
  }
  return memoryServiceInstance;
}

/**
 * GET /api/zenna/history
 *
 * Retrieves the user's conversation history for display in the UI.
 * This is separate from the LLM context - it's for showing past messages.
 *
 * Query params:
 * - limit: Number of messages to return (default: 100, max: 500)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

    // Get memory service
    const memoryService = await getMemoryService();

    // Fetch conversation history
    const history = await memoryService.getConversationHistory(userId);

    // Transform to UI-friendly format and apply limit
    // History is ordered oldest-first from DB, so take last N items
    const recentHistory = history.slice(-limit);

    const messages = recentHistory
      .filter(turn => turn.role === 'user' || turn.role === 'assistant')
      .map((turn, index) => ({
        id: `${turn.created_at}-${index}`, // Create a pseudo-id from timestamp
        role: turn.role as 'user' | 'assistant',
        content: turn.content,
        timestamp: turn.created_at,
      }));

    return NextResponse.json({
      messages,
      total: history.length,
      returned: messages.length,
    });
  } catch (error) {
    console.error('History API error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
