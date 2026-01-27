/**
 * ZENNA Avatar V2 - Replicate.com 3D Reconstruction Service
 *
 * Uses Replicate's TRELLIS model for image-to-3D conversion.
 * TRELLIS generates high-quality 3D GLB models from single images.
 *
 * Pricing: ~$0.043 per reconstruction (A100 GPU)
 *
 * Flow:
 * 1. User uploads image(s) -> stored in Supabase Storage
 * 2. Job created in pending state
 * 3. This service triggers Replicate prediction
 * 4. Replicate processes async, calls webhook when done
 * 5. Webhook updates job status and stores GLB in Supabase
 */

import Replicate from 'replicate';
import {
  updateJobStatus,
  updateJobOutput,
  uploadModel,
  getJob,
} from './supabase-reconstruction-store';

// =============================================================================
// TYPES
// =============================================================================

interface TrellisInput {
  images: string[];
  seed?: number;
  randomize_seed?: boolean;
  generate_color?: boolean;
  generate_normal?: boolean;
  generate_model?: boolean;
  save_gaussian_ply?: boolean;
  return_no_background?: boolean;
  ss_sampling_steps?: number;
  ss_guidance_strength?: number;
  slat_sampling_steps?: number;
  slat_guidance_strength?: number;
  texture_size?: number;
  mesh_simplify?: number;
}

interface TrellisOutput {
  model_file?: string;
  color_video?: string;
  normal_video?: string;
  gaussian_ply?: string;
  no_background_images?: string[];
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: TrellisOutput;
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

// =============================================================================
// REPLICATE CLIENT
// =============================================================================

function getReplicateClient(): Replicate {
  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    throw new Error('Missing REPLICATE_API_TOKEN environment variable');
  }

  return new Replicate({
    auth: token,
  });
}

// =============================================================================
// TRELLIS MODEL CONFIG
// =============================================================================

// TRELLIS model for image-to-3D
const TRELLIS_MODEL = 'firtoz/trellis';
const TRELLIS_VERSION = 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c';

// Default settings optimized for avatar reconstruction
const DEFAULT_TRELLIS_OPTIONS: Partial<TrellisInput> = {
  generate_model: true,        // Output GLB file
  generate_color: true,        // Generate color preview video
  generate_normal: false,      // Skip normal video (faster)
  save_gaussian_ply: false,    // Skip point cloud (faster)
  return_no_background: true,  // Return processed images
  texture_size: 1024,          // Good quality textures
  mesh_simplify: 0.95,         // Slight simplification for performance
  ss_sampling_steps: 12,       // Stage 1 sampling (default)
  ss_guidance_strength: 7.5,   // Stage 1 guidance (default)
  slat_sampling_steps: 12,     // Stage 2 sampling (default)
  slat_guidance_strength: 3,   // Stage 2 guidance (default)
};

// =============================================================================
// START RECONSTRUCTION
// =============================================================================

/**
 * Start a 3D reconstruction using Replicate's TRELLIS model.
 *
 * @param jobId - The reconstruction job ID in our database
 * @param imageUrls - Array of image URLs (from Supabase Storage)
 * @param webhookUrl - URL for Replicate to call when done
 * @returns The Replicate prediction ID
 */
export async function startReplicateReconstruction(
  jobId: string,
  imageUrls: string[],
  webhookUrl: string
): Promise<string> {
  const replicate = getReplicateClient();

  // Update job status to processing
  await updateJobStatus(jobId, 'processing', 10);

  try {
    // Create prediction with webhook
    const prediction = await replicate.predictions.create({
      model: TRELLIS_MODEL,
      version: TRELLIS_VERSION,
      input: {
        ...DEFAULT_TRELLIS_OPTIONS,
        images: imageUrls,
      } as TrellisInput,
      webhook: webhookUrl,
      webhook_events_filter: ['completed'],
    });

    console.log(`Started Replicate prediction ${prediction.id} for job ${jobId}`);

    // Update job with prediction ID in metadata
    await updateJobStatus(jobId, 'processing', 20);

    return prediction.id;
  } catch (error) {
    console.error('Failed to start Replicate prediction:', error);
    await updateJobStatus(
      jobId,
      'failed',
      0,
      error instanceof Error ? error.message : 'Failed to start 3D reconstruction'
    );
    throw error;
  }
}

/**
 * Poll for reconstruction status (alternative to webhooks).
 * Useful for development/testing without a public webhook URL.
 */
export async function pollReplicatePrediction(predictionId: string): Promise<ReplicatePrediction> {
  const replicate = getReplicateClient();
  const prediction = await replicate.predictions.get(predictionId);
  return prediction as unknown as ReplicatePrediction;
}

/**
 * Wait for a prediction to complete (blocking).
 * Only use in development - production should use webhooks.
 */
