/**
 * ZENNA Avatar V2 - Supabase Reconstruction Store
 *
 * Cloud-compatible storage for reconstruction jobs using Supabase.
 * Works on Vercel serverless functions (no in-memory state).
 *
 * Required Supabase Setup:
 * 1. Create 'avatar_reconstruction_jobs' table (see SQL below)
 * 2. Create 'avatar-uploads' storage bucket
 *
 * SQL for table creation:
 * ```sql
 * CREATE TABLE avatar_reconstruction_jobs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id TEXT NOT NULL,
 *   status TEXT NOT NULL DEFAULT 'pending',
 *   progress INTEGER NOT NULL DEFAULT 0,
 *   error TEXT,
 *   image_count INTEGER NOT NULL DEFAULT 0,
 *   method TEXT NOT NULL DEFAULT 'single-image',
 *   input_paths TEXT[] DEFAULT '{}',
 *   output_model_url TEXT,
 *   output_thumbnail_url TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   completed_at TIMESTAMPTZ
 * );
 *
 * -- Index for user queries
 * CREATE INDEX idx_reconstruction_jobs_user_id ON avatar_reconstruction_jobs(user_id);
 *
 * -- Index for status queries
 * CREATE INDEX idx_reconstruction_jobs_status ON avatar_reconstruction_jobs(status);
 *
 * -- Enable RLS
 * ALTER TABLE avatar_reconstruction_jobs ENABLE ROW LEVEL SECURITY;
 *
 * -- Policy: Users can only see their own jobs (service role bypasses this)
 * CREATE POLICY "Users can view own jobs" ON avatar_reconstruction_jobs
 *   FOR SELECT USING (auth.uid()::text = user_id);
 * ```
 *
 * Storage bucket setup:
 * ```sql
 * -- Create bucket for avatar uploads
 * INSERT INTO storage.buckets (id, name, public)
 * VALUES ('avatar-uploads', 'avatar-uploads', true);
 *
 * -- Policy: Allow authenticated uploads
 * CREATE POLICY "Allow uploads" ON storage.objects
 *   FOR INSERT WITH CHECK (bucket_id = 'avatar-uploads');
 *
 * -- Policy: Allow public reads
 * CREATE POLICY "Allow public reads" ON storage.objects
 *   FOR SELECT USING (bucket_id = 'avatar-uploads');
 * ```
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export type ReconstructionStatus =
  | 'pending'
  | 'validating'
  | 'processing'
  | 'rigging'
  | 'blendshapes'
  | 'complete'
  | 'failed';

export interface ReconstructionJob {
  id: string;
  user_id: string;
  status: ReconstructionStatus;
  progress: number;
  error?: string | null;
  image_count: number;
  method: 'single-image' | 'photogrammetry';
  input_paths: string[];
  output_model_url?: string | null;
  output_thumbnail_url?: string | null;
  replicate_prediction_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

// Database row type (snake_case from Supabase)
interface DatabaseJob {
  id: string;
  user_id: string;
  status: string;
  progress: number;
  error: string | null;
  image_count: number;
  method: string;
  input_paths: string[];
  output_model_url: string | null;
  output_thumbnail_url: string | null;
  replicate_prediction_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// =============================================================================
// JOB OPERATIONS
// =============================================================================

/**
 * Create a new reconstruction job.
 */
export async function createJob(
  userId: string,
  imageCount: number,
  method: 'single-image' | 'photogrammetry',
  inputPaths: string[]
): Promise<ReconstructionJob> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .insert({
      user_id: userId,
      status: 'pending',
      progress: 0,
      image_count: imageCount,
      method,
      input_paths: inputPaths,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create reconstruction job:', error);
    throw new Error('Failed to create reconstruction job');
  }

  return mapDatabaseJob(data as DatabaseJob);
}

/**
 * Get a job by ID.
 */
export async function getJob(jobId: string): Promise<ReconstructionJob | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .select()
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    console.error('Failed to get reconstruction job:', error);
    throw new Error('Failed to get reconstruction job');
  }

  return mapDatabaseJob(data as DatabaseJob);
}

/**
 * Get a job by ID, verifying it belongs to the user.
 */
export async function getJobForUser(
  jobId: string,
  userId: string
): Promise<ReconstructionJob | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .select()
    .eq('id', jobId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to get reconstruction job:', error);
    throw new Error('Failed to get reconstruction job');
  }

  return mapDatabaseJob(data as DatabaseJob);
}

/**
 * Get all jobs for a user.
 */
export async function getJobsForUser(userId: string): Promise<ReconstructionJob[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to get user jobs:', error);
    throw new Error('Failed to get user jobs');
  }

  return (data as DatabaseJob[]).map(mapDatabaseJob);
}

