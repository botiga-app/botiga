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
const { settingsLimiter, negotiationLimiter } = require('../middleware/rateLimit');
const { widgetCors } = require('../middleware/cors');
const { handleConciergeTurn, pickFeaturedDeal, getOrCreateThread } = require('../services/concierge');

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

// ── CONCIERGE CHAT ─────────────────────────────────────────────────────────
// Cross-page Willow conversation. Each call appends to a single thread row
// per (merchant, session_id). Triggers: 'user' (customer typed) or
// 'greet' / 'page_change' / 'idle' / 'cart_entry' (proactive). The widget
// is responsible for throttling client-side; the server enforces the
// hard caps too (max 4 proactive, no closer than 60s between proactives).

async function loadMerchantContext(merchantId) {
  const [{ data: merchant }, { data: settings }] = await Promise.all([
    supabase.from('merchants').select('id, source_url, shopify_domain').eq('id', merchantId).maybeSingle(),
    supabase.from('merchant_settings').select('tone, bot_name, brand_value_statements').eq('merchant_id', merchantId).maybeSingle(),
  ]);
  return { merchant, settings };
}

router.post('/concierge/message', widgetCors, negotiationLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const {
    session_id,
    customer_message,
    trigger = 'user',
    page_context = null,    // { page_type, product_name, product_url, list_price, collection_title, collection_url }
  } = req.body || {};

  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  if (trigger === 'user' && !customer_message) {
    return res.status(400).json({ error: 'customer_message required for user trigger' });
  }
  if (!['user', 'greet', 'page_change', 'idle', 'cart_entry'].includes(trigger)) {
    return res.status(400).json({ error: 'invalid trigger' });
  }

  try {
    const { merchant, settings } = await loadMerchantContext(merchantId);
    if (!merchant) return res.status(404).json({ error: 'merchant not found' });

    const result = await handleConciergeTurn({
      merchantId,
      sessionId: session_id,
      customerMessage: customer_message || null,
      trigger,
      pageContext: page_context,
      merchantSettings: settings || {},
      shopifyDomain: merchant.shopify_domain || null,
      merchant,
    });

    res.json({
      reply: result.reply,
      thread_id: result.thread_id,
      suppressed: !!result.suppressed,
      scripted: !!result.scripted,
      contact_captured: !!result.contact_captured,
      name_captured: !!result.name_captured,
      featured_deal: result.featured_deal || null,
      matches: result.matches || [],
    });
  } catch (err) {
    console.error('[concierge/message] error:', err.message);
    res.status(500).json({ error: 'concierge unavailable', detail: err.message });
  }
});

// Resume an in-flight thread on page load — widget hits this so the
// chat surface can rehydrate without round-tripping the full message
// list through localStorage on every nav.
router.get('/concierge/thread/:session_id', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const { data, error } = await supabase
    .from('concierge_threads')
    .select('id, messages, customer_email, customer_whatsapp, customer_name, last_page_type, last_product_url, lead_tier, proactive_count, last_proactive_at, created_at, updated_at')
    .eq('merchant_id', merchantId)
    .eq('session_id', req.params.session_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ exists: false });

  res.json({
    exists: true,
    thread_id: data.id,
    messages: data.messages || [],
    contact: {
      email: data.customer_email,
      phone: data.customer_whatsapp,
      name: data.customer_name,
    },
    last_page_type: data.last_page_type,
    proactive_count: data.proactive_count || 0,
    last_proactive_at: data.last_proactive_at,
    lead_tier: data.lead_tier,
  });
});

// List recent conversations for this visitor — used by the hamburger
// "Recent conversations" menu. Returns up to 5 threads matched by
// session_id, plus any threads tied to the visitor's captured email
// (so they see history across devices once they've identified).
router.get('/concierge/threads', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const sessionId = req.query.session_id;
  if (!sessionId) return res.json({ threads: [] });

  // First, find this session's thread to grab the captured email (if any)
  const { data: own } = await supabase
    .from('concierge_threads')
    .select('customer_email')
    .eq('merchant_id', merchantId)
    .eq('session_id', sessionId)
    .maybeSingle();

  const email = own?.customer_email || null;

  // Pull up to 5 threads — by session OR by email
  let query = supabase
    .from('concierge_threads')
    .select('id, messages, updated_at')
    .eq('merchant_id', merchantId)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (email) {
    query = query.or(`session_id.eq.${sessionId},customer_email.eq.${email}`);
  } else {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const threads = (data || []).map(t => {
    const msgs = Array.isArray(t.messages) ? t.messages : [];
    const last = msgs[msgs.length - 1];
    return {
      id: t.id,
      last_at: t.updated_at,
      last_message: last ? String(last.content || '').slice(0, 120) : '',
    };
  });
  res.json({ threads });
});

// ── CONCIERGE LOG ─────────────────────────────────────────────────────────
// Lightweight "fire-and-forget" mirror of every message into the server
// thread. video.js's storefront concierge has its own client-side logic
// (collection curation, deal flow, order lookup) that doesn't go through
// the LLM here, but the leads dashboard still needs to see the full
// transcript. So the widget POSTS each user/bot turn to this endpoint.
router.post('/concierge/log', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const {
    session_id,
    role,                  // 'user' | 'assistant'
    content,
    page_context = null,
  } = req.body || {};

  if (!session_id || !role || !content) {
    return res.status(400).json({ error: 'session_id, role, content required' });
  }
  if (!['user', 'assistant'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  try {
    const thread = await getOrCreateThread({ merchantId, sessionId: session_id });
    const messages = thread.messages || [];
    const nowIso = new Date().toISOString();
    const turn = {
      role,
      content: String(content).slice(0, 4000),  // cap to avoid runaway DB writes
      created_at: nowIso,
    };

    const updates = {
      messages: [...messages, turn],
      updated_at: nowIso,
    };
    if (page_context?.page_type) updates.last_page_type = page_context.page_type;
    if (page_context?.product_url) updates.last_product_url = page_context.product_url;

    // Recompute lead_tier as the conversation grows so the dashboard
    // surfaces engaged threads even before contact is captured.
    const userMsgCount = updates.messages.filter(m => m.role === 'user').length;
    const haveContact = !!(thread.customer_email || thread.customer_whatsapp);
    if (haveContact) {
      if (userMsgCount >= 6) updates.lead_tier = 'hot';
      else if (userMsgCount >= 3) updates.lead_tier = 'warm';
      else if (userMsgCount >= 1) updates.lead_tier = 'cold';
    }

    await supabase.from('concierge_threads').update(updates).eq('id', thread.id);
    res.json({ ok: true, thread_id: thread.id });
  } catch (err) {
    console.error('[concierge/log] error:', err.message);
    res.status(500).json({ error: 'log failed' });
  }
});

// Surfaces today's headline deal so the widget can show a "🔥 hot deal"
// teaser inline with the chat opener even before the LLM round-trips.
router.get('/concierge/featured-deal', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  try {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id, source_url, shopify_domain')
      .eq('id', req.merchant.id)
      .maybeSingle();
    if (!merchant) return res.status(404).json({ error: 'merchant not found' });

    const deal = await pickFeaturedDeal(merchant);
    res.json({ deal });
  } catch (err) {
    console.error('[concierge/featured-deal] error:', err.message);
    res.status(500).json({ error: 'unavailable' });
  }
});

module.exports = router;
