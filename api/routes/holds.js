// Hold-your-place — customer locks in a negotiated price for 24h.
// The button appears in the chat after a successful negotiation alongside
// the existing Checkout / Keep shopping / Add to cart options. Clicking
// it sends an email with the checkout link + price + expiry, and marks
// the negotiation row with held_at + hold_expires_at so /dashboard/leads
// can surface it as a Held tier (hotter than Hot — explicit save intent).

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');
const { sendDealEmail } = require('../services/email');

const HOLD_HOURS = 24;

router.post('/negotiations/:id/hold', widgetCors, async (req, res) => {
  const { id } = req.params;
  const { email, phone } = req.body || {};

  // Pull the negotiation we're holding
  const { data: neg, error } = await supabase
    .from('negotiations')
    .select('id, merchant_id, product_name, product_url, product_image, deal_price, list_price, checkout_url, discount_code, customer_email, customer_whatsapp, status, recovered_at')
    .eq('id', id)
    .single();
  if (error || !neg) return res.status(404).json({ error: 'negotiation not found' });
  if (neg.status !== 'won') return res.status(400).json({ error: 'can only hold a won negotiation' });
  if (neg.recovered_at) return res.status(400).json({ error: 'already converted' });

  // Resolve contact — prefer the captured one, accept new from body if missing
  const targetEmail = (email || neg.customer_email || '').trim().toLowerCase() || null;
  const targetPhone = (phone || neg.customer_whatsapp || '').replace(/[\s\-().]/g, '') || null;
  if (!targetEmail && !targetPhone) {
    return res.status(400).json({ error: 'email or phone required to send hold' });
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + HOLD_HOURS * 3600_000).toISOString();

  const updates = {
    held_at: nowIso,
    hold_expires_at: expiresIso,
    deal_expires_at: expiresIso,
    updated_at: nowIso,
    lead_tier: 'hot',                  // mark as hot in /dashboard/leads
    lead_status: 'new',
  };
  if (targetEmail && !neg.customer_email) updates.customer_email = targetEmail;
  if (targetPhone && !neg.customer_whatsapp) updates.customer_whatsapp = targetPhone;

  await supabase.from('negotiations').update(updates).eq('id', id);

  // Send email immediately if we have one — this is the "I'll email it
  // to you" promise. Phone holds skip the email path; the merchant
  // dashboard surfaces these as hot leads to follow up.
  if (targetEmail) {
    try {
      await sendDealEmail({
        to: targetEmail,
        productName: neg.product_name,
        dealPrice: neg.deal_price,
        listPrice: neg.list_price,
        discountCode: neg.discount_code,
        checkoutUrl: neg.checkout_url,
        expiresAt: expiresIso,
        productImage: neg.product_image,
      });
    } catch (err) {
      console.warn('[holds] email send failed:', err.message);
    }
  }

  res.json({
    ok: true,
    held_at: nowIso,
    hold_expires_at: expiresIso,
    sent_to: targetEmail ? targetEmail.replace(/(.).*(@.*)/, '$1***$2') : null,
  });
});

module.exports = router;
