/**
 * Stripe Configuration for Zenna
 *
 * Subscription Tiers:
 * - Free Trial: $0 for 90 days (12 sessions/day)
 * - Standard: $9.99/mo monthly subscription
 * - Pro: $29.99/mo monthly subscription
 * - Platinum: $89.99/mo monthly subscription
 * - Enterprise: Contact us (private workforce)
 * - Hardware Bundle: $499 one-time add-on
 *
 * NOTE: For initial release, only Free Trial is selectable.
 * Other tiers are visible but greyed out.
 */

import Stripe from 'stripe';

// Stripe client factory (lazy initialization to avoid build-time errors)
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// Legacy export for compatibility
export const stripe = {
  get checkout() {
    return getStripe().checkout;
  },
  get billingPortal() {
    return getStripe().billingPortal;
  },
  get customers() {
    return getStripe().customers;
  },
  get webhooks() {
    return getStripe().webhooks;
  },
};

// Subscription tier definitions
export interface SubscriptionTier {
  id: 'trial' | 'standard' | 'pro' | 'platinum' | 'enterprise';
  name: string;
  price: string;
  priceAmount: number; // In cents
  priceType: 'free' | 'one-time' | 'monthly' | 'contact';
  features: string[];
  isAvailable: boolean; // Only trial is true for initial release
  highlighted?: boolean;
  stripePriceId?: string;
  comingSoon?: boolean;
  subtitle?: string; // e.g. "Your Private Workforce"
  description?: string; // Extended description text below subtitle
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    id: 'trial',
    name: 'Free Trial',
    price: '$0',
    priceAmount: 0,
    priceType: 'free',
    features: [
      'Up to 12 sessions per 24 hour period',
      'Memory retained (up to 100MB)',
      'Custom avatar generation or default selection',
      'Connect external cloud AI services',
      'Light web research capabilities',
      'Mobile + Web access',
    ],
    isAvailable: true,
    highlighted: true,
  },
  {
    id: 'standard',
    name: 'Standard Package',
    price: '$9.99/mo',
    priceAmount: 999,
    priceType: 'monthly',
    features: [
      'All Free Trial features',
      'Philips Hue Lights integration',
      'Notion connection or PDF uploads',
      'ONE smart home system connection',
      'Artifacts, video/photo sharing',
      'Image generation, document search',
      'Deeper research capabilities',
    ],
    isAvailable: false,
    comingSoon: true,
    // stripePriceId: 'price_xxx' // Add when Stripe product is created
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29.99/mo',
    priceAmount: 2999,
    priceType: 'monthly',
    features: [
      'All Standard features',
      'Local Zenna: Privacy-first local processing',
      'Multiple smart home integrations',
      'AI-curated lighting/sound optimization',
      '"Date night" and ambient scene automation',
    ],
    isAvailable: false,
    comingSoon: true,
    // stripePriceId: 'price_xxx' // Add when Stripe product is created
  },
  {
    id: 'platinum',
    name: 'Platinum',
    price: '$89.99/mo',
    priceAmount: 8999,
    priceType: 'monthly',
    features: [
      'All Pro features',
      'LLM Council: Multi-model orchestration',
      'Full environmental integration',
      'Movement-aware automation',
      'Early access to Zenna Hologram (2027)',
      'Zenna World Pass (VR - Quest/Vision Pro)',
    ],
    isAvailable: false,
    comingSoon: true,
    // stripePriceId: 'price_xxx' // Add when Stripe product is created
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$Ask Us',
    priceAmount: 0,
    priceType: 'contact',
    subtitle: 'Your Private Workforce',
    description: 'Register your interest and a member of the team will be in touch (register by talking to Zenna — see bottom corner of screen)',
    features: [
      'All Pro features',
      'An AI Agent Workforce capable of building stuff',
      '100,000 Credits toward workforce',
    ],
    isAvailable: false,
    comingSoon: true,
  },
];

// Hardware bundle add-on
export const HARDWARE_BUNDLE = {
  id: 'hardware-bundle',
  name: 'Local Zenna Brain',
  price: '$499', // Placeholder - update with actual price
  priceAmount: 49900,
  description: 'Local Zenna brain hardware bundle with encrypted cloud backups (user-held keys only)',
  isAvailable: false,
  comingSoon: true,
  stripePriceId: undefined as string | undefined, // Add when Stripe product is created
  // stripePriceId: 'price_xxx' // Add when Stripe product is created
};

// Smart home systems supported
export const SMART_HOME_SYSTEMS = [
  'Philips Hue',
  'Home Assistant',
  'SwitchBot',
  'Lutron',
  'Denon',
  'Crestron',
  'Control4',
  'Govee',
  'SmartThings',
] as const;

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  tierId: string,
  includeHardware: boolean = false
): Promise<string> {
  const tier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);

  if (!tier || !tier.isAvailable) {
    throw new Error(`Subscription tier "${tierId}" is not available`);
  }

  // Free trial doesn't need Stripe checkout
  if (tier.priceType === 'free') {
    throw new Error('Free trial does not require payment');
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  // Add main subscription
  if (tier.stripePriceId) {
    lineItems.push({
      price: tier.stripePriceId,
      quantity: 1,
    });
  }

  // Add hardware bundle if selected
  if (includeHardware && HARDWARE_BUNDLE.stripePriceId) {
    lineItems.push({
      price: HARDWARE_BUNDLE.stripePriceId,
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: tier.priceType === 'monthly' ? 'subscription' : 'payment',
    customer_email: userEmail,
    line_items: lineItems,
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/paywall?payment=cancelled`,
    metadata: {
      userId,
      tierId,
      includeHardware: includeHardware.toString(),
    },
  });

  return session.url!;
}

/**
 * Get Stripe customer by email or create new
 */
export async function getOrCreateCustomer(email: string, name?: string): Promise<Stripe.Customer> {
  // Search for existing customer
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (customers.data.length > 0) {
    return customers.data[0];
  }

  // Create new customer
  return stripe.customers.create({
    email,
    name,
    metadata: {
      source: 'zenna',
    },
  });
}

/**
 * Create Stripe billing portal session
 */
export async function createBillingPortalSession(customerId: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
  });

  return session.url;
}
