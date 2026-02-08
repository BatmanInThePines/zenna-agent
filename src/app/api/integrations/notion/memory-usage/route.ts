import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createMemoryService } from '@/core/services/memory-service';
import { getMemoryLimit } from '@/lib/utils/permissions';

/**
 * GET /api/integrations/notion/memory-usage
 *
 * Returns the user's current memory usage and quota for display
 * in the Settings UI when considering Notion sync.
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Get user's subscription tier from session (populated by NextAuth JWT callback)
    const tier = session.user.subscription?.tier || 'trial';
    const limitMB = getMemoryLimit(tier);

    // Estimate current usage
    const memoryService = createMemoryService();
    await memoryService.initialize();
    const usageMB = await memoryService.estimateUserMemoryUsageMB(userId);

    return NextResponse.json({
      usageMB: Math.round(usageMB * 100) / 100,
      limitMB,
      tier,
    });
  } catch (error) {
    console.error('Memory usage check error:', error);
    return NextResponse.json(
      { error: 'Failed to check memory usage' },
      { status: 500 }
    );
  }
}
