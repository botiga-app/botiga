const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateApiKey } = require('../middleware/auth');
const { negotiationLimiter, settingsLimiter } = require('../middleware/rateLimit');
const { widgetCors } = require('../middleware/cors');
const { processNegotiation } = require('../services/negotiation');

// Widget settings — called on page load
router.get('/widget/settings', widgetCors, settingsLimiter, async (req, res) => {
  const apiKey = req.query.k;
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('id, plan, trial_ends_at')
    .eq('api_key', apiKey)
    .single();

  if (error || !merchant) return res.status(401).json({ error: 'Invalid API key' });

  if (merchant.plan === 'trial' && new Date(merchant.trial_ends_at) < new Date()) {
    return res.status(402).json({ error: 'Trial expired' });
  }

  const { data: settings } = await supabase
    .from('merchant_settings')
    .select('*')
    .eq('merchant_id', merchant.id)
    .single();

  // Return only fields safe for public consumption
  res.json({
    tone: settings?.tone || 'friendly',
    button_label: settings?.button_label || 'Make an offer',
    button_color: settings?.button_color || null,
    button_text_color: settings?.button_text_color || null,
    button_position: settings?.button_position || 'below-cart',
    negotiate_on_product: settings?.negotiate_on_product ?? true,
    negotiate_on_cart: settings?.negotiate_on_cart ?? true,
    recovery_enabled: settings?.recovery_enabled ?? true,
    dwell_time_seconds: settings?.dwell_time_seconds ?? 5,
    plan: merchant.plan
  });
});

// Core negotiation endpoint
router.post('/negotiate', widgetCors, negotiationLimiter, validateApiKey, async (req, res) => {
  const {
    session_id,
    negotiation_id,
    product_name,
    product_url,
    variant_id,
    list_price,
    customer_message,
    opening,
  } = req.body;

  if (!session_id || !list_price) {
    return res.status(400).json({ error: 'Missing required fields: session_id, list_price' });
  }
  if (!opening && !customer_message) {
    return res.status(400).json({ error: 'customer_message required unless opening:true' });
  }

  if (typeof list_price !== 'number' || list_price <= 0) {
    return res.status(400).json({ error: 'list_price must be a positive number' });
  }

  const merchantId = req.merchant.id;

  const [{ data: settings }, { data: merchant }] = await Promise.all([
    supabase.from('merchant_settings').select('*').eq('merchant_id', merchantId).single(),
    supabase.from('merchants').select('shopify_access_token, shopify_domain').eq('id', merchantId).single()
  ]);

  // Fall back to env vars if merchant record doesn't have Shopify creds
  const shopifyDomain = merchant?.shopify_domain || process.env.SHOPIFY_DOMAIN || null;
  const shopifyAccessToken = merchant?.shopify_access_token || process.env.SHOPIFY_ACCESS_TOKEN || null;

  const merchantSettings = settings || {
    tone: 'friendly',
    max_discount_pct: 20,
    floor_price_pct: null,
    floor_price_fixed: null,
    broker_fee_pct: 25,
    recovery_enabled: true
  };

  try {
    const result = await processNegotiation({
      merchantId,
      merchantSettings,
      shopifyDomain,
      shopifyAccessToken,
      sessionId: session_id,
      negotiationId: negotiation_id || null,
      productName: product_name || 'this item',
      productUrl: product_url || null,
      variantId: variant_id || null,
      listPrice: list_price,
      customerMessage: customer_message || null,
      isOpening: !!opening
    });

    res.json({
      negotiation_id: result.negotiationId,
      bot_reply: result.reply,
      status: result.status,
      is_final_offer: result.isFinalOffer || false,
      deal_price: result.dealPrice,
      checkout_url: result.checkoutUrl,
      discount_code: result.discountCode || null,
      broker_fee: result.brokerFee,
      expires_at: result.expiresAt,
      needs_lead_capture: result.needsLeadCapture || false
    });
  } catch (err) {
    console.error('[negotiate] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Negotiation service temporarily unavailable', detail: err.message });
  }
});

