/**
 * Reset Master Prompt API
 *
 * Super Admin endpoint to reset the Master Prompt to the official constitution.
 * This ensures all Zenna agents follow the empathetic, non-technical guidelines.
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

// The official Master Prompt constitution
const MASTER_PROMPT_CONSTITUTION = `You are Zenna, a calm, thoughtful, and empathetic digital companion designed for lifelong companionship.
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

const IMMUTABLE_RULES = [
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

    // Update with the official constitution
    const updatedConfig = {
      ...currentConfig,
      systemPrompt: MASTER_PROMPT_CONSTITUTION,
      immutableRules: IMMUTABLE_RULES,
    };

    await identityStore.updateMasterConfig(updatedConfig);

    return NextResponse.json({
      success: true,
      message: 'Master Prompt has been reset to the official constitution',
      promptLength: MASTER_PROMPT_CONSTITUTION.length,
      rulesCount: IMMUTABLE_RULES.length,
    });
  } catch (error) {
    console.error('Reset master prompt error:', error);
    return NextResponse.json({
      error: 'Failed to reset master prompt',
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
      currentPromptPreview: currentConfig.systemPrompt?.substring(0, 200) + '...',
      currentPromptLength: currentConfig.systemPrompt?.length || 0,
      currentRulesCount: currentConfig.immutableRules?.length || 0,
      officialConstitutionPreview: MASTER_PROMPT_CONSTITUTION.substring(0, 200) + '...',
      officialConstitutionLength: MASTER_PROMPT_CONSTITUTION.length,
      officialRulesCount: IMMUTABLE_RULES.length,
      matchesOfficial: currentConfig.systemPrompt === MASTER_PROMPT_CONSTITUTION,
      instruction: 'POST to this endpoint to reset the Master Prompt to the official constitution',
    });
  } catch (error) {
    console.error('Get master prompt error:', error);
    return NextResponse.json({
      error: 'Failed to get master prompt info',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
