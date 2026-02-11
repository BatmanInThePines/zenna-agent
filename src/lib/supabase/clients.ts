/**
 * Supabase Client Factories
 *
 * Centralized client creation for Supabase operations.
 * Three client types with different security postures:
 *
 * 1. Service Role Client — Bypasses RLS. For admin ops, pre-auth flows, agent creation.
 * 2. User Client — Uses Supabase-compatible JWT. RLS applies via auth.uid().
 * 3. createSupabaseJWT() — Mints JWTs that Supabase PostgREST accepts.
 *
 * The JWT approach means we don't need actual Supabase Auth user records.
 * We sign JWTs with the Supabase JWT secret, setting `sub` to the user's UUID
 * from our custom `users` table. This makes auth.uid() return the correct value.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

/**
 * Admin/service operations — bypasses RLS entirely.
 * Use ONLY for: admin dashboard, user creation, pre-auth flows, background jobs.
 */
export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * User-scoped operations — RLS applies via auth.uid().
 * The access token must be a Supabase-compatible JWT (from createSupabaseJWT).
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}

// Cache the encoded secret to avoid re-encoding on every call
let _jwtSecretEncoded: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (!_jwtSecretEncoded) {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error(
        'SUPABASE_JWT_SECRET is not set. ' +
        'Find it in Supabase Dashboard → Settings → API → JWT Secret.'
      );
    }
    _jwtSecretEncoded = new TextEncoder().encode(secret);
  }
  return _jwtSecretEncoded;
}

/**
 * Mint a Supabase-compatible JWT for a given user.
 *
 * This JWT makes auth.uid() return the user's UUID in RLS policies.
 * No actual Supabase Auth user record is needed — PostgREST validates
 * the JWT signature against the project's JWT secret.
 *
 * @param userId - The UUID from our custom `users` table (must match user_id columns)
 * @param expiresInSeconds - Token lifetime (default: 1 hour)
 * @returns Signed JWT string
 */
export async function createSupabaseJWT(
  userId: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + expiresInSeconds,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(getJwtSecret());
}
