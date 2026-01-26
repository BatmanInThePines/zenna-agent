import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await identityStore.getUser(payload.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isFather = await identityStore.isFather(payload.userId);

    return NextResponse.json({
      settings: user.settings,
      isFather,
    });
  } catch (error) {
    console.error('Settings fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await identityStore.verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updates = await request.json();

    await identityStore.updateSettings(payload.userId, updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Settings update error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
