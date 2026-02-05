/**
 * 360Aware Action Block Handler
 *
 * Processes action blocks from the LLM when the 360Aware product is active.
 * Queries the 360Aware API for road safety data and formats responses for voice.
 */

import { get360AwareNearbyHazards, get360AwareEnforcement, get360AwareCollisions, get360AwareRoadInfo } from '@/lib/360aware-api';

export interface ActionBlock {
  action: string;
  type: string;
  radius_km?: number;
  years?: number;
}

export interface UserLocation {
  lat: number;
  lng: number;
  heading?: number | null;
}

/**
 * Handle 360Aware action blocks
 */
export async function handle360AwareAction(
  action: ActionBlock,
  userLocation: UserLocation
): Promise<{ result: string; highlights?: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> }> {
  if (action.action !== 'query_360aware') {
    return { result: "I couldn't process that request." };
  }

  const { lat, lng, heading } = userLocation;
  const radiusKm = action.radius_km || 2;

  try {
    switch (action.type) {
      case 'nearby_hazards': {
        const hazards = await get360AwareNearbyHazards(lat, lng, radiusKm);
        return formatHazardsForVoice(hazards, heading);
      }

      case 'enforcement': {
        const zones = await get360AwareEnforcement(lat, lng, radiusKm);
        return formatEnforcementForVoice(zones, heading);
      }

      case 'collisions': {
        const years = action.years || 5;
        const collisions = await get360AwareCollisions(lat, lng, radiusKm, years);
        return formatCollisionsForVoice(collisions);
      }

      case 'road_info': {
        const info = await get360AwareRoadInfo(lat, lng);
        return formatRoadInfoForVoice(info);
      }

      default:
        return { result: "I couldn't find that information." };
    }
  } catch (error) {
    console.error('360Aware action error:', error);
    return { result: "I'm having trouble accessing road data right now. Please try again." };
  }
}

/**
 * Format hazards for voice output
 */
function formatHazardsForVoice(
  hazards: Array<{
    id: string;
    type: string;
    distance: number;
    bearing: number;
    description?: string;
    createdAt: string;
  }>,
  heading?: number | null
): { result: string; highlights?: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> } {
  if (!hazards || hazards.length === 0) {
    return { result: "No hazards reported nearby. Drive safe." };
  }

  // Sort by distance
  const sorted = [...hazards].sort((a, b) => a.distance - b.distance);
  const nearest = sorted[0];

  const direction = heading != null
    ? bearingToRelativeDirection(nearest.bearing, heading)
    : `${Math.round(nearest.distance)} metres away`;

  const typeLabels: Record<string, string> = {
    hazard: 'Hazard',
    construction: 'Construction',
    incident: 'Incident',
    weather: 'Weather conditions',
  };

  const typeLabel = typeLabels[nearest.type] || 'Report';
  let result = `${typeLabel} reported ${direction}.`;

  if (sorted.length > 1) {
    result += ` ${sorted.length - 1} more nearby.`;
  }

  // Include highlights for map
  const highlights = sorted.slice(0, 3).map(h => ({
    type: 'hazard',
    id: h.id,
    action: 'pulse' as const,
  }));

  return { result, highlights };
}

/**
 * Format enforcement zones for voice output
 */
