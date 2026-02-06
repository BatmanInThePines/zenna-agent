/**
 * Avatar Generation Limits API
 *
 * Returns the user's current generation limits and usage.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { canUserGenerate, getMonthlyGenerationCount } from '@/lib/avatar/supabase-reconstruction-store';
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
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const identityStore = getIdentityStore();
    const user = await identityStore.getUser(session.user.id);
    const userRole = user?.role || 'user';

    const limitCheck = await canUserGenerate(session.user.id, userRole);
    const used = await getMonthlyGenerationCount(session.user.id);

    return NextResponse.json({
      allowed: limitCheck.allowed,
      remaining: limitCheck.remaining,
      limit: limitCheck.limit,
      used,
      isUnlimited: limitCheck.isUnlimited,
      role: userRole,
      resetsAt: getNextMonthReset(),
    });
  } catch (error) {
    console.error('Failed to get generation limits:', error);
    return NextResponse.json({ error: 'Failed to get limits' }, { status: 500 });
  }
}

function getNextMonthReset(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}
