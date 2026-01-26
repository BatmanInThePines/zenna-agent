import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SupabaseIdentityStore } from '@/core/providers/identity/supabase-identity';

const identityStore = new SupabaseIdentityStore({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  jwtSecret: process.env.AUTH_SECRET!,
});

// Maximum avatar size: 2MB
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

// Upload avatar image (Father only for master avatar)
export async function POST(request: NextRequest) {
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

    const formData = await request.formData();
    const file = formData.get('avatar') as File | null;
    const target = formData.get('target') as string | null; // 'master' or 'personal'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 2MB' }, { status: 400 });
    }

    // Check if updating master avatar (Father only)
    if (target === 'master') {
      const isFather = await identityStore.isFather(payload.userId);
      if (!isFather) {
        return NextResponse.json({ error: 'Only Father can update master avatar' }, { status: 403 });
      }

      // Convert to base64 data URL
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const dataUrl = `data:${file.type};base64,${base64}`;

      // Update master config with new avatar
      await identityStore.updateMasterConfig({
        defaultAvatarUrl: dataUrl,
      });

      return NextResponse.json({
        success: true,
        avatarUrl: dataUrl,
        message: 'Master avatar updated successfully',
      });
    }

    // Personal avatar - update user settings
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    await identityStore.updateSettings(payload.userId, {
      avatarUrl: dataUrl,
    });

    return NextResponse.json({
      success: true,
      avatarUrl: dataUrl,
      message: 'Personal avatar updated successfully',
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    return NextResponse.json({ error: 'Failed to upload avatar' }, { status: 500 });
  }
}

// Get master avatar URL
export async function GET() {
  try {
    const masterConfig = await identityStore.getMasterConfig();

    return NextResponse.json({
      avatarUrl: masterConfig.defaultAvatarUrl || null,
    });
  } catch (error) {
    console.error('Get avatar error:', error);
    return NextResponse.json({ error: 'Failed to get avatar' }, { status: 500 });
  }
}

// Delete avatar
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('target');

    if (target === 'master') {
      const isFather = await identityStore.isFather(payload.userId);
      if (!isFather) {
        return NextResponse.json({ error: 'Only Father can delete master avatar' }, { status: 403 });
      }

      await identityStore.updateMasterConfig({
        defaultAvatarUrl: undefined,
      });

      return NextResponse.json({ success: true, message: 'Master avatar removed' });
    }

    // Remove personal avatar
    await identityStore.updateSettings(payload.userId, {
      avatarUrl: undefined,
    });

    return NextResponse.json({ success: true, message: 'Personal avatar removed' });
  } catch (error) {
    console.error('Delete avatar error:', error);
    return NextResponse.json({ error: 'Failed to delete avatar' }, { status: 500 });
  }
}
