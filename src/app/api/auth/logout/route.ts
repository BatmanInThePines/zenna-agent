import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();

  // Clear legacy session cookie
  cookieStore.delete('zenna-session');

  // Clear NextAuth session cookies
  cookieStore.delete('authjs.session-token');
  cookieStore.delete('authjs.callback-url');
  cookieStore.delete('authjs.csrf-token');

  // Also clear secure versions (for production)
  cookieStore.delete('__Secure-authjs.session-token');
  cookieStore.delete('__Secure-authjs.callback-url');
  cookieStore.delete('__Secure-authjs.csrf-token');

  return NextResponse.json({ success: true });
}
