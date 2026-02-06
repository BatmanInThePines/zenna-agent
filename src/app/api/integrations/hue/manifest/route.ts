import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { fetchHueManifest } from '@/core/services/hue-manifest-builder';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

/**
 * POST /api/integrations/hue/manifest
 * Fetches the user's Hue home manifest and stores it in settings.
 * Called after first-time pairing and on session-start refresh.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(userId);
    const hueConfig = user?.settings?.integrations?.hue;

    if (!hueConfig?.accessToken || !hueConfig?.username) {
      return NextResponse.json({ error: 'Hue not connected' }, { status: 400 });
    }

    console.log('[Hue Manifest] Fetching manifest for user:', userId);
    const manifest = await fetchHueManifest(hueConfig.accessToken, hueConfig.username);

    // Store manifest in user settings (deep merge preserves tokens)
    await identityStore.updateSettings(userId, {
      integrations: {
        hue: {
          manifest,
        },
      },
    });

    console.log(
      `[Hue Manifest] Stored: ${manifest.homes.length} homes, ${manifest.rooms.length} rooms, ${manifest.scenes.length} scenes, ${manifest.zones.length} zones`
    );

    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    console.error('[Hue Manifest] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch manifest' },
      { status: 500 }
    );
  }
}
