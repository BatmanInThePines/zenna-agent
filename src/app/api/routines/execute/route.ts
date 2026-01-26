import { NextRequest, NextResponse } from 'next/server';
import { RoutineExecutor } from '@/core/providers/routines/routine-executor';

/**
 * POST /api/routines/execute
 *
 * Executes all due scheduled routines.
 * This endpoint should be called periodically by a cron job (e.g., every minute).
 *
 * For Vercel, you can use Vercel Cron:
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/routines/execute",
 *     "schedule": "* * * * *"
 *   }]
 * }
 *
 * Security: Uses a secret token to prevent unauthorized access.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (for production security)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // In production, require the cron secret
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('Unauthorized routine execution attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const executor = new RoutineExecutor({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    });

    const results = await executor.executeDueRoutines();

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Routine execution complete: ${successful} successful, ${failed} failed`);

    return NextResponse.json({
      executed: results.length,
      successful,
      failed,
      results,
    });
  } catch (error) {
    console.error('Routine execution error:', error);
    return NextResponse.json(
      { error: 'Failed to execute routines' },
      { status: 500 }
    );
  }
}

// Also support GET for simple cron services
export async function GET(request: NextRequest) {
  return POST(request);
}
