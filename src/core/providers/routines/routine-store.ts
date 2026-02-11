/**
 * Scheduled Routines Store
 *
 * Handles persistent storage of user-defined routines
 * (e.g., "turn on lights at 7 AM every day")
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from '@/lib/supabase/clients';
import { ScheduledRoutine, RoutineSchedule } from '@/core/interfaces/integration-manifest';

export interface RoutineStoreConfig {
  supabaseUrl: string;
  supabaseKey: string;
  /** Supabase-compatible JWT for RLS-scoped access. */
  accessToken?: string;
}

export class RoutineStore {
  private supabase: SupabaseClient;

  constructor(config: RoutineStoreConfig) {
    if (config.accessToken) {
      this.supabase = createUserClient(config.accessToken);
    } else {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    }
  }

  /**
   * Create a new scheduled routine
   */
  async createRoutine(routine: Omit<ScheduledRoutine, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScheduledRoutine> {
    const now = Date.now();
    const newRoutine: ScheduledRoutine = {
      ...routine,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      nextExecutionAt: this.calculateNextExecution(routine.schedule),
    };

    const { error } = await this.supabase
      .from('scheduled_routines')
      .insert({
        id: newRoutine.id,
        user_id: newRoutine.userId,
        integration_id: newRoutine.integrationId,
        action_id: newRoutine.actionId,
        name: newRoutine.name,
        description: newRoutine.description,
        schedule: newRoutine.schedule,
        parameters: newRoutine.parameters,
        enabled: newRoutine.enabled,
        created_at: new Date(newRoutine.createdAt).toISOString(),
        updated_at: new Date(newRoutine.updatedAt).toISOString(),
        next_execution_at: newRoutine.nextExecutionAt
          ? new Date(newRoutine.nextExecutionAt).toISOString()
          : null,
      });

    if (error) {
      console.error('Failed to create routine:', error);
      throw new Error('Failed to create routine');
    }

    return newRoutine;
  }

  /**
   * Get all routines for a user
   */
  async getRoutinesForUser(userId: string): Promise<ScheduledRoutine[]> {
    const { data, error } = await this.supabase
      .from('scheduled_routines')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to get routines:', error);
      throw new Error('Failed to get routines');
    }

    return (data || []).map(this.mapRowToRoutine);
  }

  /**
   * Get routines that are due for execution
   */
  async getDueRoutines(): Promise<ScheduledRoutine[]> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('scheduled_routines')
      .select('*')
      .eq('enabled', true)
      .lte('next_execution_at', now);

    if (error) {
      console.error('Failed to get due routines:', error);
      throw new Error('Failed to get due routines');
    }

    return (data || []).map(this.mapRowToRoutine);
  }

  /**
   * Update a routine
   */
  async updateRoutine(
    routineId: string,
    updates: Partial<Omit<ScheduledRoutine, 'id' | 'userId' | 'createdAt'>>
  ): Promise<ScheduledRoutine | null> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.schedule !== undefined) {
      updateData.schedule = updates.schedule;
      updateData.next_execution_at = this.calculateNextExecution(updates.schedule)
        ? new Date(this.calculateNextExecution(updates.schedule)!).toISOString()
        : null;
    }
    if (updates.parameters !== undefined) updateData.parameters = updates.parameters;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;
    if (updates.lastExecutedAt !== undefined) {
      updateData.last_executed_at = new Date(updates.lastExecutedAt).toISOString();
    }
    if (updates.nextExecutionAt !== undefined) {
      updateData.next_execution_at = updates.nextExecutionAt
        ? new Date(updates.nextExecutionAt).toISOString()
        : null;
    }

    const { data, error } = await this.supabase
      .from('scheduled_routines')
      .update(updateData)
      .eq('id', routineId)
      .select()
      .single();

    if (error) {
      console.error('Failed to update routine:', error);
      throw new Error('Failed to update routine');
    }

    return data ? this.mapRowToRoutine(data) : null;
  }

  /**
   * Delete a routine
   */
  async deleteRoutine(routineId: string): Promise<void> {
    const { error } = await this.supabase
      .from('scheduled_routines')
      .delete()
      .eq('id', routineId);

    if (error) {
      console.error('Failed to delete routine:', error);
      throw new Error('Failed to delete routine');
    }
  }

  /**
   * Mark routine as executed and calculate next execution time
   */
  async markExecuted(routineId: string, schedule: RoutineSchedule): Promise<void> {
    const now = Date.now();
    const nextExecution = this.calculateNextExecution(schedule, now);

    await this.updateRoutine(routineId, {
      lastExecutedAt: now,
      nextExecutionAt: nextExecution,
      // Disable one-time routines after execution
      enabled: schedule.type !== 'once',
    });
  }

  /**
   * Calculate the next execution time for a schedule
   */
  private calculateNextExecution(schedule: RoutineSchedule, fromTime?: number): number | undefined {
    const now = new Date(fromTime || Date.now());
    const [hours, minutes] = schedule.time.split(':').map(Number);

    // Start with today at the scheduled time
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);

    switch (schedule.type) {
      case 'once':
        // One-time schedule with specific date
        if (schedule.date) {
          const [year, month, day] = schedule.date.split('-').map(Number);
          next.setFullYear(year, month - 1, day);
        }
        // If the time has passed, return undefined (won't execute)
        if (next.getTime() <= now.getTime()) {
          return undefined;
        }
        return next.getTime();

      case 'daily':
        // If today's time has passed, move to tomorrow
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();

      case 'weekly':
        // Find the next occurrence on one of the specified days
        if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
          const currentDay = now.getDay();
          const sortedDays = [...schedule.daysOfWeek].sort((a, b) => a - b);

          // Find the next day that's >= today
          let foundDay = sortedDays.find(d => {
            if (d > currentDay) return true;
            if (d === currentDay && next.getTime() > now.getTime()) return true;
            return false;
          });

          if (foundDay === undefined) {
            // Wrap to next week's first day
            foundDay = sortedDays[0];
            next.setDate(next.getDate() + (7 - currentDay + foundDay));
          } else if (foundDay !== currentDay) {
            next.setDate(next.getDate() + (foundDay - currentDay));
          } else if (next.getTime() <= now.getTime()) {
            // Same day but time passed, move to next occurrence of this day
            next.setDate(next.getDate() + 7);
          }
        }
        return next.getTime();

      default:
        // Default to daily
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime();
    }
  }

  /**
   * Map database row to ScheduledRoutine
   */
  private mapRowToRoutine(row: Record<string, unknown>): ScheduledRoutine {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      integrationId: row.integration_id as string,
      actionId: row.action_id as string,
      name: row.name as string,
      description: row.description as string | undefined,
      schedule: row.schedule as RoutineSchedule,
      parameters: row.parameters as Record<string, unknown>,
      enabled: row.enabled as boolean,
      createdAt: new Date(row.created_at as string).getTime(),
      updatedAt: new Date(row.updated_at as string).getTime(),
      lastExecutedAt: row.last_executed_at
        ? new Date(row.last_executed_at as string).getTime()
        : undefined,
      nextExecutionAt: row.next_execution_at
        ? new Date(row.next_execution_at as string).getTime()
        : undefined,
    };
  }
}
