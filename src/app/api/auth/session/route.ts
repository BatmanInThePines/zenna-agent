import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        username: session.user.email?.split('@')[0] || 'user',
        email: session.user.email,
        role: session.user.role || 'user',
        isAdmin: session.user.isAdmin || false,
        isFather: session.user.isFather || false,
        onboardingCompleted: session.user.onboardingCompleted || false,
        subscription: session.user.subscription,
      },
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ authenticated: false });
  }
}
