const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

router.use(widgetCors);

const APP_URL = process.env.APP_URL || 'https://botiga-api-two.vercel.app';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://app.botiga.ai';

const PLANS = {
  free: {
    name: 'Free',
    price: null, // no charge
    trial_days: 0,
    negotiations_per_month: 50,
    features: ['basic_tone', 'product_rules']
  },
  starter: {
    name: 'Botiga Starter',
    price: '29.00',
    trial_days: 14,
    negotiations_per_month: 500,
    transaction_fee_pct: 1.0,
    features: ['all_tones', 'brand_voice', 'product_rules']
  },
  growth: {
    name: 'Botiga Growth',
    price: '79.00',
    trial_days: 14,
    negotiations_per_month: null, // unlimited
    transaction_fee_pct: 0.5,
    features: ['all_tones', 'brand_voice', 'product_rules', 'cart_negotiation', 'recovery']
  },
  pro: {
    name: 'Botiga Pro',
    price: '199.00',
    trial_days: 14,
    negotiations_per_month: null, // unlimited
    transaction_fee_pct: 0,
    features: ['all_tones', 'brand_voice', 'product_rules', 'cart_negotiation', 'recovery', 'video', 'white_label']
  }
};

// GET /api/billing/plans — public, returns plan config for frontend
router.get('/billing/plans', (req, res) => {
  res.json(PLANS);
});

// POST /api/merchants/:merchantId/billing/subscribe
// Creates a Shopify RecurringApplicationCharge and returns the confirmation URL
router.post('/merchants/:merchantId/billing/subscribe', async (req, res) => {
  const { merchantId } = req.params;
  const { plan } = req.body;

  if (!PLANS[plan] || plan === 'free') {
    // Downgrade to free — just update DB
    await supabase.from('merchants').update({ plan: 'free', shopify_charge_id: null }).eq('id', merchantId);
    return res.json({ ok: true, plan: 'free', confirmation_url: null });
  }

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('id', merchantId)
    .single();

  if (!merchant?.shopify_domain || !merchant?.shopify_access_token) {
    return res.status(400).json({ error: 'Shopify not connected' });
  }

  const planConfig = PLANS[plan];
  const returnUrl = `${APP_URL}/api/merchants/${merchantId}/billing/activate?plan=${plan}`;
  const isTest = process.env.NODE_ENV !== 'production';

  try {
    const shopRes = await fetch(
      `https://${merchant.shopify_domain}/admin/api/2024-01/recurring_application_charges.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': merchant.shopify_access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recurring_application_charge: {
            name: planConfig.name,
            price: planConfig.price,
            trial_days: planConfig.trial_days,
            return_url: returnUrl,
            test: isTest
          }
        })
      }
    );

    if (!shopRes.ok) {
      const err = await shopRes.text();
      return res.status(400).json({ error: `Shopify billing error: ${err}` });
    }

    const { recurring_application_charge: charge } = await shopRes.json();
    res.json({ ok: true, confirmation_url: charge.confirmation_url, charge_id: charge.id });
  } catch (err) {
    console.error('[billing] subscribe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/merchants/:merchantId/billing/activate?plan=growth&charge_id=xxx
// Shopify redirects here after merchant approves billing — activates the charge
router.get('/merchants/:merchantId/billing/activate', async (req, res) => {
  const { merchantId } = req.params;
  const { plan, charge_id } = req.query;

  if (!charge_id || !plan) {
    return res.redirect(`${DASHBOARD_URL}/dashboard/settings?billing_error=missing_params`);
  }

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('id', merchantId)
    .single();

  if (!merchant?.shopify_domain || !merchant?.shopify_access_token) {
    return res.redirect(`${DASHBOARD_URL}/dashboard/settings?billing_error=no_shopify`);
  }

  try {
    // Activate the charge on Shopify
    const activateRes = await fetch(
      `https://${merchant.shopify_domain}/admin/api/2024-01/recurring_application_charges/${charge_id}/activate.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': merchant.shopify_access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recurring_application_charge: { id: charge_id } })
      }
    );

    if (!activateRes.ok) {
      const err = await activateRes.text();
      console.error('[billing] activate failed:', err);
      return res.redirect(`${DASHBOARD_URL}/dashboard/settings?billing_error=activation_failed`);
    }

    // Save plan to DB
    await supabase
      .from('merchants')
      .update({ plan, shopify_charge_id: charge_id, plan_started_at: new Date().toISOString() })
      .eq('id', merchantId);

    console.log(`[billing] Merchant ${merchantId} activated plan=${plan} charge=${charge_id}`);
    res.redirect(`${DASHBOARD_URL}/dashboard/settings?billing_success=1&plan=${plan}`);
  } catch (err) {
    console.error('[billing] activate error:', err.message);
    res.redirect(`${DASHBOARD_URL}/dashboard/settings?billing_error=server_error`);
  }
});

// GET /api/merchants/:merchantId/billing/status — current plan + usage
router.get('/merchants/:merchantId/billing/status', async (req, res) => {
  const { merchantId } = req.params;

  const { data: merchant } = await supabase
    .from('merchants')
    .select('plan, shopify_charge_id, plan_started_at')
    .eq('id', merchantId)
    .single();

  const plan = merchant?.plan || 'free';
  const planConfig = PLANS[plan];

  // Count negotiations this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('negotiations')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId)
    .gte('created_at', monthStart.toISOString());

  const limit = planConfig.negotiations_per_month;
  res.json({
    plan,
    plan_name: planConfig.name,
    charge_id: merchant?.shopify_charge_id,
    plan_started_at: merchant?.plan_started_at,
    negotiations_this_month: count || 0,
    negotiations_limit: limit,
    negotiations_remaining: limit ? Math.max(0, limit - (count || 0)) : null,
    features: planConfig.features,
    transaction_fee_pct: planConfig.transaction_fee_pct || 0
  });
});

module.exports = router;
