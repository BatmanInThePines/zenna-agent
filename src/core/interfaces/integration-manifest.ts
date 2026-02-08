/**
 * Integration Manifest System
 *
 * Defines the capabilities and actions available for each integration.
 * Used for:
 * - User education on integration capabilities
 * - LLM context for understanding available actions
 * - Scheduled routine definitions
 */

import type { HueManifest } from './user-identity';

export interface IntegrationCapability {
  id: string;
  name: string;
  description: string;
  examples: string[];
  requiresScheduling?: boolean;
}

export interface IntegrationManifest {
  id: string;
  name: string;
  icon: string;
  description: string;
  capabilities: IntegrationCapability[];
  schedulableActions: SchedulableAction[];
}

export interface SchedulableAction {
  id: string;
  name: string;
  description: string;
  parameters: ScheduleParameter[];
}

export interface ScheduleParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'time' | 'select';
  required: boolean;
  options?: string[]; // For 'select' type
  description: string;
}

// ============================================
// INTEGRATION MANIFESTS
// ============================================

export const INTEGRATION_MANIFESTS: Record<string, IntegrationManifest> = {
  hue: {
    id: 'hue',
    name: 'Philips Hue',
    icon: '💡',
    description: 'Control your Philips Hue smart lights - turn them on/off, adjust brightness, change colors, and create schedules.',
    capabilities: [
      {
        id: 'light-control',
        name: 'Light Control',
        description: 'Turn lights on or off, individually or by room/zone',
        examples: [
          'Turn on the living room lights',
          'Turn off all the lights',
          'Turn on the bedroom lamp',
        ],
      },
      {
        id: 'brightness',
        name: 'Brightness Control',
        description: 'Adjust the brightness level of your lights',
        examples: [
          'Dim the kitchen lights to 50%',
          'Set the bedroom lights to full brightness',
          'Make the lights brighter',
        ],
      },
      {
        id: 'color',
        name: 'Color Control',
        description: 'Change the color or color temperature of compatible lights',
        examples: [
          'Set the living room to warm white',
          'Make the bedroom lights blue',
          'Change the lights to a sunset color',
        ],
      },
      {
        id: 'scenes',
        name: 'Scene Activation',
        description: 'Activate pre-configured lighting scenes',
        examples: [
          'Activate the movie scene',
          'Set the lights to relax mode',
          'Turn on the reading scene',
        ],
      },
      {
        id: 'scheduling',
        name: 'Light Scheduling',
        description: 'Set lights to turn on or off at specific times',
        examples: [
          'Turn on the porch light at sunset',
          'Turn off all lights at 11 PM',
          'Wake me up with lights at 7 AM',
        ],
        requiresScheduling: true,
      },
    ],
    schedulableActions: [
      {
        id: 'turn-on',
        name: 'Turn On Lights',
        description: 'Turn on specified lights at a scheduled time',
        parameters: [
          { name: 'target', type: 'string', required: true, description: 'Light or room name' },
          { name: 'brightness', type: 'number', required: false, description: 'Brightness level (1-100)' },
          { name: 'color', type: 'string', required: false, description: 'Color name or hex code' },
        ],
      },
      {
        id: 'turn-off',
        name: 'Turn Off Lights',
        description: 'Turn off specified lights at a scheduled time',
        parameters: [
          { name: 'target', type: 'string', required: true, description: 'Light or room name' },
        ],
      },
      {
        id: 'activate-scene',
        name: 'Activate Scene',
        description: 'Activate a lighting scene at a scheduled time',
        parameters: [
          { name: 'scene', type: 'string', required: true, description: 'Scene name' },
        ],
      },
    ],
  },

  notion: {
    id: 'notion',
    name: 'Notion',
    icon: '📝',
    description: 'Access your Notion workspace - search through pages, retrieve knowledge, and stay connected to your notes.',
    capabilities: [
      {
        id: 'knowledge-search',
        name: 'Knowledge Search',
        description: 'Search through your Notion pages and databases for relevant information',
        examples: [
          'What do my notes say about project deadlines?',
          'Find my meeting notes from last week',
          'Search for information about the Q4 budget',
        ],
      },
      {
        id: 'context-awareness',
        name: 'Contextual Knowledge',
        description: 'Zenna remembers information from your Notion workspace to provide context-aware responses',
        examples: [
          'Based on my notes, what should I focus on today?',
          'Remind me what I wrote about the marketing strategy',
          'What were the key takeaways from the team meeting?',
        ],
      },
      {
        id: 'page-retrieval',
        name: 'Page Retrieval',
        description: 'Retrieve and summarize specific pages from your workspace',
        examples: [
          'Summarize my project roadmap page',
          'What\'s on my personal goals page?',
          'Read me my weekly review notes',
        ],
      },
      {
        id: 'task-management',
        name: 'Task & Backlog Management',
        description: 'Add tasks, bugs, and items to Notion databases',
        examples: [
          'Add this bug to the sprint backlog',
          'Create a feature request in my roadmap',
          'Log this as a backlog item',
        ],
      },
      {
        id: 'page-creation',
        name: 'Page & Knowledge Creation',
        description: 'Create new pages and document conversations in Notion',
        examples: [
          'Document this discussion in Notion',
          'Create meeting notes from our conversation',
          'Add a page about the product idea we discussed',
        ],
      },
    ],
    schedulableActions: [],
  },
};

