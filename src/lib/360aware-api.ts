/**
 * 360Aware API Client
 *
 * Client for querying 360Aware's road safety data endpoints.
 * Used by the action handler to fetch real-time road data.
 */

const THREESIXTY_AWARE_API_URL = process.env.THREESIXTY_AWARE_API_URL || 'https://360aware.com.au';
const THREESIXTY_AWARE_SHARED_SECRET = process.env.THREESIXTY_AWARE_SHARED_SECRET;

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Make authenticated request to 360Aware API
 */
async function fetch360AwareAPI<T>(
  endpoint: string,
  params: Record<string, string | number>
): Promise<T | null> {
  const url = new URL(`/api/zenna${endpoint}`, THREESIXTY_AWARE_API_URL);

  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-zenna-auth': THREESIXTY_AWARE_SHARED_SECRET || '',
      },
      // Short timeout for driving context
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`360Aware API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: APIResponse<T> = await response.json();

    if (!data.success) {
      console.error(`360Aware API error: ${data.error}`);
      return null;
    }

    return data.data || null;
  } catch (error) {
    console.error('360Aware API fetch error:', error);
    return null;
  }
}

/**
 * Hazard report from 360Aware
 */
export interface Hazard {
  id: string;
  type: 'hazard' | 'construction' | 'incident' | 'weather';
  lat: number;
  lng: number;
  distance: number;
  bearing: number;
  description?: string;
  createdAt: string;
  confidence: string;
}

/**
 * Get nearby hazards (crowd-reported)
 */
export async function get360AwareNearbyHazards(
  lat: number,
  lng: number,
  radiusKm: number = 2
): Promise<Hazard[]> {
  const data = await fetch360AwareAPI<{ hazards: Hazard[] }>('/nearby-hazards', {
    lat,
    lng,
    radius: radiusKm,
  });

  return data?.hazards || [];
}

/**
 * Enforcement zone from 360Aware
 */
export interface EnforcementZone {
  id: string;
  type: 'speed_camera' | 'red_light_camera' | 'school_zone' | 'hospital_zone' | 'construction_zone';
  lat: number;
  lng: number;
  distance: number;
  bearing: number;
  speedLimit?: number;
  name?: string;
  active: boolean;
}

/**
 * Get nearby enforcement zones
 */
export async function get360AwareEnforcement(
  lat: number,
  lng: number,
  radiusKm: number = 2
): Promise<EnforcementZone[]> {
  const data = await fetch360AwareAPI<{ enforcement: EnforcementZone[] }>('/nearby-enforcement', {
    lat,
    lng,
    radius: radiusKm,
  });

  return data?.enforcement || [];
}

/**
 * Historical collision from 360Aware
 */
export interface Collision {
  id: string;
  lat: number;
  lng: number;
  distance: number;
  bearing: number;
  severity: 'fatal' | 'injury' | 'property_damage';
  collisionType?: string;
  occurredAt: string;
  streetName?: string;
}

/**
 * Get historical collision data
 */
export async function get360AwareCollisions(
  lat: number,
  lng: number,
  radiusKm: number = 1,
  years: number = 5
): Promise<Collision[]> {
  const data = await fetch360AwareAPI<{ collisions: Collision[] }>('/collision-history', {
    lat,
    lng,
    radius: radiusKm,
    years,
  });

  return data?.collisions || [];
}

/**
 * Road information from 360Aware
 */
export interface RoadInfo {
  streetName?: string;
  speedLimit?: number;
  roadType?: string;
  suburb?: string;
}

/**
 * Get road information for current location
 */
export async function get360AwareRoadInfo(
  lat: number,
  lng: number
): Promise<RoadInfo | null> {
  const data = await fetch360AwareAPI<{ roadInfo: RoadInfo }>('/road-info', {
    lat,
    lng,
  });

  return data?.roadInfo || null;
}
