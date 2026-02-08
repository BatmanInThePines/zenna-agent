/**
 * Agent Onboarding API
 *
 * Father-only endpoints for managing OpenClaw BOT workforce agents.
 * Handles agent creation, listing, and configuration updates.
 *
 * GET  /api/admin/agents — List all agent users
 * POST /api/admin/agents — Create a new agent user
 * PATCH /api/admin/agents — Update agent configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isFather } from '@/lib/utils/permissions';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET — List all agent users (Father only)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.email || !isFather(session.user.email)) {
    return NextResponse.json({ error: 'Unauthorized: Father access required' }, { status: 403 });
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, user_type, autonomy_level, sprint_assignment_access, backlog_write_access, memory_scope, god_mode, created_at, last_login_at')
    .in('user_type', ['worker_agent', 'architect_agent'])
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agents: data || [] });
}

/**
 * POST — Create a new agent user (Father only)
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !isFather(session.user.email)) {
    return NextResponse.json({ error: 'Unauthorized: Father access required' }, { status: 403 });
  }

  const body = await req.json();
  const {
    email,
    userType,
    description,
    autonomyLevel = 5,
    memoryScope = ['engineering'],
    godMode = false,
    backlogWriteAccess = false,
    sprintAssignmentAccess = false,
  } = body;

  if (!email || !userType || !description) {
    return NextResponse.json(
      { error: 'Missing required fields: email, userType, description' },
      { status: 400 }
    );
  }

  if (!['worker_agent', 'architect_agent'].includes(userType)) {
    return NextResponse.json(
      { error: 'userType must be "worker_agent" or "architect_agent"' },
      { status: 400 }
    );
  }

  try {
    const { SupabaseIdentityStore } = await import('@/core/providers/identity/supabase-identity');
    const identityStore = new SupabaseIdentityStore({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      jwtSecret: process.env.AUTH_SECRET || 'dev-secret',
    });

    const agent = await identityStore.createAgentUser(email, userType, {
      description,
      memoryScope,
      autonomyLevel,
      godMode,
      backlogWriteAccess,
      sprintAssignmentAccess,
    });

    // Audit log
    const supabase = getSupabase();
    await supabase.from('admin_audit_log').insert({
      admin_email: session.user.email,
      action: 'agent_create',
      target_user_id: agent.id,
      target_user_email: email,
      details: { userType, autonomyLevel, memoryScope, godMode },
    });

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        username: agent.username,
        userType: agent.userType,
        autonomyLevel: agent.autonomyLevel,
        memoryScope: agent.memoryScope,
        godMode: agent.godMode,
        sprintAssignmentAccess: agent.sprintAssignmentAccess,
        backlogWriteAccess: agent.backlogWriteAccess,
      },
    });
  } catch (error) {
    console.error('[Admin/Agents] Create agent error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create agent' },
      { status: 500 }
    );
  }
}

/**
 * PATCH — Update agent configuration (Father only)
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !isFather(session.user.email)) {
    return NextResponse.json({ error: 'Unauthorized: Father access required' }, { status: 403 });
  }

  const body = await req.json();
  const { agentId, ...updates } = body;

  if (!agentId) {
    return NextResponse.json({ error: 'Missing required field: agentId' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Only allow updating agent-specific fields
  const allowedFields: Record<string, string> = {
    autonomyLevel: 'autonomy_level',
    sprintAssignmentAccess: 'sprint_assignment_access',
    backlogWriteAccess: 'backlog_write_access',
    memoryScope: 'memory_scope',
    godMode: 'god_mode',
  };

  const dbUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields[key]) {
      dbUpdates[allowedFields[key]] = value;
    }
  }

  if (Object.keys(dbUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', agentId)
    .in('user_type', ['worker_agent', 'architect_agent']);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit log
  await supabase.from('admin_audit_log').insert({
    admin_email: session.user.email,
    action: 'agent_update',
    target_user_id: agentId,
    details: dbUpdates,
  });

  return NextResponse.json({ success: true, updated: dbUpdates });
}
