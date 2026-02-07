/**
 * API Route: Refresh Hue Manifests for All Users (Admin)
 * POST /api/admin/refresh-hue-manifests
 *
 * Iterates all users with a connected Hue integration and re-fetches
 * their device manifest from the Hue CLIP v2 API.
 * Only accessible by admin / father users.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { isAdmin, isFather } from '@/lib/utils/permissions';
import { fetchHueManifest } from '@/core/services/hue-manifest-builder';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(session.user.role) && !isFather(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabaseClient();

    // Fetch all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, settings');

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    const results: Array<{
      userId: string;
      email?: string;
      status: 'updated' | 'skipped' | 'error';
      reason?: string;
      roomCount?: number;
      lightCount?: number;
      sceneCount?: number;
      deviceCount?: number;
    }> = [];

    for (const user of (users || [])) {
      const settings = user.settings as any;
      const hueConfig = settings?.integrations?.hue;

      // Skip users without Hue connected
      if (!hueConfig?.accessToken || !hueConfig?.username) {
        results.push({
          userId: user.id,
          email: user.email,
          status: 'skipped',
          reason: 'No Hue integration',
        });
        continue;
      }

      try {
        const manifest = await fetchHueManifest(hueConfig.accessToken, hueConfig.username);

        // Deep merge the manifest into existing settings
        const updatedSettings = {
          ...settings,
          integrations: {
            ...settings.integrations,
            hue: {
              ...settings.integrations.hue,
              manifest,
            },
          },
        };

        const { error: updateError } = await supabase
          .from('users')
          .update({ settings: updatedSettings })
          .eq('id', user.id);

        if (updateError) {
          throw new Error(`DB update failed: ${updateError.message}`);
        }

        // Count devices for the report
        let totalLights = 0;
        for (const room of manifest.rooms) {
          totalLights += (room.lights || []).length;
        }

        results.push({
          userId: user.id,
          email: user.email,
          status: 'updated',
          roomCount: manifest.rooms.length,
          lightCount: totalLights,
          sceneCount: manifest.scenes.length,
          deviceCount: manifest.devices.length,
        });

        console.log(
          `[Hue Refresh] Updated manifest for ${user.email}: ` +
          `${manifest.rooms.length} rooms, ${totalLights} lights, ` +
          `${manifest.scenes.length} scenes, ${manifest.devices.length} devices`
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'unknown error';
        console.error(`[Hue Refresh] Failed for ${user.email}:`, errorMsg);
        results.push({
          userId: user.id,
          email: user.email,
          status: 'error',
          reason: errorMsg,
        });
      }
    }

    const updated = results.filter((r) => r.status === 'updated').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errors = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      summary: {
        total: results.length,
        updated,
        skipped,
        errors,
      },
      results,
    });
  } catch (error) {
    console.error('Refresh Hue manifests error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh manifests' },
      { status: 500 }
    );
  }
}
