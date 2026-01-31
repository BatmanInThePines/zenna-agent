/**
 * ZENNA Avatar V2 - Reconstruction Status API
 *
 * Cloud-compatible status endpoint using Supabase.
 * Works on Vercel serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getJobForUser } from '@/lib/avatar/supabase-reconstruction-store';
import { checkAndProcessPrediction } from '@/lib/avatar/replicate-reconstruction';

// Allow up to 60s on Vercel Pro (polling fallback may need to download + process GLB)
export const maxDuration = 60;

// =============================================================================
// GET /api/avatar/reconstruct/status?jobId=xxx
// Get status of a specific reconstruction job
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // Get job ID from query params
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // Get job from Supabase (verifies ownership)
    let job = await getJobForUser(jobId, userId);

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
          job = (await getJobForUser(jobId, userId))!;
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
