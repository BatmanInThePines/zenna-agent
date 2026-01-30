/**
 * Master Settings API - Father (Admin) Only
 *
 * Manages master configuration including:
 * - 3D Avatar presets available to all users
 * - System prompt
 * - Voice configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

function getIdentityStore() {
  return new SupabaseIdentityStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    jwtSecret: process.env.AUTH_SECRET!,
  });
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();
    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Father can access master settings
    const isFather = await identityStore.isFather(payload.userId);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Father access only' }, { status: 403 });
    }

    const masterConfig = await identityStore.getMasterConfig();

    return NextResponse.json({
      avatarPresets: masterConfig.avatarPresets || [],
      defaultAvatarUrl: masterConfig.defaultAvatarUrl,
      systemPrompt: masterConfig.systemPrompt,
      greeting: masterConfig.greeting,
    });
  } catch (error) {
    console.error('Master settings fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch master settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();
    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Father can update master settings
    const isFather = await identityStore.isFather(payload.userId);
    if (!isFather) {
      return NextResponse.json({ error: 'Forbidden - Father access only' }, { status: 403 });
    }

    const updates = await request.json();

    // Validate avatar presets if provided
    if (updates.avatarPresets) {
      for (const preset of updates.avatarPresets) {
        if (!preset.id || !preset.name || !preset.modelUrl) {
          return NextResponse.json(
            { error: 'Each preset must have id, name, and modelUrl' },
            { status: 400 }
          );
        }
      }
    }

    await identityStore.updateMasterConfig(updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Master settings update error:', error);
    return NextResponse.json({ error: 'Failed to update master settings' }, { status: 500 });
  }
}
