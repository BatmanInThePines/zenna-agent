/**
 * API Route: Create Stripe Checkout Session
 * POST /api/stripe/checkout
 *
 * Creates a Stripe checkout session for paid subscription tiers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe, SUBSCRIPTION_TIERS, HARDWARE_BUNDLE } from '@/lib/stripe/config';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { tierId, includeHardware } = body;

    // Find the tier
    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);

    if (!tier) {
      return NextResponse.json(
        { error: 'Invalid subscription tier' },
        { status: 400 }
      );
    }

    // Check if tier is available
    if (!tier.isAvailable) {
      return NextResponse.json(
        { error: 'This subscription tier is not yet available' },
        { status: 400 }
      );
    }

    // Free tier doesn't need Stripe checkout
    if (tier.priceType === 'free') {
      return NextResponse.json(
        { error: 'Free trial does not require payment' },
        { status: 400 }
      );
    }

    // Check if Stripe price ID is configured
    if (!tier.stripePriceId) {
      return NextResponse.json(
        { error: 'Payment is not configured for this tier yet' },
        { status: 400 }
      );
    }

    // Build line items
    const lineItems: { price: string; quantity: number }[] = [
      {
        price: tier.stripePriceId,
        quantity: 1,
      },
    ];

    // Add hardware bundle if selected and available
    if (includeHardware && HARDWARE_BUNDLE.isAvailable && HARDWARE_BUNDLE.stripePriceId) {
      lineItems.push({
        price: HARDWARE_BUNDLE.stripePriceId,
        quantity: 1,
      });
    }

    // Create Stripe checkout session
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: tier.priceType === 'monthly' ? 'subscription' : 'payment',
      customer_email: session.user.email,
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/chat?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/paywall?payment=cancelled`,
      metadata: {
        userId: session.user.id,
        userEmail: session.user.email,
        tierId: tier.id,
        tierName: tier.name,
        includeHardware: includeHardware ? 'true' : 'false',
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    });

    if (!checkoutSession.url) {
      throw new Error('Failed to create checkout session URL');
    }

    return NextResponse.json({
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
