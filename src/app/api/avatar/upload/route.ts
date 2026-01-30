/**
 * ZENNA Avatar V2 - Single Image Upload API
 *
 * Uploads a single image to Supabase Storage.
 * Used by the client to upload images one at a time before starting reconstruction.
 * This avoids Vercel's 4.5MB body size limit for serverless functions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { uploadImage } from '@/lib/avatar/supabase-reconstruction-store';

// Allow up to 60s on Vercel Pro (default is 10s on Hobby)
export const maxDuration = 60;

// =============================================================================
// HELPERS
// =============================================================================

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
    console.log('[avatar/upload] Starting image upload...');

    const session = await auth();
    if (!session?.user?.id) {
      console.log('[avatar/upload] Unauthorized - no valid session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    console.log('[avatar/upload] User authenticated:', userId);

    const formData = await request.formData();
    const image = formData.get('image') as File | null;
    const angle = (formData.get('angle') as string) || 'unknown';

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }
    console.log(`[avatar/upload] Image: ${image.name}, size: ${image.size}, type: ${image.type}, angle: ${angle}`);

    const buffer = Buffer.from(await image.arrayBuffer());
    const validation = validateImage(buffer, image.name);

    if (!validation.valid) {
      console.log('[avatar/upload] Validation failed:', validation.errors);
      return NextResponse.json(
        { error: `Validation failed: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }
    console.log(`[avatar/upload] Validated as ${validation.contentType}, buffer size: ${buffer.length}`);

    const ext = image.name.split('.').pop() || 'png';
    const filename = `${angle}_${Date.now()}.${ext}`;
    const tempJobId = `upload-${userId}-${Date.now()}`;

    console.log(`[avatar/upload] Uploading to Supabase: ${tempJobId}/${filename}`);
    const url = await uploadImage(buffer, filename, tempJobId, validation.contentType);
    console.log(`[avatar/upload] Upload successful: ${url}`);

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('[avatar/upload] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload image';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
