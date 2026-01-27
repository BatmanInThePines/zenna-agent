/**
 * ZENNA Avatar V2 - Reconstruction Status API
 *
 * Cloud-compatible status endpoint using Supabase.
 * Works on Vercel serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import { getJobForUser } from '@/lib/avatar/supabase-reconstruction-store';
import { checkAndProcessPrediction } from '@/lib/avatar/replicate-reconstruction';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get current user from session token.
 */
async function getCurrentUser(): Promise<{ id: string; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('zenna-session')?.value;

  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(
      process.env.AUTH_SECRET || 'zenna-default-secret-change-me'
    );
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = (payload.userId as string) || (payload.sub as string);
    if (!userId) return null;
    return {
      id: userId,
      username: (payload.username as string) || userId,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// GET /api/avatar/reconstruct/status?jobId=xxx
// Get status of a specific reconstruction job
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get job ID from query params
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // Get job from Supabase (verifies ownership)
    let job = await getJobForUser(jobId, user.id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Polling fallback: if job is stuck in processing with a prediction ID,
    // check Replicate directly and process the result
    if (
      job.status === 'processing' &&
      job.replicate_prediction_id &&
      job.progress <= 20
    ) {
      const updatedAt = new Date(job.updated_at).getTime();
      const stuckThresholdMs = 30_000; // 30 seconds
      const isStuck = Date.now() - updatedAt > stuckThresholdMs;

      if (isStuck) {
        console.log(`Job ${jobId} appears stuck, polling Replicate prediction ${job.replicate_prediction_id}`);
        const result = await checkAndProcessPrediction(jobId, job.replicate_prediction_id);
        if (result.processed) {
          // Re-fetch updated job
          job = (await getJobForUser(jobId, user.id))!;
        }
      }
    }

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        imageCount: job.image_count,
        method: job.method,
        outputModelUrl: job.output_model_url,
        outputThumbnailUrl: job.output_thumbnail_url,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
      },
    });
  } catch (error) {
    console.error('Reconstruction status error:', error);
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
