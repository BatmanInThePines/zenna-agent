/**
 * ZENNA Avatar V2 - Replicate Webhook Endpoint
 *
 * Receives callbacks from Replicate when 3D reconstruction completes.
 * Updates job status and stores the resulting GLB model.
 *
 * Webhook URL format: https://zenna.anthonywestinc.com/api/avatar/reconstruct/webhook?jobId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { processReplicateWebhook } from '@/lib/avatar/replicate-reconstruction';
import { getJob } from '@/lib/avatar/supabase-reconstruction-store';

// Allow up to 60s on Vercel Pro (webhook needs time to download + re-upload GLB)
export const maxDuration = 60;

// =============================================================================
// TYPES
// =============================================================================

interface ReplicateWebhookPayload {
  id: string;
  version: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  input: Record<string, unknown>;
  output?: {
    model_file?: string;
    color_video?: string;
    normal_video?: string;
    gaussian_ply?: string;
    no_background_images?: string[];
  };
  error?: string;
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  urls: {
    get: string;
    cancel: string;
  };
}

// =============================================================================
// WEBHOOK VALIDATION
// =============================================================================

/**
 * Validate that the request is from Replicate.
 * In production, you should verify the webhook signature.
 *
 * Replicate signs webhooks with HMAC-SHA256 using your webhook secret.
 * Header: X-Replicate-Webhook-Signature
 */
function validateWebhookSignature(
  request: NextRequest,
  body: string
): boolean {
  const signature = request.headers.get('x-replicate-webhook-signature');
  const webhookSecret = process.env.REPLICATE_WEBHOOK_SECRET;

  // If no secret configured, allow in development
  if (!webhookSecret) {
    console.warn('REPLICATE_WEBHOOK_SECRET not set - skipping signature validation');
    return true;
  }

  if (!signature) {
    console.error('Missing webhook signature');
    return false;
  }

  // TODO: Implement HMAC-SHA256 verification
  // For now, just check that a signature exists
  // In production, use crypto.createHmac('sha256', webhookSecret)
  //   .update(body)
  //   .digest('hex') and compare

  return true;
}

// =============================================================================
// POST /api/avatar/reconstruct/webhook
// Receive Replicate webhook callbacks
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get job ID from query params
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      console.error('Webhook received without jobId');
      return NextResponse.json({ error: 'Missing jobId parameter' }, { status: 400 });
    }

    // Parse body
    const bodyText = await request.text();

    // Validate signature
    if (!validateWebhookSignature(request, bodyText)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload: ReplicateWebhookPayload = JSON.parse(bodyText);

    console.log(`Received webhook for job ${jobId}:`, {
      predictionId: payload.id,
      status: payload.status,
      hasOutput: !!payload.output,
      error: payload.error,
    });

    // Verify job exists
    const job = await getJob(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found for webhook`);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Process the webhook
    await processReplicateWebhook(jobId, {
      id: payload.id,
      status: payload.status,
      output: payload.output,
      error: payload.error,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET /api/avatar/reconstruct/webhook
// Health check for the webhook endpoint
// =============================================================================

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'Replicate webhook receiver',
    timestamp: new Date().toISOString(),
  });
}
