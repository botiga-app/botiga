const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../lib/supabase');

const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// Webhooks need raw body for HMAC verification.
// This router is mounted BEFORE express.json() in index.js.
router.use(express.raw({ type: 'application/json' }));

function verifyShopifyWebhook(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac || !SHOPIFY_CLIENT_SECRET) return false;
  const hash = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(req.body)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(hash));
}

function parseBody(req) {
  try { return JSON.parse(req.body.toString()); } catch { return {}; }
}

// ── app/uninstalled ──────────────────────────────────────────────────────────
// Required: deactivate merchant when they uninstall the app
router.post('/webhooks/app/uninstalled', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  const shop = req.headers['x-shopify-shop-domain'];
  console.log(`[Webhook] app/uninstalled: ${shop}`);

  try {
    // Clear Shopify credentials and deactivate — keep merchant data for reactivation
    await supabase
      .from('merchants')
      .update({
        shopify_access_token: null,
        shopify_domain: null,
        plan: 'free',
        shopify_charge_id: null
      })
      .eq('shopify_domain', shop);

    console.log(`[Webhook] Deactivated merchant for shop ${shop}`);
  } catch (err) {
    console.error('[Webhook] app/uninstalled error:', err.message);
  }
  res.status(200).send('OK');
});

// ── customers/data_request ───────────────────────────────────────────────────
// Required GDPR: buyer requests their data. We must send it to the shop owner.
router.post('/webhooks/customers/data_request', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  const { shop_domain, customer, orders_requested } = parseBody(req);
  console.log(`[Webhook] customers/data_request shop=${shop_domain} customer=${customer?.email}`);

  // Find any negotiations associated with this customer's email
  try {
    const { data: negotiations } = await supabase
      .from('negotiations')
      .select('id, created_at, product_url, status, final_price, customer_email')
      .eq('customer_email', customer?.email || '')
      .limit(100);

    // In production: email this data to the merchant's store owner.
    // For now, we log it — add Resend/email integration here if needed.
    console.log(`[Webhook] Customer data for ${customer?.email}:`, JSON.stringify(negotiations));
  } catch (err) {
    console.error('[Webhook] data_request error:', err.message);
  }
  res.status(200).send('OK');
});

// ── customers/redact ─────────────────────────────────────────────────────────
// Required GDPR: delete a specific customer's data
router.post('/webhooks/customers/redact', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  const { shop_domain, customer } = parseBody(req);
  console.log(`[Webhook] customers/redact shop=${shop_domain} customer=${customer?.email}`);

  try {
    // Anonymize negotiations for this customer
    await supabase
      .from('negotiations')
      .update({
        customer_email: null,
        customer_phone: null,
        customer_name: null
      })
      .eq('customer_email', customer?.email || '');

    console.log(`[Webhook] Redacted customer data for ${customer?.email}`);
  } catch (err) {
    console.error('[Webhook] customers/redact error:', err.message);
  }
  res.status(200).send('OK');
});

// ── shop/redact ──────────────────────────────────────────────────────────────
// Required GDPR: delete all data for a shop (sent 48h after app uninstall)
router.post('/webhooks/shop/redact', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  const { shop_domain, shop_id } = parseBody(req);
  console.log(`[Webhook] shop/redact: ${shop_domain}`);

  try {
    // Find merchant by shop domain
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('shopify_domain', shop_domain)
      .single();

    if (merchant) {
      // Delete all negotiation data (cascade will handle related tables)
      await supabase.from('negotiations').delete().eq('merchant_id', merchant.id);
      await supabase.from('negotiation_rules').delete().eq('merchant_id', merchant.id);
      // Soft-delete the merchant record
      await supabase.from('merchants').update({ redacted_at: new Date().toISOString() }).eq('id', merchant.id);
      console.log(`[Webhook] shop/redact complete for merchant ${merchant.id}`);
    }
  } catch (err) {
    console.error('[Webhook] shop/redact error:', err.message);
  }
  res.status(200).send('OK');
});

module.exports = router;
