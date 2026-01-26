import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';
import { RoutineStore } from '@/core/providers/routines/routine-store';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

const routineStore = new RoutineStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
});

/**
 * PATCH /api/routines/[id] - Update a routine
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    // Only allow updating specific fields
    const allowedUpdates: Record<string, unknown> = {};
    if (body.name !== undefined) allowedUpdates.name = body.name;
    if (body.description !== undefined) allowedUpdates.description = body.description;
    if (body.schedule !== undefined) allowedUpdates.schedule = body.schedule;
    if (body.parameters !== undefined) allowedUpdates.parameters = body.parameters;
    if (body.enabled !== undefined) allowedUpdates.enabled = body.enabled;

    const routine = await routineStore.updateRoutine(id, allowedUpdates);

    if (!routine) {
      return NextResponse.json({ error: 'Routine not found' }, { status: 404 });
    }

    return NextResponse.json({ routine });
  } catch (error) {
    console.error('Update routine error:', error);
    return NextResponse.json({ error: 'Failed to update routine' }, { status: 500 });
  }
}

/**
 * DELETE /api/routines/[id] - Delete a routine
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    await routineStore.deleteRoutine(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete routine error:', error);
    return NextResponse.json({ error: 'Failed to delete routine' }, { status: 500 });
  }
}
