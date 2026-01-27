/**
 * ZENNA Avatar V2 - 3D Reconstruction API
 *
 * Cloud-compatible API for avatar reconstruction using Replicate.com.
 * Uses Supabase for storage and job tracking (works on Vercel).
 *
 * Pipeline:
 * 1. User uploads images -> Supabase Storage
 * 2. Job created in Supabase database
 * 3. Replicate TRELLIS model triggered for image-to-3D conversion
 * 4. Replicate calls webhook when done
 * 5. Webhook stores GLB in Supabase and updates job status
 *
 * Cost: ~$0.04 per reconstruction (Replicate TRELLIS on A100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import {
  createJob,
  getJobsForUser,
  uploadImage,
  updateJobStatus,
} from '@/lib/avatar/supabase-reconstruction-store';
import {
  startReplicateReconstruction,
  runReconstructionSync,
  estimateReconstructionCost,
} from '@/lib/avatar/replicate-reconstruction';

// =============================================================================
// CONFIG
// =============================================================================

// Base URL for webhooks - MUST be your production domain
const getBaseUrl = (): string => {
  // In production, use the deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // Explicit production URL
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // Fallback for development (webhooks won't work locally without ngrok/similar)
  return 'https://zenna.anthonywestinc.com';
};

// Use sync mode for development (no webhooks needed, but slower)
const USE_SYNC_MODE = process.env.REPLICATE_SYNC_MODE === 'true';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get current user from session token.
 */
async function getCurrentUser(): Promise<{ id: string; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('zenna_session')?.value;

  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(
      process.env.AUTH_SECRET || 'zenna-default-secret-change-me'
    );
    const { payload } = await jose.jwtVerify(token, secret);
    return {
      id: payload.sub as string,
      username: payload.username as string,
    };
  } catch {
    return null;
  }
}

/**
 * Validate uploaded image.
 */
function validateImage(
  buffer: Buffer,
  filename: string
): { valid: boolean; errors: string[]; contentType: string } {
  const errors: string[] = [];
  let contentType = 'image/png';

  // Check file size (max 10MB)
  if (buffer.length > 10 * 1024 * 1024) {
    errors.push('File too large. Maximum size is 10MB.');
  }

  // Check file signature for image type
  const signature = buffer.slice(0, 8).toString('hex');

  const isPNG = signature.startsWith('89504e47');
  const isJPEG = signature.startsWith('ffd8ff');
  const isWebP =
    buffer.slice(0, 4).toString() === 'RIFF' &&
    buffer.slice(8, 12).toString() === 'WEBP';

  if (isPNG) {
    contentType = 'image/png';
  } else if (isJPEG) {
    contentType = 'image/jpeg';
  } else if (isWebP) {
    contentType = 'image/webp';
  } else {
    errors.push('Invalid image format. Use PNG, JPEG, or WebP.');
  }

  return { valid: errors.length === 0, errors, contentType };
}

// =============================================================================
// POST /api/avatar/reconstruct
// Upload images and start reconstruction
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check Replicate API token is configured
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('REPLICATE_API_TOKEN not configured');
      return NextResponse.json(
        { error: 'Reconstruction service not configured' },
        { status: 503 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const imageCount = parseInt(formData.get('imageCount') as string) || 0;

    if (imageCount === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    // Process and upload each image
    const uploadedUrls: string[] = [];
    const tempJobId = `temp-${Date.now()}`; // Temporary ID for organizing uploads

    for (let i = 0; i < imageCount; i++) {
      const image = formData.get(`image_${i}`) as File | null;
      const angle = (formData.get(`angle_${i}`) as string) || 'unknown';

      if (!image) continue;

      // Read file buffer
      const buffer = Buffer.from(await image.arrayBuffer());

      // Validate image
      const validation = validateImage(buffer, image.name);
      if (!validation.valid) {
        return NextResponse.json(
          {
            error: `Image ${i + 1} validation failed: ${validation.errors.join(', ')}`,
          },
          { status: 400 }
        );
      }

      // Generate unique filename
      const ext = image.name.split('.').pop() || 'png';
      const filename = `${angle}_${i}_${Date.now()}.${ext}`;

      // Upload to Supabase Storage
      try {
        const url = await uploadImage(
          buffer,
          filename,
          tempJobId,
          validation.contentType
        );
        uploadedUrls.push(url);
      } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json(
          { error: 'Failed to upload image' },
          { status: 500 }
        );
      }
    }

    // Create reconstruction job in database
    const job = await createJob(
      user.id,
      uploadedUrls.length,
      uploadedUrls.length === 1 ? 'single-image' : 'photogrammetry',
      uploadedUrls
    );

    // Estimate cost
    const costEstimate = estimateReconstructionCost(uploadedUrls.length);

    // Start reconstruction using Replicate
    try {
      if (USE_SYNC_MODE) {
        // Sync mode: Wait for completion (dev only, will timeout on Vercel)
        console.log(`Starting sync reconstruction for job ${job.id}`);
        runReconstructionSync(job.id, uploadedUrls).catch((error) => {
          console.error('Sync reconstruction failed:', error);
        });
      } else {
        // Async mode: Use webhook (production)
        const webhookUrl = `${getBaseUrl()}/api/avatar/reconstruct/webhook?jobId=${job.id}`;
        console.log(`Starting async reconstruction for job ${job.id}, webhook: ${webhookUrl}`);

        await startReplicateReconstruction(job.id, uploadedUrls, webhookUrl);
      }
    } catch (error) {
      console.error('Failed to start Replicate reconstruction:', error);
      await updateJobStatus(
        job.id,
        'failed',
        0,
        error instanceof Error ? error.message : 'Failed to start reconstruction'
      );
      return NextResponse.json(
        { error: 'Failed to start 3D reconstruction' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        imageCount: job.image_count,
        method: job.method,
        createdAt: job.created_at,
      },
      estimate: {
        costUsd: costEstimate.estimatedCostUsd,
        timeSeconds: costEstimate.estimatedTimeSeconds,
      },
    });
  } catch (error) {
    console.error('Reconstruction upload error:', error);
    return NextResponse.json(
      { error: 'Failed to start reconstruction' },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET /api/avatar/reconstruct
// List user's reconstruction jobs
// =============================================================================

export async function GET() {
  try {
    // Authenticate user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's jobs from database
    const jobs = await getJobsForUser(user.id);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
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
      })),
    });
  } catch (error) {
    console.error('Reconstruction list error:', error);
    return NextResponse.json({ error: 'Failed to list jobs' }, { status: 500 });
  }
}
