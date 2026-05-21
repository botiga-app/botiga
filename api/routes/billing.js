// Botiga billing — Stripe direct.
//
// Previous incarnation used Shopify RecurringApplicationCharge, which
// requires a Shopify Partner embedded app + OAuth (not in place yet).
// This rewrite uses Stripe Checkout + Customer Portal directly, so
// merchants who land via cold-email outreach can pay without a Shopify
// install path. Shopify Billing can be reinstated later when the
// Partner app ships, behind a feature flag.
//
// Endpoints:
//   GET  /api/billing/plans                       — public plan config
//   GET  /api/merchants/:id/billing/status        — current plan + usage
//   POST /api/merchants/:id/billing/subscribe     — start Checkout
//                                                    (or downgrade to free)
//   POST /api/merchants/:id/billing/portal        — Stripe Customer Portal
//   POST /api/billing/webhook                     — subscription lifecycle
//
// Webhook requires raw body — see api/index.js for the path-specific
// express.raw() middleware applied before the JSON parser.
//
// Required env vars:
//   STRIPE_SECRET_KEY        — sk_test_... or sk_live_...
//   STRIPE_WEBHOOK_SECRET    — whsec_...
//   STRIPE_PRICE_STARTER     — Stripe Price ID for $29/mo
//   STRIPE_PRICE_GROWTH      — Stripe Price ID for $79/mo
//   STRIPE_PRICE_PRO         — Stripe Price ID for $199/mo
//   DASHBOARD_URL            — optional, defaults to https://app.botiga.ai

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');
const Stripe = require('stripe');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET, { apiVersion: '2024-09-30.acacia' }) : null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://app.botiga.ai';

const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER,
  growth:  process.env.STRIPE_PRICE_GROWTH,
  pro:     process.env.STRIPE_PRICE_PRO,
};

const PLANS = {
  free:    { name: 'Free',           price: null,    trial_days: 0,  negotiations_per_month: 50,   transaction_fee_pct: 0,   features: ['basic_tone', 'product_rules'] },
  starter: { name: 'Botiga Starter', price: '29.00', trial_days: 14, negotiations_per_month: 500,  transaction_fee_pct: 1.0, features: ['all_tones', 'brand_voice', 'product_rules'] },
  growth:  { name: 'Botiga Growth',  price: '79.00', trial_days: 14, negotiations_per_month: null, transaction_fee_pct: 0.5, features: ['all_tones', 'brand_voice', 'product_rules', 'cart_negotiation', 'recovery'] },
  pro:     { name: 'Botiga Pro',     price: '199.00',trial_days: 14, negotiations_per_month: null, transaction_fee_pct: 0,   features: ['all_tones', 'brand_voice', 'product_rules', 'cart_negotiation', 'recovery', 'video', 'white_label'] },
};

// ─── WEBHOOK ────────────────────────────────────────────────────────────────
// Mounted BEFORE express.json() in api/index.js so req.body is a Buffer.
// Stripe signature verification requires the raw bytes.
router.post('/billing/webhook', async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const merchantId = session.metadata?.merchant_id;
        const plan = session.metadata?.plan;
        if (merchantId && plan && session.subscription) {
          await supabase.from('merchants').update({
            plan,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            subscription_status: 'active',
          }).eq('id', merchantId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const merchantId = sub.metadata?.merchant_id;
        if (!merchantId) break;
        const updates = {
          subscription_status: sub.status,
          plan_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          stripe_subscription_id: sub.id,
        };
        if (sub.metadata?.plan) updates.plan = sub.metadata.plan;
        await supabase.from('merchants').update(updates).eq('id', merchantId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const merchantId = sub.metadata?.merchant_id;
        if (!merchantId) break;
        await supabase.from('merchants').update({
          plan: 'free',
          subscription_status: 'canceled',
          stripe_subscription_id: null,
        }).eq('id', merchantId);
        break;
      }

      case 'invoice.payment_failed': {
        // Stripe retries automatically; we just log so we can monitor.
        console.warn('[stripe webhook] payment_failed invoice:', event.data.object.id);
        break;
      }

      default:
        // Other event types ignored.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler error' });
  }
});

// Everything below parses JSON normally and is CORS-permissive.
router.use(express.json());
router.use(widgetCors);

// ─── Public plan config ─────────────────────────────────────────────────────
router.get('/billing/plans', (req, res) => {
  res.json(PLANS);
});

