import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { createMemoryService } from '@/core/services/memory-service';
import { NotionService } from '@/core/services/notion-service';
import { getMemoryLimit } from '@/lib/utils/permissions';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

// In-memory progress tracking (in production, use Redis or database)
const ingestionProgress = new Map<string, {
  status: 'processing' | 'completed' | 'error';
  progress: number;
  totalPages: number;
  processedPages: number;
  error?: string;
}>();

// Start sync process (Notion → Qdrant via MemoryService)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const identityStore = getIdentityStore();

    const { pageIds } = await request.json();

    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json({ error: 'No pages selected for sync' }, { status: 400 });
    }

    // Get user's Notion credentials
    const user = await identityStore.getUser(userId);
    const notionConfig = user?.settings.externalContext?.notion;

    if (!notionConfig?.token) {
      return NextResponse.json({ error: 'Notion not connected' }, { status: 400 });
    }

    // Check if already processing
    const existingProgress = ingestionProgress.get(userId);
    if (existingProgress?.status === 'processing') {
      return NextResponse.json({
        message: 'Sync already in progress',
        progress: existingProgress,
      });
    }

    // Memory quota check
    const memoryService = createMemoryService();
    await memoryService.initialize();

    if (!memoryService.hasLongTermMemory()) {
      return NextResponse.json(
        { error: 'Vector memory not configured. Contact support.' },
        { status: 500 }
      );
    }

    const currentUsageMB = await memoryService.estimateUserMemoryUsageMB(userId);
    const estimatedNewMB = pageIds.length * 0.05; // ~50KB per page average
    const tier = session.user.subscription?.tier || 'trial';
    const limitMB = getMemoryLimit(tier);

    if (limitMB !== -1 && (currentUsageMB + estimatedNewMB) > limitMB) {
      return NextResponse.json({
        error: `Sync would exceed your memory quota. Currently using ${currentUsageMB.toFixed(1)} MB of ${limitMB} MB. Estimated sync size: ~${estimatedNewMB.toFixed(1)} MB. Upgrade your plan for more storage.`,
      }, { status: 400 });
    }

    // Initialize progress
    ingestionProgress.set(userId, {
      status: 'processing',
      progress: 0,
      totalPages: pageIds.length,
      processedPages: 0,
    });

    // Update user settings to show processing status
    await identityStore.updateSettings(userId, {
      externalContext: {
        ...user?.settings.externalContext,
        notion: {
          ...notionConfig,
          ingestionStatus: 'processing',
          ingestionProgress: 0,
          notionMode: 'sync',
          syncedPageIds: pageIds,
        },
      },
    });

    // Start background processing (non-blocking)
    processNotionPages(userId, pageIds, notionConfig.token).catch(console.error);

    return NextResponse.json({
      message: 'Sync started',
      totalPages: pageIds.length,
    });
  } catch (error) {
    console.error('Notion sync start error:', error);
    return NextResponse.json(
      { error: 'Failed to start sync' },
      { status: 500 }
    );
  }
}

// Get sync progress
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const identityStore = getIdentityStore();

    const progress = ingestionProgress.get(userId);

    if (!progress) {
      // Check user settings for persisted status
      const user = await identityStore.getUser(userId);
      const notionConfig = user?.settings.externalContext?.notion;

      return NextResponse.json({
        status: notionConfig?.ingestionStatus || 'idle',
        progress: notionConfig?.ingestionProgress || 0,
      });
    }

    return NextResponse.json(progress);
  } catch (error) {
    console.error('Notion progress check error:', error);
    return NextResponse.json(
      { error: 'Failed to get progress' },
      { status: 500 }
    );
  }
}

