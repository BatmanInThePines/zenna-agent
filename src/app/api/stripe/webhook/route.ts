/**
 * API Route: Stripe Webhook Handler
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events for payment processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/config';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function getSupabaseClient() {
  return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Disable body parsing for webhook signature verification
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing Stripe signature' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCancelled(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

/**
 * Handle successful checkout session
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const supabase = getSupabaseClient();
  const userId = session.metadata?.userId;
  const tierId = session.metadata?.tierId;
  const includeHardware = session.metadata?.includeHardware === 'true';

  if (!userId || !tierId) {
    console.error('Missing metadata in checkout session');
    return;
  }

  // Deactivate any existing subscriptions
  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('status', 'active');

  // Create new subscription
  const { error } = await supabase.from('subscriptions').insert({
    user_id: userId,
    tier: tierId,
    status: 'active',
    stripe_customer_id: session.customer as string,
    stripe_subscription_id: session.subscription as string,
    hardware_bundle: includeHardware,
    expires_at: tierId === 'platinum' ? null : null, // One-time purchases don't expire
  });

  if (error) {
    console.error('Error creating subscription:', error);
    return;
  }

  // Log the purchase
  await supabase.from('admin_audit_log').insert({
    admin_user_id: userId,
    admin_email: session.metadata?.userEmail || 'unknown',
    action: 'subscription_purchased',
    target_user_id: userId,
    target_user_email: session.metadata?.userEmail,
    details: {
      tier: tierId,
      hardware_bundle: includeHardware,
      stripe_session_id: session.id,
      amount_total: session.amount_total,
    },
  });

  console.log(`Subscription activated for user ${userId}: ${tierId}`);
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const supabase = getSupabaseClient();
  const customerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!existingSub) {
    console.log('No subscription found for customer:', customerId);
    return;
  }

  // Update subscription status
  const status = subscription.status === 'active' ? 'active' : 'suspended';

  await supabase
    .from('subscriptions')
    .update({
      status,
      stripe_subscription_id: subscription.id,
    })
    .eq('stripe_customer_id', customerId);

  console.log(`Subscription updated for customer ${customerId}: ${status}`);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
  const supabase = getSupabaseClient();
  const customerId = subscription.customer as string;

  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('stripe_customer_id', customerId);

  console.log(`Subscription cancelled for customer ${customerId}`);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const supabase = getSupabaseClient();
  const customerId = invoice.customer as string;

  // Ensure subscription is active
  await supabase
    .from('subscriptions')
    .update({ status: 'active' })
    .eq('stripe_customer_id', customerId);

  console.log(`Payment succeeded for customer ${customerId}`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const supabase = getSupabaseClient();
  const customerId = invoice.customer as string;

  // Mark subscription as suspended
  await supabase
    .from('subscriptions')
    .update({ status: 'suspended' })
    .eq('stripe_customer_id', customerId);

  console.log(`Payment failed for customer ${customerId}`);
}