// ============================================
// SCHEDULED ROUTINE TYPES
// ============================================

export interface ScheduledRoutine {
  id: string;
  userId: string;
  integrationId: string;
  actionId: string;
  name: string;
  description?: string;
  schedule: RoutineSchedule;
  parameters: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastExecutedAt?: number;
  nextExecutionAt?: number;
}

export interface RoutineSchedule {
  type: 'once' | 'daily' | 'weekly' | 'custom';
  time: string; // HH:MM format
  timezone?: string;
  // For weekly schedules
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday, etc.
  // For one-time schedules
  date?: string; // YYYY-MM-DD format
  // For custom cron expressions
  cron?: string;
}

// ============================================
// INTEGRATION ONBOARDING
// ============================================

export interface IntegrationOnboardingState {
  integrationId: string;
  connectedAt: number;
  educationOffered: boolean;
  educationAccepted?: boolean;
  educationCompletedAt?: number;
}

/**
 * Get education content for an integration.
 * When hueManifest is provided, uses real device/room/scene names in examples.
 */
export function getIntegrationEducation(
  integrationId: string,
  hueManifest?: HueManifest
): string {
  const manifest = INTEGRATION_MANIFESTS[integrationId];
  if (!manifest) return '';

  let education = `Great news! I'm now connected to your ${manifest.name}! ${manifest.icon}\n\n`;
  education += `${manifest.description}\n\n`;

  // Use real Hue manifest data when available
  if (integrationId === 'hue' && hueManifest && hueManifest.rooms.length > 0) {
    const roomNames = hueManifest.rooms.map(r => r.name);
    const sceneNames = hueManifest.scenes.map(s => s.name);
    const firstRoom = roomNames[0];
    const secondRoom = roomNames[1] || roomNames[0];
    const firstScene = sceneNames[0];

    education += `I can see your home setup:\n\n`;
    education += `**Rooms:** ${roomNames.join(', ')}\n`;
    if (sceneNames.length > 0) {
      education += `**Scenes:** ${sceneNames.slice(0, 8).join(', ')}${sceneNames.length > 8 ? '...' : ''}\n`;
    }
    education += `\nHere's what you can say to me:\n\n`;
    education += `**1. Light Control**\nTurn lights on or off by room\nTry: "Turn on the ${firstRoom} lights"\n\n`;
    education += `**2. Brightness**\nAdjust brightness levels\nTry: "Dim the ${secondRoom} lights to 50%"\n\n`;
    education += `**3. Colors**\nChange light colors on compatible bulbs\nTry: "Set the ${firstRoom} to warm white"\n\n`;
    if (firstScene) {
      education += `**4. Scenes**\nActivate your saved lighting scenes\nTry: "Activate the ${firstScene} scene"\n\n`;
    }
    education += `**5. Automations**\nSchedule lights on a timer\nTry: "Wake me up with a sunrise glow in the ${firstRoom} each morning starting at 7am"\n\n`;

    // Demo offer using real room name
    education += `\n**Want to try it out?** I can do a quick demo right now! I'll set the **${firstRoom}** lights to 80% navy blue, then restore them to their current state afterward. Just say "yes, show me!" to see it in action.\n`;
  } else {
    // Generic examples when no manifest available
    education += `Here's what I can help you with:\n\n`;
    manifest.capabilities.forEach((cap, index) => {
      education += `**${index + 1}. ${cap.name}**\n`;
      education += `${cap.description}\n`;
      education += `Try saying: "${cap.examples[0]}"\n\n`;
    });
  }

  if (manifest.schedulableActions.length > 0) {
    education += `\n**Scheduling**: I can also set up automatic routines! `;
    education += `Just tell me what you'd like to automate, and I'll remember to do it.\n`;
  }

  return education;
}

/**
 * Get a brief summary for LLM context
 */
export function getIntegrationContextSummary(integrationId: string): string {
  const manifest = INTEGRATION_MANIFESTS[integrationId];
  if (!manifest) return '';

  const capabilities = manifest.capabilities.map(c => c.name).join(', ');
  return `${manifest.name}: ${capabilities}`;
}
