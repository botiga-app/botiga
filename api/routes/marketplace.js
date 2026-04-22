/**
 * Marketplace API routes.
 * /api/marketplace/search        — NLP product search
 * /api/marketplace/negotiate     — Start or continue a negotiation
 * /api/marketplace/auth/signup   — Customer signup
 * /api/marketplace/auth/login    — Customer login
 * /api/marketplace/auth/me       — Get current customer (JWT)
 * /api/marketplace/index         — Trigger product re-index (internal)
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../lib/supabase');
const { searchProducts } = require('../services/marketplace-search');
const { runIndexer } = require('../services/marketplace-indexer');
const { sendMerchantDealAlert, sendCustomerDealConfirmation } = require('../services/marketplace-email');
const { PricingEngine, isAcceptance, parseCustomerOffer, lowballResponse } = require('../services/PricingEngine');
const { callLLM, buildSystemPrompt } = require('../services/llm');
const { createShopifyDiscountCode } = require('../services/shopify');

const JWT_SECRET = process.env.MARKETPLACE_JWT_SECRET || process.env.JWT_SECRET || 'botiga-marketplace-secret';
const CRON_SECRET = process.env.CRON_SECRET || '';

// ── Auth helpers ──────────────────────────────────────────────────────────────

function signToken(customer) {
  return jwt.sign({ id: customer.id, email: customer.email }, JWT_SECRET, { expiresIn: '30d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.customer = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/marketplace/auth/signup', async (req, res) => {
  const { email, name, phone, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('marketplace_customers')
    .insert({ email: email.toLowerCase().trim(), name, phone, password_hash: hash })
    .select('id, email, name, phone, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    return res.status(500).json({ error: 'Signup failed' });
  }

  res.json({ token: signToken(data), customer: data });
});

router.post('/marketplace/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { data, error } = await supabase
    .from('marketplace_customers')
    .select('id, email, name, phone, password_hash, created_at')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !data) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  await supabase.from('marketplace_customers').update({ last_login_at: new Date().toISOString() }).eq('id', data.id);

  const { password_hash, ...customer } = data;
  res.json({ token: signToken(customer), customer });
});

router.get('/marketplace/auth/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('marketplace_customers')
    .select('id, email, name, phone, created_at, last_login_at')
    .eq('id', req.customer.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json({ customer: data });
});

// ── Product detail ────────────────────────────────────────────────────────────

router.get('/marketplace/product/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('marketplace_products')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json({ product: data });
});

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/marketplace/search', async (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'q is required' });

  try {
    const result = await searchProducts({ query: q.trim(), limit: parseInt(limit), offset: parseInt(offset) });
    res.json(result);
  } catch (err) {
    console.error('[Marketplace] Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Negotiate ─────────────────────────────────────────────────────────────────

router.post('/marketplace/negotiate/start', requireAuth, async (req, res) => {
  const { product_id } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  const { data: product, error: pErr } = await supabase
    .from('marketplace_products')
    .select('*, merchants!marketplace_products_merchant_id_fkey(id, email, marketplace_commission_pct, marketplace_max_discount_pct, shopify_domain, shopify_access_token, marketplace_store_name)')
    .eq('id', product_id)
    .single();

  if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

  const merchant = product.merchants;
  const listPrice = product.price;
  const maxDiscountPct = merchant?.marketplace_max_discount_pct || product.max_discount_pct || 20;
  const commissionPct = merchant?.marketplace_commission_pct || 8;

  const engine = new PricingEngine({ listPrice, floorPrice: 0, maxDiscountPct });
  const priceLadder = engine.priceLadder;
  const openingPrice = engine.getPriceAtStep(0);

  // Create marketplace_negotiations record
  const { data: negRecord, error: nErr } = await supabase
    .from('marketplace_negotiations')
    .insert({
      customer_id: req.customer.id,
      merchant_id: merchant.id,
      product_id: product.id,
      list_price: listPrice,
      commission_pct: commissionPct,
      status: 'active',
      customer_email: req.customer.email,
    })
    .select()
    .single();

  if (nErr) return res.status(500).json({ error: 'Failed to start negotiation' });

  // Get customer info for the bot opening message
  const { data: customer } = await supabase
    .from('marketplace_customers')
    .select('name, phone')
    .eq('id', req.customer.id)
    .single();

  const productContext = {
    vendor: product.vendor,
    product_type: product.product_type,
    tags: product.tags || [],
    description: product.description,
  };

  const systemPrompt = buildSystemPrompt({
    tone: 'friendly',
    productName: product.title,
    nextPrice: openingPrice,
    brandStatement: product.vendor ? `${product.vendor} quality` : null,
    customerInsight: null,
    stepIndex: 0,
    isOpening: true,
    isLowball: false,
    isEscalating: false,
    lastBotMessages: [],
    needsLeadCapture: !customer?.phone,
    productContext,
  });

  const { reply } = await callLLM({
    systemPrompt,
    messages: [],
    customerMessage: null,
    negotiationId: negRecord.id,
    merchantId: merchant.id,
    nextPrice: openingPrice,
    brandStatement: product.vendor ? `${product.vendor} quality` : null,
    isOpening: true,
    tone: 'friendly',
  });

  // Persist opening message
  await supabase.from('marketplace_negotiations').update({
    negotiation_id: negRecord.id,
  }).eq('id', negRecord.id);

  res.json({
    negotiation_id: negRecord.id,
    product,
    list_price: listPrice,
    current_price: openingPrice,
    step: 0,
    price_ladder: priceLadder,
    message: reply,
    status: 'active',
  });
});

router.post('/marketplace/negotiate/:id/message', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { message: customerMessage, phone } = req.body || {};

  const { data: neg, error: nErr } = await supabase
    .from('marketplace_negotiations')
    .select('*, marketplace_products(*, merchants!marketplace_products_merchant_id_fkey(*))')
    .eq('id', id)
    .eq('customer_id', req.customer.id)
    .single();

  if (nErr || !neg) return res.status(404).json({ error: 'Negotiation not found' });
  if (neg.status !== 'active') return res.status(400).json({ error: `Negotiation is ${neg.status}` });

  const product = neg.marketplace_products;
  const merchant = product?.merchants;

  // Capture phone if provided
  if (phone) {
    await supabase.from('marketplace_negotiations').update({ customer_phone: phone }).eq('id', id);
    await supabase.from('marketplace_customers').update({ phone }).eq('id', req.customer.id);
  }

  const listPrice = neg.list_price;
  const maxDiscountPct = merchant?.marketplace_max_discount_pct || product?.max_discount_pct || 20;
  const commissionPct = neg.commission_pct || 8;

  const engine = new PricingEngine({ listPrice, floorPrice: 0, maxDiscountPct });

  // Load conversation history from DB (stored as JSONB)
  const { data: histRows } = await supabase
    .from('marketplace_messages')
    .select('role, content')
    .eq('negotiation_id', id)
    .order('created_at', { ascending: true });

  const messages = histRows || [];
  const currentStep = Math.min(messages.filter(m => m.role === 'assistant').length, 5);
  const nextStep = Math.min(currentStep + 1, 5);
  const currentPrice = engine.getPriceAtStep(currentStep);
  const nextPrice = engine.getPriceAtStep(nextStep);

  const customerOffer = parseCustomerOffer(customerMessage);
  const dealFloor = engine.floorPrice;
  const botLastPrice = currentPrice;

  let botReply, dealWon = false, dealPrice = null;

  // Check acceptance
  if (isAcceptance(customerMessage, botLastPrice)) {
    dealWon = true;
    dealPrice = botLastPrice;
  } else if (customerOffer && customerOffer < dealFloor) {
    // Lowball
    const strategy = lowballResponse();
    const systemPrompt = buildSystemPrompt({
      tone: 'friendly',
      productName: product.title,
      nextPrice: currentPrice,
      stepIndex: currentStep,
      isOpening: false,
      isLowball: true,
      lastBotMessages: messages.filter(m => m.role === 'assistant').slice(-2).map(m => m.content),
      productContext: {
        vendor: product.vendor,
        product_type: product.product_type,
        tags: product.tags || [],
        description: product.description,
      },
    });
    const { reply } = await callLLM({
      systemPrompt, messages, customerMessage,
      negotiationId: id, merchantId: merchant?.id,
      nextPrice: strategy === 1 ? nextPrice : currentPrice,
      isOpening: false, tone: 'friendly',
    });
    botReply = reply;
  } else {
    // Normal step advance
    const isFloor = nextStep === 5;
    const systemPrompt = buildSystemPrompt({
      tone: 'friendly',
      productName: product.title,
      nextPrice,
      stepIndex: nextStep,
      isOpening: false,
      isEscalating: isFloor,
      lastBotMessages: messages.filter(m => m.role === 'assistant').slice(-2).map(m => m.content),
      productContext: {
        vendor: product.vendor,
        product_type: product.product_type,
        tags: product.tags || [],
        description: product.description,
      },
    });
    const { reply } = await callLLM({
      systemPrompt, messages, customerMessage,
      negotiationId: id, merchantId: merchant?.id,
      nextPrice, isOpening: false, tone: 'friendly',
    });
    botReply = reply;
  }

  // Save messages
  const toInsert = [
    { negotiation_id: id, role: 'user', content: customerMessage },
  ];
  if (botReply) toInsert.push({ negotiation_id: id, role: 'assistant', content: botReply });
  await supabase.from('marketplace_messages').insert(toInsert);

  if (dealWon) {
    // Create discount code
    let discountCode = null;
    if (merchant?.shopify_domain && merchant?.shopify_access_token) {
      try {
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        discountCode = await createShopifyDiscountCode({
          shop: merchant.shopify_domain,
          accessToken: merchant.shopify_access_token,
          listPrice, dealPrice,
          negotiationId: id, expiresAt,
        });
      } catch (err) {
        console.error('[Marketplace] Discount code failed:', err.message);
      }
    }

    const commissionAmount = parseFloat((dealPrice * commissionPct / 100).toFixed(2));
    await supabase.from('marketplace_negotiations').update({
      status: 'won',
      deal_price: dealPrice,
      commission_amount: commissionAmount,
      discount_code: discountCode,
      merchant_notified_at: new Date().toISOString(),
      customer_phone: phone || neg.customer_phone,
    }).eq('id', id);

    const customerEmail = req.customer.email;
    const customerName = req.customer.name || req.customer.email;
    const customerPhone = phone || neg.customer_phone;

    // Email merchant
    if (merchant?.email) {
      sendMerchantDealAlert({
        merchantEmail: merchant.email,
        merchantName: merchant.marketplace_store_name || merchant.id,
        productTitle: product.title,
        listPrice, dealPrice, commissionPct, commissionAmount,
        customerName, customerEmail, customerPhone,
        discountCode,
        storeDomain: merchant.shopify_domain || product.store_domain,
        productHandle: product.handle,
      }).catch(err => console.error('[Marketplace] Merchant email failed:', err.message));
    }

    // Email customer
    if (customerEmail) {
      sendCustomerDealConfirmation({
        customerEmail, customerName,
        productTitle: product.title,
        dealPrice, listPrice, discountCode,
        storeDomain: merchant?.shopify_domain || product.store_domain,
        productHandle: product.handle,
        productImage: (product.images || [])[0] || null,
      }).catch(() => {});
    }

    const cartUrl = discountCode
      ? `https://${merchant?.shopify_domain || product.store_domain}/cart?discount=${encodeURIComponent(discountCode)}`
      : null;

    return res.json({
      status: 'won',
      deal_price: dealPrice,
      discount_code: discountCode,
      cart_url: cartUrl,
      message: `🎉 You got it for $${dealPrice}! Check your email — your discount code is on its way.`,
    });
  }

  res.json({
    status: 'active',
    step: nextStep,
    current_price: nextPrice,
    message: botReply,
  });
});

// ── Account orders ────────────────────────────────────────────────────────────

router.get('/marketplace/account/orders', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('marketplace_negotiations')
    .select(`
      id, deal_price, list_price, discount_code, status, created_at,
      marketplace_products(title, images, store_name, handle, store_domain)
    `)
    .eq('customer_id', req.customer.id)
    .eq('status', 'won')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Failed to load orders' });

  const orders = (data || []).map(n => {
    const p = n.marketplace_products || {};
    const images = p.images ? (typeof p.images === 'string' ? JSON.parse(p.images) : p.images) : [];
    const cartUrl = n.discount_code
      ? `https://${p.store_domain}/cart?discount=${encodeURIComponent(n.discount_code)}`
      : null;
    return {
      id: n.id,
      deal_price: n.deal_price,
      list_price: n.list_price,
      discount_code: n.discount_code,
      product_title: p.title,
      product_image: images[0] || null,
      store_name: p.store_name,
      cart_url: cartUrl,
    };
  });

  res.json({ orders });
});

// ── Index trigger (internal / cron) ──────────────────────────────────────────

router.post('/marketplace/index', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { merchant_id } = req.body || {};
  try {
    const results = await runIndexer({ merchantId: merchant_id });
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
