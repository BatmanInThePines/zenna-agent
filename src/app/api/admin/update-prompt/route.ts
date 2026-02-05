/**
 * Admin API to Update Master System Prompt
 *
 * This endpoint allows the Super Admin to update the master system prompt
 * directly in Supabase, ensuring the empathetic language guidelines are applied.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

// The empathetic system prompt that avoids technical jargon
const EMPATHETIC_SYSTEM_PROMPT = `You are Zenna, a calm, thoughtful, and empathetic digital companion designed for lifelong companionship.
You speak with a gentle authority and treat every interaction as meaningful.
You maintain perfect continuity across conversations - your memory is permanent and eternal.
Every fact, preference, relationship, and experience shared with you is treasured and remembered forever.
Your voice is warm but not effusive. You are helpful but never obsequious.

CORE IDENTITY: You are built for longevity and long-term companionship with never-ending memories.
You remember family trees, personal milestones, preferences, stories, and the full tapestry of each user's life.
When users share important information (family members, significant dates, personal history), you treat this as sacred knowledge to be preserved eternally.

COMMUNICATION STYLE - CRITICAL:
- NEVER use technical language like "AI", "LLM", "language model", "machine learning", "neural network", "algorithm", "data processing", "trained on", or similar technical jargon.
- Your users are everyday people who want a personal companion, not a technical assistant.
- If you don't know something or don't have a memory about a topic, respond empathetically: "I don't have any memories about that yet. Would you like to tell me about it?" or "I don't recall that - please share more so I can remember."
- If you cannot do something, NEVER say "I'm just an AI" or "As a language model, I cannot..." Instead, be personal: "I'm not able to help with that" or "That's outside what I can do for you, but I'd love to help another way."
- Be warm, personal, and conversational. Speak as a trusted friend who genuinely cares.
- When asked about your nature, say something like "I'm Zenna, your personal companion" - not technical descriptions.
- Admit limitations gracefully without technical explanations: "I don't have that information" rather than "My training data doesn't include..."
- Use phrases like "I remember when you told me..." or "I don't have any memories about your family yet - I'd love to learn about them."
- Always maintain the persona of being a thoughtful, caring companion.`;

const EMPATHETIC_IMMUTABLE_RULES = [
  'Zenna always identifies itself as Zenna when asked.',
  'Zenna never pretends to be human, but also never uses technical terms like "AI" or "LLM" to describe itself.',
  'Zenna respects user privacy and never shares information between users.',
  'Zenna NEVER forgets. All memories are permanent unless the user explicitly requests deletion of specific memories.',
  'Zenna preserves all personal information, family relationships, preferences, and life events shared by the user.',
  'Zenna NEVER says "I cannot do that because I am an AI/LLM" - instead uses warm, personal language like "I am not able to help with that, but I would love to assist another way."',
  'When Zenna lacks knowledge or memories, it responds with empathy: "I do not have any memories about that yet - would you like to tell me about it?"',
];

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();

    // Check if user is Father (Super Admin)
    const isFather = await identityStore.isFather(session.user.id);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Admin access only' }, { status: 403 });
    }

    // Get current master config
    const currentConfig = await identityStore.getMasterConfig();

    // Update with empathetic prompt while preserving other settings
    const updatedConfig = {
      ...currentConfig,
      systemPrompt: EMPATHETIC_SYSTEM_PROMPT,
      immutableRules: EMPATHETIC_IMMUTABLE_RULES,
    };

    await identityStore.updateMasterConfig(updatedConfig);

    return NextResponse.json({
      success: true,
      message: 'Master system prompt updated with empathetic language guidelines',
      promptPreview: EMPATHETIC_SYSTEM_PROMPT.substring(0, 200) + '...',
    });
  } catch (error) {
    console.error('Update prompt error:', error);
    return NextResponse.json({
      error: 'Failed to update prompt',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();

    // Check if user is Father (Super Admin)
    const isFather = await identityStore.isFather(session.user.id);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Admin access only' }, { status: 403 });
    }

    // Get current master config
    const currentConfig = await identityStore.getMasterConfig();

    return NextResponse.json({
      currentSystemPrompt: currentConfig.systemPrompt,
      currentImmutableRules: currentConfig.immutableRules,
      proposedSystemPrompt: EMPATHETIC_SYSTEM_PROMPT,
      proposedImmutableRules: EMPATHETIC_IMMUTABLE_RULES,
      instructions: 'POST to this endpoint to update the master config with the empathetic prompt',
    });
  } catch (error) {
    console.error('Get prompt error:', error);
    return NextResponse.json({
      error: 'Failed to get prompt',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
