/**
 * Hue Manifest Builder
 *
 * Fetches the user's Philips Hue home manifest from the CLIP v2 API.
 * Returns structured data for rooms, lights, zones, scenes, devices, and homes.
 * All resource UIDs are preserved so Zenna can issue commands by exact ID.
 * Used after OAuth pairing and for session-start refresh.
 */

import type {
  HueManifest,
  HueHome,
  HueRoom,
  HueZone,
  HueLight,
  HueScene,
  HueDevice,
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
 * Fetches homes, rooms, zones, lights, scenes, and devices in parallel.
 * All resource UIDs are captured for direct API control.
 */
export async function fetchHueManifest(
  accessToken: string,
  username: string
): Promise<HueManifest> {
  const headers = makeHeaders(accessToken, username);

  // Fetch all resources in parallel for speed
  const [homesData, roomsData, zonesData, lightsData, scenesData, devicesData] = await Promise.all([
    hueApiFetch('/clip/v2/resource/bridge_home', headers),
    hueApiFetch('/clip/v2/resource/room', headers),
    hueApiFetch('/clip/v2/resource/zone', headers),
    hueApiFetch('/clip/v2/resource/light', headers),
    hueApiFetch('/clip/v2/resource/scene', headers),
    hueApiFetch('/clip/v2/resource/device', headers),
  ]);

  // Build device lookup map: device.id -> HueDevice
  const deviceMap = new Map<string, HueDevice>();
  for (const d of (devicesData.data || [])) {
    deviceMap.set(d.id, {
      id: d.id,
      name: d.metadata?.name || 'Unknown Device',
      productName: d.product_data?.product_name,
      modelId: d.product_data?.model_id,
      manufacturer: d.product_data?.manufacturer_name,
      archetype: d.metadata?.archetype,
      lightIds: [], // populated below
    });
  }

  // Build light lookup map: light.id -> HueLight
  // Also associate each light with its parent device
  const lightMap = new Map<string, HueLight>();
  for (const l of (lightsData.data || [])) {
    const ownerDeviceId = l.owner?.rid;

    const light: HueLight = {
      id: l.id,
      name: l.metadata?.name || 'Unknown Light',
      deviceId: ownerDeviceId,
      type: l.metadata?.archetype || l.type || 'unknown',
      productName: l.product_data?.product_name,
      modelId: l.product_data?.model_id,
      supportsColor: !!l.color,
      supportsDimming: !!l.dimming,
      supportsColorTemp: !!l.color_temperature,
      currentState: {
        on: l.on?.on ?? false,
        brightness: l.dimming?.brightness,
        colorXY: l.color?.xy ? { x: l.color.xy.x, y: l.color.xy.y } : undefined,
        colorTemp: l.color_temperature?.mirek,
      },
    };

    lightMap.set(l.id, light);

    // Link light back to its parent device
    if (ownerDeviceId && deviceMap.has(ownerDeviceId)) {
      deviceMap.get(ownerDeviceId)!.lightIds!.push(l.id);
    }
  }

  // Map homes
  const homes: HueHome[] = (homesData.data || []).map((h: any) => ({
    id: h.id,
    name: h.metadata?.name || 'Home',
  }));

  // Map rooms with their lights
  // CLIP v2: rooms contain device children. Lights reference their owner device via owner.rid.
  const rooms: HueRoom[] = (roomsData.data || []).map((r: any) => {
    const groupedLightRef = (r.services || []).find(
      (s: any) => s.rtype === 'grouped_light'
    );

    // Room children are devices; cross-reference with lights via owner.rid
    const roomDeviceIds = (r.children || [])
      .filter((c: any) => c.rtype === 'device')
      .map((c: any) => c.rid);
    const roomDeviceIdSet = new Set(roomDeviceIds);

    const roomLights = (lightsData.data || [])
      .filter((l: any) => l.owner && roomDeviceIdSet.has(l.owner.rid))
      .map((l: any) => lightMap.get(l.id))
      .filter(Boolean) as HueLight[];

    return {
      id: r.id,
      name: r.metadata?.name || 'Unknown Room',
      type: r.metadata?.archetype || 'other',
      lights: roomLights,
      groupedLightId: groupedLightRef?.rid,
      deviceIds: roomDeviceIds,
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

  // Map zones with their grouped_light IDs
  const zones: HueZone[] = (zonesData.data || []).map((z: any) => {
    const groupedLightRef = (z.services || []).find(
      (s: any) => s.rtype === 'grouped_light'
    );

    // Zone children can be lights directly or devices
    const zoneLightChildren = (z.children || [])
      .filter((c: any) => c.rtype === 'light')
      .map((c: any) => lightMap.get(c.rid))
      .filter(Boolean) as HueLight[];

    // Also check device children (some zones reference devices, not lights)
    const zoneDeviceIds = new Set(
      (z.children || [])
        .filter((c: any) => c.rtype === 'device')
        .map((c: any) => c.rid)
    );
    const zoneDeviceLights = zoneDeviceIds.size > 0
      ? (lightsData.data || [])
          .filter((l: any) => l.owner && zoneDeviceIds.has(l.owner.rid))
          .map((l: any) => lightMap.get(l.id))
          .filter(Boolean) as HueLight[]
      : [];

    // Combine unique lights (deduplicate by ID)
    const allLightIds = new Set<string>();
    const allLights: HueLight[] = [];
    for (const light of [...zoneLightChildren, ...zoneDeviceLights]) {
      if (!allLightIds.has(light.id)) {
        allLightIds.add(light.id);
        allLights.push(light);
      }
    }

    return {
      id: z.id,
      name: z.metadata?.name || 'Unknown Zone',
      lights: allLights,
      groupedLightId: groupedLightRef?.rid,
    };
  });

  // Map scenes with room references
  const scenes: HueScene[] = (scenesData.data || []).map((s: any) => {
    const groupRef = s.group;
    const roomRef = groupRef?.rid;
    const groupType = groupRef?.rtype; // "room" or "zone"
    const room = rooms.find((r) => r.id === roomRef);
    const zone = !room ? zones.find((z) => z.id === roomRef) : undefined;

    return {
      id: s.id,
      name: s.metadata?.name || 'Unknown Scene',
      roomId: roomRef,
      roomName: room?.name || zone?.name,
      type: groupType,
      speed: s.speed,
    };
  });

  // Collect all devices
  const devices: HueDevice[] = Array.from(deviceMap.values());

  return {
    homes,
    rooms,
    zones,
    scenes,
    devices,
    fetchedAt: Date.now(),
  };
}
