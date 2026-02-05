/**
 * ZENNA Avatar V2 - Reconstruction Job Store
 *
 * Shared storage for reconstruction jobs.
 * In production, use a database (Supabase, PostgreSQL, etc.)
 */

export interface ReconstructionJob {
  id: string;
  userId: string;
  status: 'pending' | 'validating' | 'processing' | 'rigging' | 'blendshapes' | 'complete' | 'failed';
  progress: number;
  error?: string;
  imageCount: number;
  method: 'single-image' | 'photogrammetry';
  inputPaths: string[];
  outputModelUrl?: string;
  outputThumbnailUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// In-memory store for development
// Replace with database in production
class ReconstructionStore {
  private jobs: Map<string, ReconstructionJob> = new Map();

  get(jobId: string): ReconstructionJob | undefined {
    return this.jobs.get(jobId);
  }

  set(job: ReconstructionJob): void {
    this.jobs.set(job.id, job);
  }

  delete(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  getUserJobs(userId: string): ReconstructionJob[] {
    return Array.from(this.jobs.values())
      .filter(job => job.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getAll(): ReconstructionJob[] {
    return Array.from(this.jobs.values());
  }

  // Cleanup old completed/failed jobs (older than 24 hours)
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, job] of this.jobs.entries()) {
      if (
        (job.status === 'complete' || job.status === 'failed') &&
        job.updatedAt.getTime() < cutoff
      ) {
        this.jobs.delete(id);
      }
    }
  }
}

// Singleton instance
export const reconstructionStore = new ReconstructionStore();

// Cleanup every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    reconstructionStore.cleanup();
  }, 60 * 60 * 1000);
}
