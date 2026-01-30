import { NextResponse } from 'next/server';
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
    const identityStore = getIdentityStore();
    const cookieStore = await cookies();
    const token = cookieStore.get('zenna-session')?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false });
    }

    const payload = await identityStore.verifyToken(token);

    if (!payload) {
      return NextResponse.json({ authenticated: false });
    }

    // Verify session is still valid
    const session = await identityStore.validateSession(payload.sessionId);

    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    // Get user details
    const user = await identityStore.getUser(payload.userId);

    if (!user) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ authenticated: false });
  }
}
