/**
 * NextAuth.js Configuration for Zenna
 *
 * Auth Providers: Google, GitHub (OAuth) + Email/Password (Credentials)
 * Apple Sign In: Temporarily disabled pending Apple Developer enrollment approval (ID: LT4MHCM7A8)
 * Database: Supabase (PostgreSQL)
 *
 * IMPORTANT: Only anthony@anthonywestinc.com (father) can change user roles
 */

import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
// import Apple from 'next-auth/providers/apple'; // TODO: Re-enable after Apple Developer enrollment is approved
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseJWT } from '@/lib/supabase/clients';

// Admin email (father of Zenna)
export const ADMIN_EMAIL = 'anthony@anthonywestinc.com';

// Supabase client factory for auth operations (lazy initialization to avoid build-time errors)
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
    // Apple Sign In — temporarily disabled pending enrollment approval
    // Apple({
    //   clientId: process.env.APPLE_CLIENT_ID ?? '',
    //   clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
    // }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    }),
    Credentials({
      id: 'credentials',
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const supabase = getSupabaseClient();

        // Look up user by email
        const { data: user } = await supabase
          .from('users')
          .select('id, email, password_hash, email_verified, role, image')
          .eq('email', email)
          .single();

        if (!user || !user.password_hash || user.password_hash === '') return null;
        if (!user.email_verified) return null;

        // Verify password with bcrypt
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        // Update last login
        await supabase
          .from('users')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id);

        // Return user object for NextAuth
        return {
          id: user.id,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
    newUser: '/paywall',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account) return false;

      const supabase = getSupabaseClient();

      try {
        // For credentials provider, user already exists in DB (created during send-link)
        // Just update last login and allow sign-in
        if (account.provider === 'credentials') {
          const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', user.email)
            .single();

          if (!existingUser) return false;

          await supabase
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', existingUser.id);

          return true;
        }

        // Check if user exists (OAuth flow)
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, role, onboarding_completed')
          .eq('email', user.email)
          .single();

        if (existingUser) {
          // Update last login
          await supabase
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', existingUser.id);

          // Store account info
          const { data: existingAccount } = await supabase
            .from('accounts')
            .select('id')
            .eq('provider', account.provider)
            .eq('provider_account_id', account.providerAccountId)
            .single();

          if (!existingAccount) {
            await supabase.from('accounts').insert({
              user_id: existingUser.id,
              type: account.type,
              provider: account.provider,
              provider_account_id: account.providerAccountId,
              refresh_token: account.refresh_token,
              access_token: account.access_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
              session_state: account.session_state as string | undefined,
            });
          }
        } else {
          // Create new user
          const isAdmin = user.email === ADMIN_EMAIL;
          const role = isAdmin ? 'admin' : 'user';

          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              email: user.email,
              username: user.email.split('@')[0],
              password_hash: '', // OAuth users don't have passwords
              auth_provider: account.provider,
              auth_provider_id: account.providerAccountId,
              role,
              email_verified: true, // OAuth emails are verified
              image: user.image,
              first_login_at: new Date().toISOString(),
              last_login_at: new Date().toISOString(),
              onboarding_completed: false,
              settings: {},
            })
            .select('id')
            .single();

          if (createError) {
            console.error('Error creating user:', createError);
            return false;
          }

          // Create account record
          await supabase.from('accounts').insert({
            user_id: newUser.id,
            type: account.type,
            provider: account.provider,
            provider_account_id: account.providerAccountId,
            refresh_token: account.refresh_token,
            access_token: account.access_token,
            expires_at: account.expires_at,
            token_type: account.token_type,
            scope: account.scope,
            id_token: account.id_token,
            session_state: account.session_state as string | undefined,
          });

          // NOTE: No subscription created here — user MUST visit paywall
          // and explicitly select a plan (trial or paid) before accessing chat.

          // Initialize user memories metadata
          await supabase.from('user_memories').insert({
            user_id: newUser.id,
            storage_location: 'active',
            memory_size_mb: 0,
            memory_count: 0,
          });
        }

        return true;
      } catch (error) {
        console.error('Sign in error:', error);
        return false;
      }
    },

    async jwt({ token, user, trigger }) {
      const supabase = getSupabaseClient();

      // On initial sign-in, set up the token from user data
      if (trigger === 'signIn' && user?.email) {
        // Fetch full user data from database with retry for race condition
        let dbUser = null;
        let retries = 3;

        while (retries > 0 && !dbUser) {
          const { data, error } = await supabase
            .from('users')
            .select('id, email, role, onboarding_completed, settings, user_type, god_mode')
            .eq('email', user.email)
            .single();

          if (data) {
            dbUser = data;
          } else if (retries > 1) {
            // Wait 500ms before retry (database might not have committed yet)
            console.log(`[JWT] User not found on attempt ${4 - retries}, retrying... Error:`, error?.message);
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            console.error(`[JWT] Failed to find user after retries:`, user.email, error);
          }
          retries--;
        }

        if (dbUser) {
          token.userId = dbUser.id;
          token.email = dbUser.email;
          token.role = dbUser.role;
          token.isAdmin = dbUser.role === 'admin' || dbUser.email === ADMIN_EMAIL;
          token.isFather = dbUser.email === ADMIN_EMAIL;
          token.onboardingCompleted = dbUser.onboarding_completed;
          token.userType = dbUser.user_type || 'human';
          token.godMode = dbUser.god_mode || false;

          // Mint Supabase-compatible JWT for RLS (1 hour lifetime)
          try {
            token.supabaseAccessToken = await createSupabaseJWT(dbUser.id, 3600);
            token.supabaseTokenExp = Math.floor(Date.now() / 1000) + 3600;
          } catch (e) {
            console.error('[JWT] Failed to mint Supabase JWT:', e);
          }

          // Get subscription status - for admins, grant unlimited access even without subscription record
          const isAdminUser = dbUser.role === 'admin' || dbUser.email === ADMIN_EMAIL;

          if (isAdminUser) {
            // Admin/Father users always have full access - create synthetic subscription
            token.subscription = {
              tier: 'admin',
              status: 'active',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year from now
            };
          } else {
            // Regular users - check actual subscription
            const { data: subscription } = await supabase
              .from('subscriptions')
              .select('tier, status, expires_at')
              .eq('user_id', dbUser.id)
              .eq('status', 'active')
              .single();

            if (subscription) {
              token.subscription = {
                tier: subscription.tier,
                status: subscription.status,
                expiresAt: subscription.expires_at,
              };
            }
          }
        } else {
          // Fallback: if user not found in DB, set minimal token data from OAuth
          // This can happen during race conditions or database issues
          console.warn('[JWT] User not found in database, using OAuth data:', user.email);
          token.email = user.email;
          token.role = 'user';
          token.isAdmin = user.email === ADMIN_EMAIL;
          token.isFather = user.email === ADMIN_EMAIL;
          token.onboardingCompleted = false;
          // We can't set userId without a database record - this will cause issues
          // but at least the user can try again
        }
      } else if (token.userId) {
        // Refresh Supabase JWT if expired or missing (5-minute buffer before expiry)
        const now = Math.floor(Date.now() / 1000);
        if (!token.supabaseAccessToken || !token.supabaseTokenExp || token.supabaseTokenExp - now < 300) {
          try {
            token.supabaseAccessToken = await createSupabaseJWT(token.userId, 3600);
            token.supabaseTokenExp = now + 3600;
          } catch (e) {
            console.error('[JWT] Failed to refresh Supabase JWT:', e);
          }
        }

        // On subsequent requests, refresh key data from database
        // This ensures role changes and subscription updates are reflected
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, email, role, onboarding_completed, user_type, god_mode')
          .eq('id', token.userId)
          .single();

        if (dbUser) {
          token.role = dbUser.role;
          token.isAdmin = dbUser.role === 'admin' || dbUser.email === ADMIN_EMAIL;
          token.isFather = dbUser.email === ADMIN_EMAIL;
          token.onboardingCompleted = dbUser.onboarding_completed;
          token.userType = dbUser.user_type || 'human';
          token.godMode = dbUser.god_mode || false;

          // Refresh subscription status - for admins, grant unlimited access
          const isAdminUser = dbUser.role === 'admin' || dbUser.email === ADMIN_EMAIL;

          if (isAdminUser) {
            // Admin/Father users always have full access - create synthetic subscription
            token.subscription = {
              tier: 'admin',
              status: 'active',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            };
          } else {
            // Regular users - check actual subscription
            const { data: subscription } = await supabase
              .from('subscriptions')
              .select('tier, status, expires_at')
              .eq('user_id', dbUser.id)
              .eq('status', 'active')
              .single();

            if (subscription) {
              token.subscription = {
                tier: subscription.tier,
                status: subscription.status,
                expiresAt: subscription.expires_at,
              };
            } else {
              // No active subscription - clear any stale subscription data
              token.subscription = undefined;
            }
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.userId as string;
        session.user.email = token.email as string;
        session.user.role = token.role as string;
        session.user.isAdmin = token.isAdmin as boolean;
        session.user.isFather = token.isFather as boolean;
        session.user.onboardingCompleted = token.onboardingCompleted as boolean;
        session.user.subscription = token.subscription as {
          tier: string;
          status: string;
          expiresAt: string;
        } | undefined;
        session.user.userType = (token.userType as string) || 'human';
        session.user.godMode = (token.godMode as boolean) || false;
        session.user.supabaseAccessToken = token.supabaseAccessToken as string | undefined;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      // Handle post-auth redirects
      if (url.startsWith(baseUrl)) {
        return url;
      }
      return baseUrl;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  trustHost: true,
};
