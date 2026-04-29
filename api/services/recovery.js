const twilio = require('twilio');
const { Resend } = require('resend');
const supabase = require('../lib/supabase');

async function sendWhatsApp(to, message) {
  if (!process.env.TWILIO_ACCOUNT_SID) return;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${to}`,
    body: message
  });
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send({
    from: 'Botiga <noreply@botiga.ai>',
    to,
    subject,
    html
  });
}

async function sendStep2Recovery(negotiation) {
  const message = `Hey! Your negotiated price of $${negotiation.deal_price} on ${negotiation.product_name} expires in 1 hour ⏰\n\nTap to complete your order → ${negotiation.checkout_url}`;

  try {
    if (negotiation.customer_whatsapp) {
      await sendWhatsApp(negotiation.customer_whatsapp, message);
    }
    if (negotiation.customer_email) {
      await sendEmail(
        negotiation.customer_email,
        `Your deal on ${negotiation.product_name} expires soon!`,
        `<p>${message.replace(/\n/g, '<br>')}</p>`
      );
    }

    await supabase.from('recovery_attempts').insert({
      negotiation_id: negotiation.id,
      step: 2,
      channel: negotiation.customer_whatsapp ? 'whatsapp' : 'email',
      sent_at: new Date().toISOString()
    });

    await supabase.from('negotiations').update({
      recovery_sent_at: new Date().toISOString()
    }).eq('id', negotiation.id);
  } catch (err) {
    console.error('[Recovery] Step 2 failed for', negotiation.id, err.message);
  }
}

async function sendStep3Recovery(negotiation) {
  // Build a negotiate-and-checkout link from product_url or merchant lookup
  let negotiateLink = null;
  if (negotiation.product_url) {
    try {
      const origin = new URL(negotiation.product_url).origin;
      negotiateLink = `${origin}/cart?negotiate=1`;
    } catch {}
  }
  if (!negotiateLink && negotiation.merchant_id) {
    const { data: merch } = await supabase.from('merchants').select('shopify_domain').eq('id', negotiation.merchant_id).single();
    if (merch?.shopify_domain) negotiateLink = `https://${merch.shopify_domain}/cart?negotiate=1`;
  }

  const message = negotiateLink
    ? `Still thinking about your ${negotiation.is_cart_bundle ? 'cart' : negotiation.product_name}? Make us an offer — we might surprise you 🤝\n\nNegotiate now → ${negotiateLink}`
    : `Last chance on that ${negotiation.product_name}! If $${negotiation.deal_price} didn't feel right, reply with what works for you 🙏`;

  try {
    if (negotiation.customer_whatsapp) {
      await sendWhatsApp(negotiation.customer_whatsapp, message);
    }
    if (negotiation.customer_email) {
      const isCartBundle = negotiation.is_cart_bundle;
      const subject = isCartBundle
        ? `You left items in your cart — make an offer`
        : `Still interested in ${negotiation.product_name}? Make an offer`;
      await sendEmail(
        negotiation.customer_email,
        subject,
        negotiateLink
          ? `<p>${message.replace(/\n/g, '<br>')}</p><p style="margin-top:16px"><a href="${negotiateLink}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Make an offer →</a></p>`
          : `<p>${message.replace(/\n/g, '<br>')}</p>`
      );
    }

    await supabase.from('recovery_attempts').insert({
      negotiation_id: negotiation.id,
      step: 3,
      channel: negotiation.customer_whatsapp ? 'whatsapp' : 'email',
      sent_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Recovery] Step 3 failed for', negotiation.id, err.message);
  }
}

// Won deal that hasn't been paid: 1h before deal_expires_at, ping the customer once.
async function sendDealExpiringRecovery(negotiation) {
  const message = `Heads up — your $${negotiation.deal_price} deal on ${negotiation.product_name} expires in about an hour ⏰\n\nFinish checkout → ${negotiation.checkout_url}`;

  try {
    if (negotiation.customer_whatsapp) {
      await sendWhatsApp(negotiation.customer_whatsapp, message);
    }
    if (negotiation.customer_email) {
      await sendEmail(
        negotiation.customer_email,
        `1 hour left on your $${negotiation.deal_price} deal`,
        `<p>${message.replace(/\n/g, '<br>')}</p>`
      );
    }
    await supabase.from('recovery_attempts').insert({
      negotiation_id: negotiation.id,
      step: 'deal_expiring',
      channel: negotiation.customer_whatsapp ? 'whatsapp' : 'email',
      sent_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Recovery] deal_expiring failed for', negotiation.id, err.message);
  }
}

// Run by cron every 15 minutes
async function processRecoveryQueue() {
  const now = new Date();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  // Step 2: pending negotiations older than 2h, not yet sent
  const { data: step2Candidates } = await supabase
    .from('negotiations')
    .select('*')
    .eq('status', 'pending')
    .is('recovery_sent_at', null)
    .lt('created_at', twoHoursAgo)
    .not('customer_whatsapp', 'is', null);

  for (const neg of (step2Candidates || [])) {
    await sendStep2Recovery(neg);
  }

  // Step 3: still pending after 24h, step 2 already sent
  const { data: step3Candidates } = await supabase
    .from('negotiations')
    .select('*')
    .eq('status', 'pending')
    .not('recovery_sent_at', 'is', null)
    .lt('created_at', twentyFourHoursAgo);

  for (const neg of (step3Candidates || [])) {
    const { data: existing } = await supabase
      .from('recovery_attempts')
      .select('id')
      .eq('negotiation_id', neg.id)
      .eq('step', '3')
      .single();
    if (!existing) await sendStep3Recovery(neg);
  }

  // Won deals expiring within ~1h that haven't been paid (best-effort: skip if their
  // draft order is completed). Only fire if we have a contact channel and we haven't
  // already sent the deal_expiring reminder.
  const { data: expiringCandidates } = await supabase
    .from('negotiations')
    .select('*')
    .eq('status', 'won')
    .gt('deal_expires_at', now.toISOString())
    .lt('deal_expires_at', inOneHour);

  for (const neg of (expiringCandidates || [])) {
    if (!neg.customer_whatsapp && !neg.customer_email) continue;
    if (!neg.checkout_url && !neg.draft_order_invoice_url) continue;
    const { data: existing } = await supabase
      .from('recovery_attempts')
      .select('id')
      .eq('negotiation_id', neg.id)
      .eq('step', 'deal_expiring')
      .single();
    if (existing) continue;

    // Skip if the Shopify draft order has already been paid (status=completed)
    if (neg.draft_order_id) {
      try {
        const { data: merchant } = await supabase
          .from('merchants')
          .select('shopify_domain, shopify_access_token')
          .eq('id', neg.merchant_id)
          .single();
        if (merchant?.shopify_domain && merchant?.shopify_access_token) {
          const r = await fetch(`https://${merchant.shopify_domain}/admin/api/2024-01/draft_orders/${neg.draft_order_id}.json`, {
            headers: { 'X-Shopify-Access-Token': merchant.shopify_access_token }
          });
          if (r.ok) {
            const j = await r.json();
            if (j.draft_order && j.draft_order.status === 'completed') continue;
          }
        }
      } catch (_) { /* ignore — fall through and send anyway */ }
    }

    await sendDealExpiringRecovery({
      ...neg,
      checkout_url: neg.draft_order_invoice_url || neg.checkout_url
    });
  }
}

module.exports = { processRecoveryQueue, sendStep2Recovery, sendStep3Recovery, sendDealExpiringRecovery };
