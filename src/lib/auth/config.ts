/**
 * NextAuth.js Configuration for Zenna
 *
 * OAuth Providers: Google, Apple, GitHub
 * Database: Supabase (PostgreSQL)
 *
 * IMPORTANT: Only anthony@anthonywestinc.com (father) can change user roles
 */

import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import GitHub from 'next-auth/providers/github';
import { createClient } from '@supabase/supabase-js';

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
    Apple({
      clientId: process.env.APPLE_CLIENT_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
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
        // Check if user exists
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

          // Create free trial subscription (90 days)
          const trialEndDate = new Date();
          trialEndDate.setDate(trialEndDate.getDate() + 90);

          await supabase.from('subscriptions').insert({
            user_id: newUser.id,
            tier: 'trial',
            status: 'active',
            expires_at: trialEndDate.toISOString(),
            hardware_bundle: false,
          });

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

    async jwt({ token, user, account, trigger }) {
      if (trigger === 'signIn' && user?.email) {
        const supabase = getSupabaseClient();
        // Fetch full user data from database
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, email, role, onboarding_completed, settings')
          .eq('email', user.email)
          .single();

        if (dbUser) {
          token.userId = dbUser.id;
          token.email = dbUser.email;
          token.role = dbUser.role;
          token.isAdmin = dbUser.role === 'admin' || dbUser.email === ADMIN_EMAIL;
          token.isFather = dbUser.email === ADMIN_EMAIL;
          token.onboardingCompleted = dbUser.onboarding_completed;

          // Get subscription status
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
