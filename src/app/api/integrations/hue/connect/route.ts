import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

// Philips Hue bridge discovery and connection
export async function POST() {
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

    // Step 1: Discover Hue Bridge via mDNS/UPNP or Hue discovery API
    const bridgeIp = await discoverHueBridge();

    if (!bridgeIp) {
      return NextResponse.json(
        { success: false, error: 'No Hue Bridge found on the network' },
        { status: 404 }
      );
    }

    // Step 2: Create user on the bridge (requires button press)
    const username = await createHueUser(bridgeIp);

    if (!username) {
      return NextResponse.json(
        { success: false, error: 'Press the button on your Hue Bridge and try again' },
        { status: 400 }
      );
    }

    // Step 3: Save credentials to user settings
    await identityStore.updateSettings(payload.userId, {
      integrations: {
        hue: { bridgeIp, username },
      },
    });

    return NextResponse.json({
      success: true,
      bridgeIp,
      username,
    });
  } catch (error) {
    console.error('Hue connection error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to Hue Bridge' },
      { status: 500 }
    );
  }
}

async function discoverHueBridge(): Promise<string | null> {
  try {
    // Use Philips Hue discovery portal
    const response = await fetch('https://discovery.meethue.com/');
    const bridges = await response.json();

    if (bridges && bridges.length > 0) {
      return bridges[0].internalipaddress;
    }

    return null;
  } catch {
    return null;
  }
}

async function createHueUser(bridgeIp: string): Promise<string | null> {
  try {
    const response = await fetch(`http://${bridgeIp}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devicetype: 'zenna#agent',
      }),
    });

    const result = await response.json();

    if (result[0]?.success?.username) {
      return result[0].success.username;
    }

    // Link button not pressed
    if (result[0]?.error?.type === 101) {
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