// Clear synced Notion data from memory
export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Clear all notion-sync tagged vectors
    const memoryService = createMemoryService();
    await memoryService.initialize();
    await memoryService.clearNotionSync(userId);

    // Reset settings
    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(userId);
    if (user) {
      await identityStore.updateSettings(userId, {
        externalContext: {
          ...user.settings.externalContext,
          notion: {
            ...user.settings.externalContext?.notion,
            enabled: user.settings.externalContext?.notion?.enabled ?? true,
            syncedPageIds: [],
            syncEstimateMB: 0,
            ingestionStatus: 'idle',
            ingestionProgress: 0,
          },
        },
      });
    }

    return NextResponse.json({ success: true, message: 'Synced Notion data cleared from memory' });
  } catch (error) {
    console.error('Notion sync clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear synced data' },
      { status: 500 }
    );
  }
}

// Background processing function — uses MemoryService (Qdrant) instead of Pinecone
async function processNotionPages(userId: string, pageIds: string[], notionToken: string) {
  const memoryService = createMemoryService();
  await memoryService.initialize();

  if (!memoryService.hasLongTermMemory()) {
    await updateProgress(userId, 'error', 0, 'Vector memory not configured');
    return;
  }

  // Clear any previously synced Notion data before re-syncing
  await memoryService.clearNotionSync(userId);

  const notionService = new NotionService(notionToken);
  let processedCount = 0;

  for (const pageId of pageIds) {
    try {
      // Fetch page content using the existing NotionService (reuse, not duplicate)
      const pageContent = await notionService.getPageContent(pageId);

      if (pageContent && pageContent.content) {
        // Chunk the content for embedding
        const chunks = chunkText(pageContent.content, 1000);

        for (const chunk of chunks) {
          await memoryService.storeNotionSync(userId, chunk, pageContent.title, pageId);
        }
      }

      processedCount++;
      const progress = Math.round((processedCount / pageIds.length) * 100);
      await updateProgress(userId, 'processing', progress, undefined, pageIds.length, processedCount);

    } catch (error) {
      console.error(`Error processing page ${pageId}:`, error);
      // Continue with other pages even if one fails
    }
  }

  // Calculate actual storage used after sync
  const actualUsageMB = await memoryService.estimateUserMemoryUsageMB(userId);

  // Update settings with actual sync data
  try {
    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(userId);
    if (user) {
      await identityStore.updateSettings(userId, {
        externalContext: {
          ...user.settings.externalContext,
          notion: {
            ...user.settings.externalContext?.notion,
            enabled: user.settings.externalContext?.notion?.enabled ?? true,
            syncedAt: Date.now(),
            syncEstimateMB: actualUsageMB,
          },
        },
      });
    }
  } catch (e) {
    console.error('Failed to persist sync metadata:', e);
  }

  // Mark as completed
  await updateProgress(userId, 'completed', 100, undefined, pageIds.length, processedCount);
}

// Update progress both in memory and user settings
async function updateProgress(
  userId: string,
  status: 'processing' | 'completed' | 'error',
  progress: number,
  error?: string,
  totalPages?: number,
  processedPages?: number
) {
  // Update in-memory progress
  ingestionProgress.set(userId, {
    status,
    progress,
    totalPages: totalPages || 0,
    processedPages: processedPages || 0,
    error,
  });

  // Update user settings (persist status)
  try {
    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(userId);
    if (user) {
      await identityStore.updateSettings(userId, {
        externalContext: {
          ...user.settings.externalContext,
          notion: {
            ...user.settings.externalContext?.notion,
            enabled: user.settings.externalContext?.notion?.enabled ?? true,
            ingestionStatus: status,
            ingestionProgress: progress,
          },
        },
      });
    }
  } catch (e) {
    console.error('Failed to persist sync status:', e);
  }
}

// Chunk text into smaller pieces for embedding
function chunkText(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // If a single paragraph is too long, split it
      if (paragraph.length > maxChunkSize) {
        const words = paragraph.split(' ');
        let wordChunk = '';
        for (const word of words) {
          if ((wordChunk + word).length > maxChunkSize) {
            chunks.push(wordChunk.trim());
            wordChunk = word;
          } else {
            wordChunk += (wordChunk ? ' ' : '') + word;
          }
        }
        currentChunk = wordChunk;
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