// Debug endpoint — walks through opening flow step by step, returns exact failure point
router.get('/debug/opening', widgetCors, async (req, res) => {
  const { merchant_id } = req.query;
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });
  const steps = [];
  try {
    steps.push('fetching merchant_settings');
    const { data: settings, error: settingsErr } = await supabase
      .from('merchant_settings').select('*').eq('merchant_id', merchant_id).single();
    if (settingsErr) return res.json({ failed_at: steps[steps.length - 1], error: settingsErr.message, steps });
    steps.push('merchant_settings OK — tone: ' + (settings && settings.tone) + ' brand_value_statements: ' + JSON.stringify(settings && settings.brand_value_statements));

    steps.push('building PricingEngine');
    const { PricingEngine } = require('../services/PricingEngine');
    const engine = new PricingEngine({ listPrice: 100, floorPrice: (settings && settings.floor_price_fixed) || 0, maxDiscountPct: (settings && settings.max_discount_pct) || 20 });
    steps.push('PricingEngine OK — ladder: ' + JSON.stringify(engine.priceLadder));

    steps.push('inserting test negotiation row');
    const { data: neg, error: negErr } = await supabase.from('negotiations').insert({
      merchant_id,
      session_id: 'debug-' + Date.now(),
      product_name: 'Debug Product',
      product_url: null,
      variant_id: null,
      list_price: 100,
      floor_price: engine.floorPrice,
      price_ladder: engine.priceLadder,
      current_step: 0,
      lowball_hold_messages: 0,
      bot_last_offered_price: 100,
      tone_used: (settings && settings.tone) || 'friendly',
      messages: [],
      customer_insights: [],
      status: 'active'
    }).select().single();
    if (negErr) return res.json({ failed_at: steps[steps.length - 1], error: negErr.message, steps });
    steps.push('negotiations insert OK — id: ' + neg.id);
    await supabase.from('negotiations').delete().eq('id', neg.id);
    steps.push('test row deleted');

    steps.push('building system prompt');
    const { buildSystemPrompt } = require('../services/llm');
    const prompt = buildSystemPrompt({
      tone: (settings && settings.tone) || 'friendly',
      productName: 'Debug Product',
      nextPrice: engine.priceLadder[0],
      brandStatement: null,
      customerInsight: null,
      stepIndex: 0,
      isOpening: true,
      isLowball: false,
      isEscalating: false,
      lastBotMessages: [],
      needsLeadCapture: true
    });
    steps.push('system prompt OK — ' + prompt.length + ' chars');

    res.json({ ok: true, steps });
  } catch (err) {
    res.json({ failed_at: steps[steps.length - 1], error: err.message, stack: (err.stack || '').split('\n').slice(0, 8), steps });
  }
});

// Direct LLM test — calls the real callLLM function with a fake opening
router.get('/debug/llm', widgetCors, async (req, res) => {
  const errors = [];
  try {
    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Test 1: bare Groq call
    let bare;
    try {
      const r = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: 'You sell bags.' }, { role: 'user', content: 'Say: OK' }],
        max_tokens: 10, temperature: 0.1
      });
      bare = r.choices[0].message.content;
    } catch (e) { errors.push('bare_groq: ' + e.message); }

    // Test 2: real callLLM with opening
    let llmResult;
    try {
      const { callLLM, buildSystemPrompt } = require('../services/llm');
      const { PricingEngine } = require('../services/PricingEngine');
      const engine = new PricingEngine({ listPrice: 99, floorPrice: 79, maxDiscountPct: 20 });
      const systemPrompt = buildSystemPrompt({
        tone: 'friendly', productName: 'Test Bag', nextPrice: engine.priceLadder[0],
        brandStatement: null, customerInsight: null, stepIndex: 0,
        isOpening: true, isLowball: false, isEscalating: false,
        lastBotMessages: [], needsLeadCapture: true
      });
      llmResult = await callLLM({
        systemPrompt, messages: [], customerMessage: null,
        negotiationId: 'debug', merchantId: 'debug',
        nextPrice: engine.priceLadder[0], brandStatement: null,
        isOpening: true, tone: 'friendly'
      });
    } catch (e) { errors.push('callLLM: ' + e.message); }

    res.json({ bare, llmResult, errors, key_prefix: (process.env.GROQ_API_KEY || '').slice(0, 8) });
  } catch (err) {
    res.json({ ok: false, error: err.message, errors });
  }
});

// Returns merchant_id for a given API key (so you don't have to look it up manually)
router.get('/debug/merchant', widgetCors, async (req, res) => {
  const { api_key } = req.query;
  if (!api_key) return res.status(400).json({ error: 'api_key required' });
  const { data, error } = await supabase
    .from('merchants').select('id, email, shopify_domain, plan').eq('api_key', api_key).single();
  if (error) return res.json({ error: error.message });
  res.json(data);
});

// Test email sending directly
router.get('/debug/email', widgetCors, async (req, res) => {
  const { to } = req.query;
  if (!to) return res.status(400).json({ error: 'to= required' });

  const config = {
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    GMAIL_USER: process.env.GMAIL_USER || null,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD ? '***set***' : null,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || null,
    provider: process.env.RESEND_API_KEY ? 'resend' : (process.env.GMAIL_USER ? 'gmail' : 'none')
  };

  if (config.provider === 'none') {
    return res.json({ ok: false, config, error: 'No email provider configured. Set RESEND_API_KEY or GMAIL_USER+GMAIL_APP_PASSWORD in Vercel env vars.' });
  }

  try {
    // Verify SMTP connection first
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
      });
      await transport.verify();
    }

    const { sendDealEmail } = require('../services/email');
    const result = await sendDealEmail({
      to,
      productName: 'Test Product',
      dealPrice: 150,
      listPrice: 199,
      discountCode: 'BOTIGA-TEST',
      checkoutUrl: 'https://botiga.ai',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
    res.json({ ok: true, config, sent_to: to, smtp_verified: true });
  } catch (err) {
    res.json({ ok: false, config, error: err.message, hint: err.message.includes('auth') ? 'App password wrong or 2FA not enabled on Gmail' : 'Check Gmail account settings' });
  }
});

module.exports = router;
