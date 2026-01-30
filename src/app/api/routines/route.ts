import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { RoutineStore } from '@/core/providers/routines/routine-store';
import { ScheduledRoutine } from '@/core/interfaces/integration-manifest';

function getRoutineStore() {
  return new RoutineStore({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });
}

/**
 * GET /api/routines - List all routines for the current user
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const routineStore = getRoutineStore();
    const routines = await routineStore.getRoutinesForUser(userId);

    return NextResponse.json({ routines });
  } catch (error) {
    console.error('Get routines error:', error);
    return NextResponse.json({ error: 'Failed to get routines' }, { status: 500 });
  }
}

/**
 * POST /api/routines - Create a new routine
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const body = await request.json();
    const { integrationId, actionId, name, description, schedule, parameters } = body;

    // Validate required fields
    if (!integrationId || !actionId || !name || !schedule) {
      return NextResponse.json(
        { error: 'Missing required fields: integrationId, actionId, name, schedule' },
        { status: 400 }
      );
    }

    // Validate schedule
    if (!schedule.type || !schedule.time) {
      return NextResponse.json(
        { error: 'Schedule must include type and time' },
        { status: 400 }
      );
    }

    const routineStore = getRoutineStore();
    const routine = await routineStore.createRoutine({
      userId: userId,
      integrationId,
      actionId,
      name,
      description,
      schedule,
      parameters: parameters || {},
      enabled: true,
    });

    return NextResponse.json({ routine }, { status: 201 });
  } catch (error) {
    console.error('Create routine error:', error);
    return NextResponse.json({ error: 'Failed to create routine' }, { status: 500 });
  }
}
