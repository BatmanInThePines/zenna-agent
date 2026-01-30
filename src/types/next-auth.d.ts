/**
 * NextAuth.js Type Extensions
 */

import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: string;
      isAdmin: boolean;
      isFather: boolean;
      onboardingCompleted: boolean;
      subscription?: {
        tier: string;
        status: string;
        expiresAt: string;
      };
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    role?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId: string;
    email: string;
    role: string;
    isAdmin: boolean;
    isFather: boolean;
    onboardingCompleted: boolean;
    subscription?: {
      tier: string;
      status: string;
      expiresAt: string;
    };
  }
}
