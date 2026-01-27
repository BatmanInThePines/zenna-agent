/**
 * ZENNA Avatar V2 - Single Image Upload API
 *
 * Uploads a single image to Supabase Storage.
 * Used by the client to upload images one at a time before starting reconstruction.
 * This avoids Vercel's 4.5MB body size limit for serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as jose from 'jose';
import { uploadImage } from '@/lib/avatar/supabase-reconstruction-store';

// =============================================================================
// HELPERS
// =============================================================================

async function getCurrentUser(): Promise<{ id: string; username: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('zenna-session')?.value;

  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(
      process.env.AUTH_SECRET || 'zenna-default-secret-change-me'
    );
    const { payload } = await jose.jwtVerify(token, secret);
    const userId = (payload.userId as string) || (payload.sub as string);
    if (!userId) return null;
    return {
      id: userId,
      username: (payload.username as string) || userId,
    };
  } catch {
    return null;
  }
}

function validateImage(
  buffer: Buffer,
  filename: string
): { valid: boolean; errors: string[]; contentType: string } {
  const errors: string[] = [];
  let contentType = 'image/png';

  if (buffer.length > 10 * 1024 * 1024) {
    errors.push('File too large. Maximum size is 10MB.');
  }

  const signature = buffer.slice(0, 8).toString('hex');
  const isPNG = signature.startsWith('89504e47');
  const isJPEG = signature.startsWith('ffd8ff');
  const isWebP =
    buffer.slice(0, 4).toString() === 'RIFF' &&
    buffer.slice(8, 12).toString() === 'WEBP';

  if (isPNG) {
    contentType = 'image/png';
  } else if (isJPEG) {
    contentType = 'image/jpeg';
  } else if (isWebP) {
    contentType = 'image/webp';
  } else {
    errors.push('Invalid image format. Use PNG, JPEG, or WebP.');
  }

  return { valid: errors.length === 0, errors, contentType };
}

// =============================================================================
// POST /api/avatar/upload
// Upload a single image to Supabase Storage
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const image = formData.get('image') as File | null;
    const angle = (formData.get('angle') as string) || 'unknown';

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const validation = validateImage(buffer, image.name);

    if (!validation.valid) {
      return NextResponse.json(
        { error: `Validation failed: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    const ext = image.name.split('.').pop() || 'png';
    const filename = `${angle}_${Date.now()}.${ext}`;
    const tempJobId = `upload-${user.id}-${Date.now()}`;

    const url = await uploadImage(buffer, filename, tempJobId, validation.contentType);

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('Image upload error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload image';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
