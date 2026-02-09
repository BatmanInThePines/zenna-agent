/**
 * Resend Email Client for Zenna
 *
 * Used for email verification and password reset flows.
 * Lazy initialization to avoid build-time errors when env vars aren't set.
 */

import { Resend } from 'resend';

let resendInstance: Resend | null = null;

export function getResend(): Resend {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}

export const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Zenna <noreply@updates.zna.world>';