export async function waitForPrediction(
  predictionId: string,
  maxWaitMs: number = 300000,
  pollIntervalMs: number = 5000
): Promise<ReplicatePrediction> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const prediction = await pollReplicatePrediction(predictionId);

    if (prediction.status === 'succeeded' || prediction.status === 'failed' || prediction.status === 'canceled') {
      return prediction;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Prediction ${predictionId} timed out after ${maxWaitMs}ms`);
}

// =============================================================================
// PROCESS WEBHOOK
// =============================================================================

/**
 * Process a webhook callback from Replicate.
 * Downloads the GLB, uploads to Supabase, updates job status.
 *
 * @param jobId - Our job ID
 * @param prediction - The Replicate prediction result
 */
export async function processReplicateWebhook(
  jobId: string,
  prediction: ReplicatePrediction
): Promise<void> {
  console.log(`Processing webhook for job ${jobId}, prediction status: ${prediction.status}`);

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await updateJobStatus(
      jobId,
      'failed',
      0,
      prediction.error || 'Reconstruction failed or was canceled'
    );
    return;
  }

  if (prediction.status !== 'succeeded') {
    // Not done yet, update progress
    await updateJobStatus(jobId, 'processing', 50);
    return;
  }

  // Success! Process the output
  const output = prediction.output as TrellisOutput;

  if (!output?.model_file) {
    await updateJobStatus(jobId, 'failed', 0, 'No 3D model in output');
    return;
  }

  try {
    // Update status to rigging phase
    await updateJobStatus(jobId, 'rigging', 70);

    // Download the GLB from Replicate's temporary URL
    const glbResponse = await fetch(output.model_file);
    if (!glbResponse.ok) {
      throw new Error(`Failed to download GLB: ${glbResponse.status}`);
    }

    const glbBuffer = Buffer.from(await glbResponse.arrayBuffer());

    // Update to blendshapes phase (in reality TRELLIS doesn't add these,
    // but we keep the status flow for UI consistency)
    await updateJobStatus(jobId, 'blendshapes', 85);

    // Upload to Supabase Storage
    const modelUrl = await uploadModel(glbBuffer, jobId);

    // Get thumbnail URL if available (color video first frame or no-bg image)
    let thumbnailUrl: string | undefined;
    if (output.no_background_images && output.no_background_images.length > 0) {
      thumbnailUrl = output.no_background_images[0];
    }

    // Update job as complete with output URLs
    await updateJobOutput(jobId, modelUrl, thumbnailUrl);

    console.log(`Job ${jobId} completed successfully. Model: ${modelUrl}`);
  } catch (error) {
    console.error(`Failed to process reconstruction output for job ${jobId}:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      0,
      error instanceof Error ? error.message : 'Failed to process 3D model'
    );
  }
}

// =============================================================================
// DEVELOPMENT HELPER
// =============================================================================

/**
 * Run reconstruction synchronously (for development without webhooks).
 * NOT recommended for production - blocks for ~1-2 minutes.
 */
export async function runReconstructionSync(
  jobId: string,
  imageUrls: string[]
): Promise<void> {
  const replicate = getReplicateClient();

  await updateJobStatus(jobId, 'processing', 10);

  try {
    console.log(`Starting sync reconstruction for job ${jobId}`);

    // Run the model and wait for completion
    const output = await replicate.run(
      `${TRELLIS_MODEL}:${TRELLIS_VERSION}`,
      {
        input: {
          ...DEFAULT_TRELLIS_OPTIONS,
          images: imageUrls,
        } as TrellisInput,
      }
    ) as TrellisOutput;

    // Process the output
    if (!output?.model_file) {
      throw new Error('No 3D model in output');
    }

    await updateJobStatus(jobId, 'rigging', 70);

    // Download GLB
    const glbResponse = await fetch(output.model_file);
    if (!glbResponse.ok) {
      throw new Error(`Failed to download GLB: ${glbResponse.status}`);
    }

    const glbBuffer = Buffer.from(await glbResponse.arrayBuffer());

    await updateJobStatus(jobId, 'blendshapes', 85);

    // Upload to Supabase
    const modelUrl = await uploadModel(glbBuffer, jobId);

    // Get thumbnail
    let thumbnailUrl: string | undefined;
    if (output.no_background_images && output.no_background_images.length > 0) {
      thumbnailUrl = output.no_background_images[0];
    }

    // Mark complete
    await updateJobOutput(jobId, modelUrl, thumbnailUrl);

    console.log(`Sync reconstruction completed for job ${jobId}`);
  } catch (error) {
    console.error(`Sync reconstruction failed for job ${jobId}:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      0,
      error instanceof Error ? error.message : 'Reconstruction failed'
    );
    throw error;
  }
}

// =============================================================================
// ESTIMATE COST
// =============================================================================

/**
 * Estimate the cost of a reconstruction.
 * TRELLIS costs ~$0.0014/second, typical run is ~30 seconds.
 */
export function estimateReconstructionCost(imageCount: number): {
  estimatedCostUsd: number;
  estimatedTimeSeconds: number;
} {
  // Base time is ~30 seconds for single image
  // Additional images add ~5 seconds each
  const estimatedTimeSeconds = 30 + (imageCount - 1) * 5;

  // Cost per second
  const costPerSecond = 0.0014;
  const estimatedCostUsd = estimatedTimeSeconds * costPerSecond;

  return {
    estimatedCostUsd: Math.round(estimatedCostUsd * 1000) / 1000, // Round to 3 decimals
    estimatedTimeSeconds,
  };
}
