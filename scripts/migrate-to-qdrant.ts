#!/usr/bin/env npx ts-node
/**
 * Migration Script: Supabase → Qdrant
 *
 * This script migrates all existing conversation turns from Supabase
 * to Qdrant for semantic search (RAG).
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-qdrant.ts
 *
 * Requirements:
 *   - QDRANT_URL and QDRANT_COLLECTION must be set in .env.local
 *   - GOOGLE_AI_API_KEY for embeddings
 *   - Supabase credentials
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

interface SessionTurn {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

// Gemini embedding provider
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Embedding failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

// Qdrant API helper
async function qdrantRequest<T>(
  url: string,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  apiKey?: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['api-key'] = apiKey;
  }

  const response = await fetch(`${url}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qdrant request failed: ${response.status} - ${error}`);
  }

  return response.json();
}

async function ensureCollection(
  qdrantUrl: string,
  qdrantApiKey: string | undefined,
  collectionName: string,
  vectorSize: number
): Promise<void> {
  try {
    await qdrantRequest(qdrantUrl, `/collections/${collectionName}`, 'GET', qdrantApiKey);
    console.log(`✓ Collection '${collectionName}' exists`);
  } catch {
    console.log(`Creating collection '${collectionName}'...`);
    await qdrantRequest(
      qdrantUrl,
      `/collections/${collectionName}`,
      'PUT',
      qdrantApiKey,
      {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
        optimizers_config: {
          indexing_threshold: 10000,
        },
        on_disk_payload: true,
      }
    );

    // Create indexes for filtering
    await qdrantRequest(
      qdrantUrl,
      `/collections/${collectionName}/index`,
      'PUT',
      qdrantApiKey,
      { field_name: 'userId', field_schema: 'keyword' }
    );

    await qdrantRequest(
      qdrantUrl,
      `/collections/${collectionName}/index`,
      'PUT',
      qdrantApiKey,
      { field_name: 'type', field_schema: 'keyword' }
    );

    console.log(`✓ Collection '${collectionName}' created with ${vectorSize} dimensions`);
  }
}

async function migrate() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Zenna Memory Migration: Supabase → Qdrant');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY;
  const qdrantCollection = process.env.QDRANT_COLLECTION || 'zenna-memories';
  const embeddingApiKey = process.env.GOOGLE_AI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  if (!qdrantUrl) {
    console.error('❌ Missing QDRANT_URL');
    console.error('   Set QDRANT_URL in .env.local (e.g., http://localhost:6333)');
    process.exit(1);
  }

  if (!embeddingApiKey) {
    console.error('❌ Missing GOOGLE_AI_API_KEY for embeddings');
    process.exit(1);
  }

  console.log('Configuration:');
  console.log(`  Supabase: ${supabaseUrl}`);
  console.log(`  Qdrant: ${qdrantUrl}`);
  console.log(`  Collection: ${qdrantCollection}`);
  console.log(`  Embeddings: Gemini text-embedding-004\n`);

  // Initialize Supabase
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all session turns
  console.log('Fetching memories from Supabase...');
  const { data: turns, error } = await supabase
    .from('session_turns')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Failed to fetch session turns:', error);
    process.exit(1);
  }

  if (!turns || turns.length === 0) {
    console.log('ℹ️  No memories found in Supabase. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`✓ Found ${turns.length} memories to migrate\n`);

  // Group by user for summary
  const userCounts: Record<string, number> = {};
  for (const turn of turns) {
    userCounts[turn.user_id] = (userCounts[turn.user_id] || 0) + 1;
  }

  console.log('Memories by user:');
  for (const [userId, count] of Object.entries(userCounts)) {
    console.log(`  ${userId.substring(0, 8)}...: ${count} turns`);
  }
  console.log('');

  // Get vector dimensions from test embedding
  console.log('Testing embedding API...');
  const testEmbedding = await generateEmbedding('test', embeddingApiKey);
  const vectorSize = testEmbedding.length;
  console.log(`✓ Embeddings working (${vectorSize} dimensions)\n`);

  // Ensure Qdrant collection exists
  await ensureCollection(qdrantUrl, qdrantApiKey, qdrantCollection, vectorSize);
  console.log('');

  // Migrate in batches
  const BATCH_SIZE = 50;
  let migrated = 0;
  let failed = 0;

  console.log(`Migrating memories (batch size: ${BATCH_SIZE})...`);

  for (let i = 0; i < turns.length; i += BATCH_SIZE) {
    const batch = turns.slice(i, i + BATCH_SIZE);
    const points: QdrantPoint[] = [];

    for (const turn of batch) {
      try {
        // Skip empty content
        if (!turn.content || turn.content.trim().length === 0) {
          continue;
        }

        // Generate embedding
        const embedding = await generateEmbedding(turn.content, embeddingApiKey);

        points.push({
          id: turn.id,
          vector: embedding,
          payload: {
            userId: turn.user_id,
            content: turn.content,
            type: 'conversation',
            source: turn.role,
            sessionId: turn.session_id,
            createdAt: turn.created_at,
            updatedAt: turn.created_at,
            // Mark as migrated from Supabase
            migratedFrom: 'supabase',
            migratedAt: new Date().toISOString(),
          },
        });

        // Rate limiting for embedding API
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error(`  ⚠️ Failed to process turn ${turn.id}:`, err);
        failed++;
      }
    }

    // Upsert batch to Qdrant
    if (points.length > 0) {
      try {
        await qdrantRequest(
          qdrantUrl,
          `/collections/${qdrantCollection}/points`,
          'PUT',
          qdrantApiKey,
          { points }
        );
        migrated += points.length;
        console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${points.length} memories`);
      } catch (err) {
        console.error(`  ❌ Batch failed:`, err);
        failed += points.length;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Migration Complete!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✓ Migrated: ${migrated} memories`);
  if (failed > 0) {
    console.log(`  ⚠️ Failed: ${failed} memories`);
  }
  console.log(`\nYour memories are now in Qdrant at: ${qdrantUrl}`);
  console.log(`Collection: ${qdrantCollection}`);
  console.log('\nNext steps:');
  console.log('  1. Update .env.local with QDRANT_URL and QDRANT_COLLECTION');
  console.log('  2. Restart your Zenna application');
  console.log('  3. Zenna will now use Qdrant for semantic memory search!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
