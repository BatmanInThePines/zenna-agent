/**
 * Admin Avatar Management API
 *
 * Super Admin (Father) can:
 * - List ALL completed avatar reconstructions from all users
 * - Set which avatars are used as system presets
 * - Configure default avatar for new users
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { createClient } from '@supabase/supabase-js';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface AvatarJob {
  id: string;
  user_id: string;
  status: string;
  method: string;
  output_model_url: string | null;
  output_thumbnail_url: string | null;
  input_paths: string[];
  created_at: string;
  completed_at: string | null;
}

/**
 * GET /api/admin/avatars
 * List all completed avatar reconstructions (Admin only)
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();

    // Only Father (Super Admin) can access
    const isFather = await identityStore.isFather(session.user.id);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Admin access only' }, { status: 403 });
    }

    const supabase = getSupabaseClient();

    // Get all completed avatar reconstruction jobs
    const { data: jobs, error } = await supabase
      .from('avatar_reconstruction_jobs')
      .select('id, user_id, status, method, output_model_url, output_thumbnail_url, input_paths, created_at, completed_at')
      .eq('status', 'complete')
      .not('output_model_url', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch avatar jobs:', error);
      return NextResponse.json({ error: 'Failed to fetch avatars' }, { status: 500 });
    }

    // Get current master config for preset info
    const masterConfig = await identityStore.getMasterConfig();

    // Map jobs to avatar objects with preset status
    const avatars = (jobs as AvatarJob[]).map((job) => {
      const isDefaultAvatar = masterConfig.defaultAvatarUrl === job.output_model_url;
      const presetInfo = masterConfig.avatarPresets?.find(
        (p: { modelUrl: string }) => p.modelUrl === job.output_model_url
      );

      return {
        id: job.id,
        userId: job.user_id,
        modelUrl: job.output_model_url,
        thumbnailUrl: job.output_thumbnail_url || job.input_paths?.[0] || null,
        method: job.method,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        // Preset assignment info
        isDefault: isDefaultAvatar,
        presetId: presetInfo?.id || null,
        presetName: presetInfo?.name || null,
      };
    });

    return NextResponse.json({
      avatars,
      currentPresets: masterConfig.avatarPresets || [],
      defaultAvatarUrl: masterConfig.defaultAvatarUrl,
    });
  } catch (error) {
    console.error('Admin avatars error:', error);
    return NextResponse.json({ error: 'Failed to fetch avatars' }, { status: 500 });
  }
}

/**
 * POST /api/admin/avatars/presets
 * Set avatar presets (Admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();

    // Only Father (Super Admin) can access
    const isFather = await identityStore.isFather(session.user.id);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Admin access only' }, { status: 403 });
    }

    const body = await request.json();
    const { action, avatarId, modelUrl, thumbnailUrl, presetId, presetName } = body;

    // Get current master config
    const masterConfig = await identityStore.getMasterConfig();
    const currentPresets = masterConfig.avatarPresets || [];

    let updates: Record<string, unknown> = {};

    switch (action) {
      case 'set_default':
        // Set as the default avatar for new users
        updates = {
          defaultAvatarUrl: modelUrl,
        };
        break;

      case 'add_preset':
        // Add to preset list
        if (!presetId || !presetName || !modelUrl) {
          return NextResponse.json(
            { error: 'presetId, presetName, and modelUrl required' },
            { status: 400 }
          );
        }

        // Check if preset ID already exists
        const existingIndex = currentPresets.findIndex(
          (p: { id: string }) => p.id === presetId
        );

        if (existingIndex >= 0) {
          // Update existing preset
          currentPresets[existingIndex] = {
            id: presetId,
            name: presetName,
            modelUrl,
            thumbnailUrl: thumbnailUrl || modelUrl,
          };
        } else {
          // Add new preset
          currentPresets.push({
            id: presetId,
            name: presetName,
            modelUrl,
            thumbnailUrl: thumbnailUrl || modelUrl,
          });
        }

        updates = { avatarPresets: currentPresets };
        break;

      case 'remove_preset':
        // Remove from preset list
        if (!presetId) {
          return NextResponse.json({ error: 'presetId required' }, { status: 400 });
        }

        const filteredPresets = currentPresets.filter(
          (p: { id: string }) => p.id !== presetId
        );
        updates = { avatarPresets: filteredPresets };
        break;

      case 'set_preset_order':
        // Reorder presets (expects array of preset IDs)
        const { presetOrder } = body;
        if (!presetOrder || !Array.isArray(presetOrder)) {
          return NextResponse.json({ error: 'presetOrder array required' }, { status: 400 });
        }

        const reorderedPresets = presetOrder
          .map((id: string) => currentPresets.find((p: { id: string }) => p.id === id))
          .filter(Boolean);

        updates = { avatarPresets: reorderedPresets };
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Apply updates
    await identityStore.updateMasterConfig(updates);

    // Return updated config
    const updatedConfig = await identityStore.getMasterConfig();

    return NextResponse.json({
      success: true,
      presets: updatedConfig.avatarPresets || [],
      defaultAvatarUrl: updatedConfig.defaultAvatarUrl,
    });
  } catch (error) {
    console.error('Admin avatar preset error:', error);
    return NextResponse.json({ error: 'Failed to update presets' }, { status: 500 });
  }
}