// ─── Status ────────────────────────────────────────────────────────────────
router.get('/merchants/:merchantId/billing/status', async (req, res) => {
  const { merchantId } = req.params;
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('plan, subscription_status, plan_period_end, trial_ends_at, stripe_customer_id, stripe_subscription_id')
    .eq('id', merchantId)
    .single();
  if (error || !merchant) return res.status(404).json({ error: 'Merchant not found' });

  const plan = merchant.plan || 'free';
  const planConfig = PLANS[plan] || PLANS.free;

  // Count this merchant's negotiations this calendar month.
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('negotiations')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .gte('created_at', monthStart.toISOString());

  const limit = planConfig.negotiations_per_month;
  res.json({
    plan,
    plan_name: planConfig.name,
    subscription_status: merchant.subscription_status || null,
    plan_period_end: merchant.plan_period_end || null,
    trial_ends_at: merchant.trial_ends_at,
    negotiations_this_month: count || 0,
    negotiations_limit: limit,
    negotiations_remaining: limit ? Math.max(0, limit - (count || 0)) : null,
    features: planConfig.features,
    transaction_fee_pct: planConfig.transaction_fee_pct || 0,
    has_subscription: !!merchant.stripe_subscription_id,
    stripe_configured: !!stripe && !!PLAN_PRICE_IDS.starter,
  });
});

// ─── Subscribe ──────────────────────────────────────────────────────────────
// Free plan: cancel active Stripe sub if any, set plan locally.
// Paid plan: create/reuse Stripe customer, create Checkout Session,
// return { confirmation_url }. Frontend redirects there.
router.post('/merchants/:merchantId/billing/subscribe', async (req, res) => {
  const { merchantId } = req.params;
  const { plan } = req.body || {};
  if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, email, name, plan, stripe_customer_id, stripe_subscription_id')
    .eq('id', merchantId)
    .single();
  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  // Downgrade to free
  if (plan === 'free') {
    if (merchant.stripe_subscription_id && stripe) {
      try { await stripe.subscriptions.cancel(merchant.stripe_subscription_id); }
      catch (err) { console.warn('[billing] cancel-on-free failed:', err.message); }
    }
    await supabase.from('merchants').update({
      plan: 'free',
      subscription_status: 'canceled',
      stripe_subscription_id: null,
    }).eq('id', merchantId);
    return res.json({ ok: true, plan: 'free', confirmation_url: null });
  }

  if (!stripe) {
    return res.status(503).json({
      error: 'Stripe not configured',
      detail: 'Set STRIPE_SECRET_KEY in the API environment.',
    });
  }
  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) {
    return res.status(503).json({
      error: 'Stripe price ID missing',
      detail: `Set STRIPE_PRICE_${plan.toUpperCase()} in the API environment.`,
    });
  }

  try {
    // Reuse Stripe customer if we already created one for this merchant.
    let customerId = merchant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: merchant.email,
        name: merchant.name || merchant.email,
        metadata: { merchant_id: merchant.id },
      });
      customerId = customer.id;
      await supabase.from('merchants').update({ stripe_customer_id: customerId }).eq('id', merchantId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { merchant_id: merchant.id, plan },
        trial_period_days: PLANS[plan].trial_days || 14,
      },
      metadata: { merchant_id: merchant.id, plan },
      success_url: `${DASHBOARD_URL}/dashboard/billing?billing_success=1`,
      cancel_url:  `${DASHBOARD_URL}/dashboard/billing?billing_canceled=1`,
      allow_promotion_codes: true,
    });

    res.json({ ok: true, confirmation_url: session.url, plan });
  } catch (err) {
    console.error('[billing/subscribe] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Customer Portal ────────────────────────────────────────────────────────
// Returns a Stripe Customer Portal URL where the merchant can update
// payment method, see invoices, switch plans, or cancel.
router.post('/merchants/:merchantId/billing/portal', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { merchantId } = req.params;
  const { data: merchant } = await supabase
    .from('merchants')
    .select('stripe_customer_id')
    .eq('id', merchantId)
    .single();
  if (!merchant?.stripe_customer_id) {
    return res.status(404).json({ error: 'No Stripe customer for this merchant' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: merchant.stripe_customer_id,
      return_url: `${DASHBOARD_URL}/dashboard/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
