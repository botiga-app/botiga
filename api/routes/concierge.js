// Concierge lead capture — site-arrival flow.
//
// On site arrival the widget pops a value-hook bubble: "I've got a special
// price on this — drop your email and I'll show you?". When the customer
// types their email, the widget POSTs here. We:
//   1. Log the capture in lead_captures (every capture moment).
//   2. If a negotiation already exists for this session, merge contact in.
//   3. Otherwise create a stub negotiation with status='cold_lead' so the
//      merchant sees this in /dashboard/leads even if the customer never
//      engages further.
//
// We ask for ONE thing per turn — never email + phone in the same ask.
// The second ask is for NAME, not the other contact channel.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateApiKey } = require('../middleware/auth');
const { settingsLimiter } = require('../middleware/rateLimit');
const { widgetCors } = require('../middleware/cors');

router.post('/concierge/capture', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const {
    session_id,
    source = 'concierge_arrival',  // concierge_arrival | price_gate | exit_intent
    capture_step = 'contact',       // contact | name
    email,
    phone,
    name,
    product_url,
    product_name,
    list_price,
  } = req.body || {};

  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  if (!email && !phone && !name) return res.status(400).json({ error: 'one of email/phone/name required' });

  // Normalize
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanPhone = phone ? String(phone).replace(/[\s\-().]/g, '') : null;
  const cleanName  = name  ? String(name).trim().slice(0, 60) : null;

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'invalid email' });
  }
  if (cleanPhone && cleanPhone.length < 7) {
    return res.status(400).json({ error: 'invalid phone' });
  }

  // Always log the moment
  await supabase.from('lead_captures').insert({
    merchant_id: merchantId,
    session_id,
    source,
    capture_step,
    email: cleanEmail,
    phone: cleanPhone,
    name:  cleanName,
    product_url: product_url || null,
    product_name: product_name || null,
    list_price: typeof list_price === 'number' ? list_price : null,
    user_agent: (req.headers['user-agent'] || '').slice(0, 250),
  });

  // Find an active negotiation in this session — merge contact if exists.
  const { data: existing } = await supabase
    .from('negotiations')
    .select('id, customer_email, customer_whatsapp, customer_name, lead_tier, status')
    .eq('merchant_id', merchantId)
    .eq('session_id', session_id)
    .in('status', ['active', 'cold_lead', 'human_escalated'])
    .order('updated_at', { ascending: false })
    .limit(1);

  const row = existing?.[0];
  const nowIso = new Date().toISOString();

  if (row) {
    const updates = { updated_at: nowIso };
    if (cleanEmail && !row.customer_email) updates.customer_email = cleanEmail;
    if (cleanPhone && !row.customer_whatsapp) updates.customer_whatsapp = cleanPhone;
    if (cleanName  && !row.customer_name) updates.customer_name = cleanName;
    // First contact promotes a cold_lead row to whatever tier the data justifies.
    if ((cleanEmail || cleanPhone) && !row.lead_tier) updates.lead_tier = 'cold';
    if (Object.keys(updates).length > 1) {
      await supabase.from('negotiations').update(updates).eq('id', row.id);
    }
    return res.json({ ok: true, negotiation_id: row.id, mode: 'merged' });
  }

  // No negotiation yet — create a cold_lead stub. list_price is required by
  // the schema but for a pre-engagement capture it may be null; default to 0
  // and let the negotiation flow set the real price when the customer
  // actually opens the chat.
  const { data: created, error } = await supabase
    .from('negotiations')
    .insert({
      merchant_id: merchantId,
      session_id,
      session_token: session_id,
      status: 'cold_lead',
      lead_tier: 'cold',
      lead_status: 'new',
      list_price: typeof list_price === 'number' ? list_price : 0,
      floor_price: 0,
      product_url: product_url || null,
      product_name: product_name || null,
      customer_email: cleanEmail,
      customer_whatsapp: cleanPhone,
      customer_name: cleanName,
      messages: [],
      customer_insights: [],
    })
    .select('id')
    .single();

  if (error) {
    console.error('[concierge] cold_lead insert failed:', error.message);
    return res.status(500).json({ error: 'capture failed' });
  }

  return res.json({ ok: true, negotiation_id: created.id, mode: 'created' });
});

module.exports = router;