function formatEnforcementForVoice(
  zones: Array<{
    id: string;
    type: string;
    distance: number;
    bearing: number;
    speedLimit?: number;
    name?: string;
  }>,
  heading?: number | null
): { result: string; highlights?: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> } {
  if (!zones || zones.length === 0) {
    return { result: "No enforcement zones detected nearby." };
  }

  // Filter to zones ahead (within 90 degrees of heading)
  const aheadZones = heading != null
    ? zones.filter(z => isAhead(z.bearing, heading))
    : zones;

  if (aheadZones.length === 0) {
    return { result: "No enforcement zones ahead." };
  }

  // Sort by distance
  const sorted = [...aheadZones].sort((a, b) => a.distance - b.distance);
  const nearest = sorted[0];

  const direction = heading != null
    ? bearingToRelativeDirection(nearest.bearing, heading)
    : `${Math.round(nearest.distance)} metres away`;

  const typeLabels: Record<string, string> = {
    speed_camera: 'Speed camera',
    red_light_camera: 'Red light camera',
    school_zone: 'School zone',
    hospital_zone: 'Hospital zone',
    construction_zone: 'Construction zone',
  };

  const typeLabel = typeLabels[nearest.type] || 'Enforcement zone';
  let result = `${typeLabel} ${direction}.`;

  if (nearest.speedLimit) {
    result += ` Limit is ${nearest.speedLimit}.`;
  }

  if (sorted.length > 1) {
    result += ` ${sorted.length - 1} more ahead.`;
  }

  const highlights = sorted.slice(0, 3).map(z => ({
    type: 'enforcement',
    id: z.id,
    action: 'pulse' as const,
  }));

  return { result, highlights };
}

/**
 * Format collision history for voice output
 */
function formatCollisionsForVoice(
  collisions: Array<{
    id: string;
    severity: string;
    distance: number;
    occurredAt: string;
  }>
): { result: string; highlights?: Array<{ type: string; id: string; action: 'pulse' | 'highlight' }> } {
  if (!collisions || collisions.length === 0) {
    return { result: "No significant incidents recorded in this area recently." };
  }

  const total = collisions.length;
  const fatal = collisions.filter(c => c.severity === 'fatal').length;
  const serious = collisions.filter(c => c.severity === 'injury').length;

  let result = `This area has had ${total} incident${total !== 1 ? 's' : ''} in the past few years.`;

  if (fatal > 0) {
    result += ` ${fatal} ${fatal === 1 ? 'was' : 'were'} fatal.`;
  } else if (serious > 0) {
    result += ` ${serious} involved injuries.`;
  }

  result += ' Stay alert.';

  const highlights = collisions.slice(0, 5).map(c => ({
    type: 'collision',
    id: c.id,
    action: 'highlight' as const,
  }));

  return { result, highlights };
}

/**
 * Format road info for voice output
 */
function formatRoadInfoForVoice(
  info: {
    streetName?: string;
    speedLimit?: number;
    roadType?: string;
  } | null
): { result: string } {
  if (!info) {
    return { result: "I couldn't identify this road." };
  }

  let result = '';

  if (info.streetName) {
    result += `You're on ${info.streetName}.`;
  }

  if (info.speedLimit) {
    result += ` Speed limit is ${info.speedLimit}.`;
  }

  if (!result) {
    return { result: "Road information not available for this location." };
  }

  return { result: result.trim() };
}

/**
 * Convert absolute bearing to relative direction based on user heading
 */
function bearingToRelativeDirection(bearing: number, heading: number): string {
  // Calculate relative bearing (0 = ahead, 180 = behind)
  let relative = bearing - heading;

  // Normalize to -180 to 180
  while (relative > 180) relative -= 360;
  while (relative < -180) relative += 360;

  // Convert to direction string
  if (relative >= -22.5 && relative < 22.5) {
    return 'ahead';
  } else if (relative >= 22.5 && relative < 67.5) {
    return 'ahead on your right';
  } else if (relative >= 67.5 && relative < 112.5) {
    return 'on your right';
  } else if (relative >= 112.5 && relative < 157.5) {
    return 'behind on your right';
  } else if (relative >= 157.5 || relative < -157.5) {
    return 'behind';
  } else if (relative >= -157.5 && relative < -112.5) {
    return 'behind on your left';
  } else if (relative >= -112.5 && relative < -67.5) {
    return 'on your left';
  } else {
    return 'ahead on your left';
  }
}

/**
 * Check if a bearing is "ahead" (within 90 degrees of heading)
 */
function isAhead(bearing: number, heading: number): boolean {
  let relative = bearing - heading;
  while (relative > 180) relative -= 360;
  while (relative < -180) relative += 360;
  return relative >= -90 && relative <= 90;
}
