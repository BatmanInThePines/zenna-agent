import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import {
  PineconeLongTermStore,
  OpenAIEmbeddingProvider,
  GeminiEmbeddingProvider,
} from '@/core/providers/memory/pinecone-store';

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

// Start ingestion process
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
      return NextResponse.json({ error: 'No pages selected for ingestion' }, { status: 400 });
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
        message: 'Ingestion already in progress',
        progress: existingProgress,
      });
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
        },
      },
    });

    // Start background processing (non-blocking)
    processNotionPages(userId, pageIds, notionConfig.token).catch(console.error);

    return NextResponse.json({
      message: 'Ingestion started',
      totalPages: pageIds.length,
    });
  } catch (error) {
    console.error('Notion ingestion start error:', error);
    return NextResponse.json(
      { error: 'Failed to start ingestion' },
      { status: 500 }
    );
  }
}

// Get ingestion progress
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

// Background processing function
async function processNotionPages(userId: string, pageIds: string[], notionToken: string) {
  // Initialize embedding provider
  const embeddingApiKey = process.env.OPENAI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!embeddingApiKey) {
    await updateProgress(userId, 'error', 0, 'No embedding API key configured');
    return;
  }

  const embeddingProvider = process.env.OPENAI_API_KEY
    ? new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY)
    : new GeminiEmbeddingProvider(process.env.GOOGLE_AI_API_KEY!);

  // Initialize Pinecone store
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
    await updateProgress(userId, 'error', 0, 'Pinecone not configured');
    return;
  }

  const pineconeStore = new PineconeLongTermStore(
    {
      apiKey: process.env.PINECONE_API_KEY,
      indexName: process.env.PINECONE_INDEX_NAME,
    },
    embeddingProvider
  );

  await pineconeStore.initialize();

  let processedCount = 0;

  for (const pageId of pageIds) {
    try {
      // Fetch page content from Notion
      const pageContent = await fetchNotionPageContent(pageId, notionToken);

      if (pageContent) {
        // Chunk the content if it's too long
        const chunks = chunkText(pageContent.text, 1000);

        for (const chunk of chunks) {
          // Store each chunk in Pinecone
          await pineconeStore.store({
            userId,
            content: chunk,
            metadata: {
              type: 'fact',
              source: 'external',
              topic: pageContent.title,
              tags: ['notion', 'knowledge-base'],
            },
          });
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
    console.error('Failed to persist ingestion status:', e);
  }
}

// Fetch content from a Notion page
async function fetchNotionPageContent(
  pageId: string,
  token: string
): Promise<{ title: string; text: string } | null> {
  try {
    // Get page info
    const pageResponse = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!pageResponse.ok) {
      console.error(`Failed to fetch page ${pageId}:`, await pageResponse.text());
      return null;
    }

    const pageData = await pageResponse.json();
    const title = extractPageTitle(pageData);

    // Get page blocks (content)
    const blocksResponse = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        },
      }
    );

    if (!blocksResponse.ok) {
      console.error(`Failed to fetch blocks for ${pageId}:`, await blocksResponse.text());
      return null;
    }

    const blocksData = await blocksResponse.json();
    const text = extractTextFromBlocks(blocksData.results);

    return { title, text };
  } catch (error) {
    console.error(`Error fetching Notion page ${pageId}:`, error);
    return null;
  }
}

// Extract title from Notion page
function extractPageTitle(page: NotionPageData): string {
  const properties = page.properties;
  for (const key of Object.keys(properties)) {
    const prop = properties[key];
    if (prop.type === 'title' && prop.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }
  return 'Untitled';
}

// Extract text content from Notion blocks
function extractTextFromBlocks(blocks: NotionBlock[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    const blockType = block.type;
    const blockData = block[blockType as keyof NotionBlock];

    if (blockData && typeof blockData === 'object' && 'rich_text' in blockData) {
      const richText = blockData.rich_text as Array<{ plain_text: string }>;
      if (richText) {
        const text = richText.map((t) => t.plain_text).join('');
        if (text.trim()) {
          textParts.push(text);
        }
      }
    }
  }

  return textParts.join('\n\n');
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

// Type definitions for Notion API responses
interface NotionPageData {
  properties: Record<string, {
    type: string;
    title?: Array<{ plain_text: string }>;
  }>;
}

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}
