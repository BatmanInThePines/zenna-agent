/**
 * Routine Executor Service
 *
 * Executes scheduled routines when they're due.
 * Designed to be called periodically (e.g., every minute via cron or API route).
 */

import { RoutineStore } from './routine-store';
import { ScheduledRoutine, INTEGRATION_MANIFESTS } from '@/core/interfaces/integration-manifest';

export interface RoutineExecutorConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface ExecutionResult {
  routineId: string;
  success: boolean;
  error?: string;
  executedAt: number;
}

export class RoutineExecutor {
  private routineStore: RoutineStore;

  constructor(config: RoutineExecutorConfig) {
    this.routineStore = new RoutineStore({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    });
  }

  /**
   * Check for and execute all due routines
   */
  async executeDueRoutines(): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    try {
      const dueRoutines = await this.routineStore.getDueRoutines();
      console.log(`Found ${dueRoutines.length} due routines`);

      for (const routine of dueRoutines) {
        const result = await this.executeRoutine(routine);
        results.push(result);
      }
    } catch (error) {
      console.error('Error checking due routines:', error);
    }

    return results;
  }

  /**
   * Execute a single routine
   */
  private async executeRoutine(routine: ScheduledRoutine): Promise<ExecutionResult> {
    const executedAt = Date.now();

    try {
      console.log(`Executing routine: ${routine.name} (${routine.id})`);

      // Route to appropriate integration handler
      switch (routine.integrationId) {
        case 'hue':
          await this.executeHueAction(routine);
          break;
        case 'notion':
          // Notion doesn't have schedulable actions yet
          console.log('Notion routines not yet implemented');
          break;
        default:
          throw new Error(`Unknown integration: ${routine.integrationId}`);
      }

      // Mark as executed and calculate next execution
      await this.routineStore.markExecuted(routine.id, routine.schedule);

      return {
        routineId: routine.id,
        success: true,
        executedAt,
      };
    } catch (error) {
      console.error(`Failed to execute routine ${routine.id}:`, error);

      // Still update next execution time even on failure
      await this.routineStore.markExecuted(routine.id, routine.schedule);

      return {
        routineId: routine.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt,
      };
    }
  }

  /**
   * Execute a Philips Hue action
   */
  private async executeHueAction(routine: ScheduledRoutine): Promise<void> {
    const { actionId, parameters, userId } = routine;

    // Get user's Hue credentials
    const userSettings = await this.getUserSettings(userId);
    const hueConfig = userSettings?.integrations?.hue;

    if (!hueConfig?.accessToken) {
      throw new Error('Hue not connected for this user');
    }

    // Refresh token if expired
    let accessToken = hueConfig.accessToken;
    if (hueConfig.expiresAt && hueConfig.expiresAt < Date.now()) {
      if (!hueConfig.refreshToken) {
        throw new Error('Hue refresh token not available');
      }
      accessToken = await this.refreshHueToken(hueConfig.refreshToken, userId);
    }

    switch (actionId) {
      case 'turn-on':
        await this.hueSetLightState(accessToken, hueConfig.username, {
          target: parameters.target as string,
          on: true,
          brightness: parameters.brightness as number | undefined,
          color: parameters.color as string | undefined,
        });
        break;

      case 'turn-off':
        await this.hueSetLightState(accessToken, hueConfig.username, {
          target: parameters.target as string,
          on: false,
        });
        break;

      case 'activate-scene':
        await this.hueActivateScene(accessToken, hueConfig.username, {
          scene: parameters.scene as string,
        });
        break;

      default:
        throw new Error(`Unknown Hue action: ${actionId}`);
    }
  }

  /**
   * Set Hue light state via Cloud API
   */
  private async hueSetLightState(
    accessToken: string,
    username: string | undefined,
    options: {
      target: string;
      on: boolean;
      brightness?: number;
      color?: string;
    }
  ): Promise<void> {
    // First, find the light/room by name
    const lightsResponse = await fetch(
      `https://api.meethue.com/route/clip/v2/resource/light`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'hue-application-key': username || '',
        },
      }
    );

    if (!lightsResponse.ok) {
      throw new Error(`Failed to get lights: ${await lightsResponse.text()}`);
    }

    const lightsData = await lightsResponse.json();
    const targetLower = options.target.toLowerCase();

    // Find light by name (case-insensitive partial match)
    const light = lightsData.data?.find((l: { metadata?: { name?: string } }) =>
      l.metadata?.name?.toLowerCase().includes(targetLower)
    );

    if (!light) {
      throw new Error(`Light not found: ${options.target}`);
    }

    // Build the state update
    const stateUpdate: Record<string, unknown> = {
      on: { on: options.on },
    };

    if (options.on && options.brightness !== undefined) {
      stateUpdate.dimming = { brightness: options.brightness };
    }

    // Set the light state
    const updateResponse = await fetch(
      `https://api.meethue.com/route/clip/v2/resource/light/${light.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'hue-application-key': username || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stateUpdate),
      }
    );

    if (!updateResponse.ok) {
      throw new Error(`Failed to set light state: ${await updateResponse.text()}`);
    }

    console.log(`Successfully set light "${options.target}" to ${options.on ? 'ON' : 'OFF'}`);
  }

  /**
   * Activate a Hue scene
   */
  private async hueActivateScene(
    accessToken: string,
    username: string | undefined,
    options: { scene: string }
  ): Promise<void> {
    // Get all scenes
    const scenesResponse = await fetch(
      `https://api.meethue.com/route/clip/v2/resource/scene`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'hue-application-key': username || '',
        },
      }
    );

    if (!scenesResponse.ok) {
      throw new Error(`Failed to get scenes: ${await scenesResponse.text()}`);
    }

    const scenesData = await scenesResponse.json();
    const targetLower = options.scene.toLowerCase();

    // Find scene by name
    const scene = scenesData.data?.find((s: { metadata?: { name?: string } }) =>
      s.metadata?.name?.toLowerCase().includes(targetLower)
    );

    if (!scene) {
      throw new Error(`Scene not found: ${options.scene}`);
    }

    // Recall (activate) the scene
    const activateResponse = await fetch(
      `https://api.meethue.com/route/clip/v2/resource/scene/${scene.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'hue-application-key': username || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recall: { action: 'active' } }),
      }
    );

    if (!activateResponse.ok) {
      throw new Error(`Failed to activate scene: ${await activateResponse.text()}`);
    }

    console.log(`Successfully activated scene "${options.scene}"`);
  }

  /**
   * Refresh Hue OAuth token
   */
  private async refreshHueToken(refreshToken: string, userId: string): Promise<string> {
    const clientId = process.env.HUE_CLIENT_ID;
    const clientSecret = process.env.HUE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Hue OAuth not configured');
    }

    const response = await fetch('https://api.meethue.com/v2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh Hue token');
    }

    const tokens = await response.json();

    // Update stored tokens
    await this.updateUserHueTokens(userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    return tokens.access_token;
  }

  /**
   * Get user settings from database
   */
  private async getUserSettings(userId: string): Promise<{
    integrations?: {
      hue?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        username?: string;
      };
    };
  } | null> {
    // This would normally use identityStore, but we're keeping it simple
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await supabase
      .from('users')
      .select('settings')
      .eq('id', userId)
      .single();

    return data?.settings || null;
  }

  /**
   * Update user's Hue tokens
   */
  private async updateUserHueTokens(
    userId: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: number }
  ): Promise<void> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: user } = await supabase
      .from('users')
      .select('settings')
      .eq('id', userId)
      .single();

    const currentSettings = user?.settings || {};

    await supabase.from('users').update({
      settings: {
        ...currentSettings,
        integrations: {
          ...currentSettings.integrations,
          hue: {
            ...currentSettings.integrations?.hue,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
          },
        },
      },
    }).eq('id', userId);
  }
}