/**
 * Update job status and progress.
 */
export async function updateJobStatus(
  jobId: string,
  status: ReconstructionStatus,
  progress: number,
  error?: string
): Promise<ReconstructionJob> {
  const client = getSupabaseClient();

  const updateData: Record<string, unknown> = {
    status,
    progress,
    updated_at: new Date().toISOString(),
  };

  if (error !== undefined) {
    updateData.error = error;
  }

  if (status === 'complete' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }

  const { data, error: dbError } = await client
    .from('avatar_reconstruction_jobs')
    .update(updateData)
    .eq('id', jobId)
    .select()
    .single();

  if (dbError) {
    console.error('Failed to update job status:', dbError);
    throw new Error('Failed to update job status');
  }

  return mapDatabaseJob(data as DatabaseJob);
}

/**
 * Update job with output URLs.
 */
export async function updateJobOutput(
  jobId: string,
  outputModelUrl: string,
  outputThumbnailUrl?: string
): Promise<ReconstructionJob> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .update({
      status: 'complete',
      progress: 100,
      output_model_url: outputModelUrl,
      output_thumbnail_url: outputThumbnailUrl || null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    console.error('Failed to update job output:', error);
    throw new Error('Failed to update job output');
  }

  return mapDatabaseJob(data as DatabaseJob);
}

/**
 * Update job with Replicate prediction ID for polling fallback.
 */
export async function updateJobPredictionId(
  jobId: string,
  predictionId: string
): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('avatar_reconstruction_jobs')
    .update({
      replicate_prediction_id: predictionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error('Failed to update prediction ID:', error);
  }
}

/**
 * Delete old completed/failed jobs (cleanup).
 */
export async function cleanupOldJobs(olderThanHours: number = 24): Promise<number> {
  const client = getSupabaseClient();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from('avatar_reconstruction_jobs')
    .delete()
    .in('status', ['complete', 'failed'])
    .lt('updated_at', cutoff)
    .select();

  if (error) {
    console.error('Failed to cleanup old jobs:', error);
    return 0;
  }

  return data?.length || 0;
}

// =============================================================================
// STORAGE OPERATIONS
// =============================================================================

/**
 * Upload an image to Supabase Storage.
 * Returns the public URL.
 */
export async function uploadImage(
  buffer: Buffer,
  filename: string,
  jobId: string,
  contentType: string = 'image/png'
): Promise<string> {
  const client = getSupabaseClient();
  const path = `reconstruction/${jobId}/${filename}`;

  const { error } = await client.storage
    .from('avatar-uploads')
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error('Failed to upload image:', error);
    throw new Error(`Failed to upload image to storage: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = client.storage
    .from('avatar-uploads')
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Upload a generated GLB model to Supabase Storage.
 */
export async function uploadModel(
  buffer: Buffer,
  jobId: string
): Promise<string> {
  const client = getSupabaseClient();
  const path = `models/${jobId}/avatar.glb`;

  const { error } = await client.storage
    .from('avatar-uploads')
    .upload(path, buffer, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });

  if (error) {
    console.error('Failed to upload model:', error);
    throw new Error('Failed to upload model');
  }

  const { data: urlData } = client.storage
    .from('avatar-uploads')
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Delete all files for a job.
 */
export async function deleteJobFiles(jobId: string): Promise<void> {
  const client = getSupabaseClient();

  // List and delete reconstruction images
  const { data: reconstructionFiles } = await client.storage
    .from('avatar-uploads')
    .list(`reconstruction/${jobId}`);

  if (reconstructionFiles && reconstructionFiles.length > 0) {
    const paths = reconstructionFiles.map(f => `reconstruction/${jobId}/${f.name}`);
    await client.storage.from('avatar-uploads').remove(paths);
  }

  // List and delete models
  const { data: modelFiles } = await client.storage
    .from('avatar-uploads')
    .list(`models/${jobId}`);

  if (modelFiles && modelFiles.length > 0) {
    const paths = modelFiles.map(f => `models/${jobId}/${f.name}`);
    await client.storage.from('avatar-uploads').remove(paths);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Map database row to ReconstructionJob type.
 */
function mapDatabaseJob(row: DatabaseJob): ReconstructionJob {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status as ReconstructionStatus,
    progress: row.progress,
    error: row.error,
    image_count: row.image_count,
    method: row.method as 'single-image' | 'photogrammetry',
    input_paths: row.input_paths || [],
    output_model_url: row.output_model_url,
    output_thumbnail_url: row.output_thumbnail_url,
    replicate_prediction_id: row.replicate_prediction_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}
