/**
 * Hue Manifest Builder
 *
 * Fetches the user's Philips Hue home manifest from the CLIP v2 API.
 * Returns structured data for rooms, lights, zones, scenes, and homes.
 * Used after OAuth pairing and for session-start refresh.
 */

import type {
  HueManifest,
  HueHome,
  HueRoom,
  HueZone,
  HueLight,
  HueScene,
} from '@/core/interfaces/user-identity';

const HUE_REMOTE_BASE = 'https://api.meethue.com/route';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeHeaders(accessToken: string, username: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'hue-application-key': username,
  };
}

async function hueApiFetch(path: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(`${HUE_REMOTE_BASE}${path}`, { headers });
  if (!response.ok) {
    const status = response.status;
    const errorText = await response.text();
    if (status === 401) {
      throw new Error('HUE_SESSION_EXPIRED: Access token expired or invalid');
    }
    throw new Error(`Hue API ${path} failed (${status}): ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch the complete Hue home manifest from the CLIP v2 API.
 * Fetches homes, rooms, zones, lights, and scenes in parallel.
 */
export async function fetchHueManifest(
  accessToken: string,
  username: string
): Promise<HueManifest> {
  const headers = makeHeaders(accessToken, username);

  // Fetch all resources in parallel for speed
  const [homesData, roomsData, zonesData, lightsData, scenesData] = await Promise.all([
    hueApiFetch('/clip/v2/resource/bridge_home', headers),
    hueApiFetch('/clip/v2/resource/room', headers),
    hueApiFetch('/clip/v2/resource/zone', headers),
    hueApiFetch('/clip/v2/resource/light', headers),
    hueApiFetch('/clip/v2/resource/scene', headers),
  ]);

  // Build light lookup map: light.id -> HueLight
  const lightMap = new Map<string, HueLight>();
  for (const l of (lightsData.data || [])) {
    lightMap.set(l.id, {
      id: l.id,
      name: l.metadata?.name || 'Unknown Light',
      type: l.metadata?.archetype || l.type || 'unknown',
      supportsColor: !!l.color,
      supportsDimming: !!l.dimming,
      currentState: {
        on: l.on?.on ?? false,
        brightness: l.dimming?.brightness,
        colorXY: l.color?.xy ? { x: l.color.xy.x, y: l.color.xy.y } : undefined,
        colorTemp: l.color_temperature?.mirek,
      },
    });
  }

  // Map homes
  const homes: HueHome[] = (homesData.data || []).map((h: any) => ({
    id: h.id,
    name: h.metadata?.name || 'Home',
  }));

  // Map rooms with their lights
  // CLIP v2: rooms contain device children. Lights reference their owner device.
  const rooms: HueRoom[] = (roomsData.data || []).map((r: any) => {
    const groupedLightRef = (r.services || []).find(
      (s: any) => s.rtype === 'grouped_light'
    );

    // Room children are devices; cross-reference with lights via owner.rid
    const roomDeviceIds = new Set(
      (r.children || [])
        .filter((c: any) => c.rtype === 'device')
        .map((c: any) => c.rid)
    );
    const roomLights = (lightsData.data || [])
      .filter((l: any) => l.owner && roomDeviceIds.has(l.owner.rid))
      .map((l: any) => lightMap.get(l.id))
      .filter(Boolean) as HueLight[];

    return {
      id: r.id,
      name: r.metadata?.name || 'Unknown Room',
      type: r.metadata?.archetype || 'other',
      lights: roomLights,
      groupedLightId: groupedLightRef?.rid,
    };
  });

  // Associate rooms with homes (for multi-home support)
  for (const home of (homesData.data || [])) {
    const homeRoomIds = new Set(
      (home.children || [])
        .filter((c: any) => c.rtype === 'room')
        .map((c: any) => c.rid)
    );
    for (const room of rooms) {
      if (homeRoomIds.has(room.id)) {
        room.homeId = home.id;
      }
    }
  }

  // Map zones
  const zones: HueZone[] = (zonesData.data || []).map((z: any) => ({
    id: z.id,
    name: z.metadata?.name || 'Unknown Zone',
    lights: (z.children || [])
      .filter((c: any) => c.rtype === 'light')
      .map((c: any) => lightMap.get(c.rid))
      .filter(Boolean) as HueLight[],
  }));

  // Map scenes with room references
  const scenes: HueScene[] = (scenesData.data || []).map((s: any) => {
    const roomRef = s.group?.rid;
    const room = rooms.find((r) => r.id === roomRef);
    return {
      id: s.id,
      name: s.metadata?.name || 'Unknown Scene',
      roomId: roomRef,
      roomName: room?.name,
    };
  });

  return {
    homes,
    rooms,
    zones,
    scenes,
    fetchedAt: Date.now(),
  };
}
