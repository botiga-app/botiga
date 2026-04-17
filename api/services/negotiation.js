const supabase = require('../lib/supabase');
const { callLLM, buildSystemPrompt } = require('./llm');
const { PricingEngine, isAcceptance, parseCustomerOffer } = require('./PricingEngine');
const { extractCustomerInsight } = require('./insights');
const { calculateBrokerFee } = require('./broker-fee');
const { checkRepeatNegotiator } = require('./fingerprint');
const { trackNegotiationEvent } = require('../lib/posthog');
const { createShopifyDiscountCode } = require('./shopify');
const { sendDealEmail } = require('./email');

async function generateCheckoutUrl({ productUrl, variantId, dealPrice, listPrice, negotiationId, expiresAt, shopifyDomain, shopifyAccessToken }) {
  let discountCode = null;

  if (shopifyDomain && shopifyAccessToken) {
    try {
      discountCode = await createShopifyDiscountCode({ shop: shopifyDomain, accessToken: shopifyAccessToken, listPrice, dealPrice, negotiationId, expiresAt });
      console.log('[Shopify] Discount code created:', discountCode);
    } catch (err) {
      console.error('[Shopify] Discount code FAILED:', err.message, '| shop:', shopifyDomain, '| token prefix:', shopifyAccessToken?.slice(0, 10));
    }
  } else {
    console.warn('[Shopify] Skipping — missing domain:', shopifyDomain, 'or token:', !!shopifyAccessToken);
  }

  if (variantId && productUrl) {
    try {
      const origin = new URL(productUrl).origin;
      const cartUrl = new URL(`${origin}/cart/${variantId}:1`);
      if (discountCode) cartUrl.searchParams.set('discount', discountCode);
      else cartUrl.searchParams.set('botiga_deal', negotiationId);
      return { url: cartUrl.toString(), discountCode };
    } catch {}
  }

  const base = productUrl || 'https://checkout.botiga.ai';
  const url = new URL(base);
  if (discountCode) url.searchParams.set('discount', discountCode);
  else url.searchParams.set('botiga_deal', negotiationId);
  return { url: url.toString(), discountCode };
}

async function strikeDeal({ negotiation, dealPrice, merchantSettings, shopifyDomain, shopifyAccessToken, messages, merchantId, productImage }) {
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h — link valid 2 days
  const { url: checkoutUrl, discountCode } = await generateCheckoutUrl({
    productUrl: negotiation.product_url,
    variantId: negotiation.variant_id,
    dealPrice,
    listPrice: negotiation.list_price,
    negotiationId: negotiation.id,
    expiresAt,
    shopifyDomain,
    shopifyAccessToken
  });

  const fees = calculateBrokerFee({
    listPrice: negotiation.list_price,
    floorPrice: negotiation.floor_price,
    dealPrice,
    brokerFeePct: merchantSettings.broker_fee_pct || 25
  });

  const reply = `You've got a deal at $${dealPrice}! 🎉 Heading you to checkout now.`;

  await supabase.from('negotiations').update({
    messages: [...messages, { role: 'assistant', content: reply }],
    status: 'won',
    deal_price: dealPrice,
    spread: fees.spread,
    broker_fee: fees.brokerFee,
    checkout_url: checkoutUrl,
    discount_code: discountCode,
    deal_expires_at: expiresAt,
    bot_last_offered_price: dealPrice,
    updated_at: new Date().toISOString()
  }).eq('id', negotiation.id);

  await trackNegotiationEvent({
    merchantId, negotiationId: negotiation.id, event: 'deal_struck',
    properties: { list_price: negotiation.list_price, deal_price: dealPrice, broker_fee: fees.brokerFee }
  });

  // Send deal email — must await so Vercel doesn't terminate before SMTP completes
  const emailTo = negotiation.customer_email || null;
  if (emailTo) {
    try {
      await sendDealEmail({
        to: emailTo,
        productName: negotiation.product_name,
        dealPrice,
        listPrice: negotiation.list_price,
        discountCode,
        checkoutUrl,
        expiresAt,
        productImage: productImage || negotiation.product_image || null
      });
    } catch (err) {
      console.error('[Email] strikeDeal send failed:', err.message);
    }
  } else {
    console.warn('[Email] No customer_email on negotiation', negotiation.id);
  }

  return { reply, status: 'won', dealPrice, checkoutUrl, discountCode, brokerFee: fees.brokerFee, expiresAt, emailSentTo: emailTo };
}

function pickBrandStatement(brandStatements, stepIndex, usedStatements) {
  const all = (brandStatements || []).filter(Boolean);
  if (!all.length) return null;
  // Save strongest statements (last in array) for final steps
  const available = all.filter(s => !usedStatements.includes(s));
  if (!available.length) return all[stepIndex % all.length];
  // Steps 4-5 get the last remaining (strongest) statement
  if (stepIndex >= 4) return available[available.length - 1];
  return available[0];
}

async function processNegotiation({
  merchantId, merchantSettings, shopifyDomain, shopifyAccessToken,
  sessionId, negotiationId, productName, productUrl, productImage, variantId,
  listPrice, customerMessage, isOpening
}) {
  let negotiation;

  // ── CREATE NEW NEGOTIATION ──────────────────────────────────────────────────
  if (!negotiationId) {
    if (!isOpening) {
      const isRepeat = await checkRepeatNegotiator(sessionId, merchantId);
      if (isRepeat) {
        return { negotiationId: null, reply: "You already got our best deal on this item!", status: 'lost', dealPrice: null, checkoutUrl: null, brokerFee: null, expiresAt: null, discountCode: null };
      }
    }

    // Build price ladder once, store immediately
    const engine = new PricingEngine({
      listPrice,
      floorPrice: merchantSettings.floor_price_fixed || 0,
      maxDiscountPct: merchantSettings.max_discount_pct || 20
    });

    const { data, error } = await supabase.from('negotiations').insert({
      merchant_id: merchantId,
      session_id: sessionId,
      product_name: productName,
      product_url: productUrl,
      product_image: productImage || null,
      variant_id: variantId || null,
      list_price: listPrice,
      floor_price: engine.floorPrice,
      price_ladder: engine.priceLadder,
      current_step: 0,
      lowball_hold_messages: 0,
      bot_last_offered_price: listPrice,
      tone_used: merchantSettings.tone,
      messages: [],
      customer_insights: [],
      status: 'active'
    }).select().single();

    if (error) throw new Error('Failed to create negotiation: ' + error.message);
    negotiation = data;

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'negotiation_started',
      properties: { list_price: listPrice, product_name: productName, tone: merchantSettings.tone }
    });
  } else {
    // ── LOAD EXISTING NEGOTIATION ─────────────────────────────────────────────
    const { data, error } = await supabase.from('negotiations').select('*').eq('id', negotiationId).eq('merchant_id', merchantId).single();
    if (error || !data) throw new Error('Negotiation not found');
    negotiation = data;
  }

  // Already closed
  if (negotiation.status === 'won' || negotiation.status === 'lost') {
    return {
      negotiationId: negotiation.id,
      reply: negotiation.status === 'won' ? `This deal is already locked at $${negotiation.deal_price}!` : "Sorry, this negotiation has ended.",
      status: negotiation.status,
      dealPrice: negotiation.deal_price,
      checkoutUrl: negotiation.checkout_url,
      discountCode: negotiation.discount_code,
      brokerFee: negotiation.broker_fee,
      expiresAt: negotiation.deal_expires_at
    };
  }

  const messages = negotiation.messages || [];
  const priceLadder = negotiation.price_ladder || [];
  const floorPrice = negotiation.floor_price;
  const botLastPrice = negotiation.bot_last_offered_price || negotiation.list_price;
  const customerInsights = negotiation.customer_insights || [];
  const brandStatements = merchantSettings.brand_value_statements || [];
  const usedStatements = messages.filter(m => m.brand_statement).map(m => m.brand_statement);

  // ── CONTACT DETECTION — save phone/email if customer shared it ──────────────
  const contactUpdates = {};
  if (customerMessage) {
    const phoneMatch = customerMessage.match(/(?:\+?[\d\s\-().]{7,20})/);
    const emailMatch = customerMessage.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (phoneMatch && !negotiation.customer_whatsapp) {
      const cleaned = phoneMatch[0].replace(/[\s\-().]/g, '');
      if (cleaned.length >= 7) contactUpdates.customer_whatsapp = cleaned;
    }
    if (emailMatch && !negotiation.customer_email) {
      contactUpdates.customer_email = emailMatch[0];
    }
    if (Object.keys(contactUpdates).length > 0) {
      await supabase.from('negotiations').update(contactUpdates).eq('id', negotiation.id);
    }
  }

  // Whether bot has already asked for contact this negotiation
  const hasContact = !!(negotiation.customer_whatsapp || negotiation.customer_email || contactUpdates.customer_whatsapp || contactUpdates.customer_email);
  // Count how many times we've already asked
  const timesAskedContact = messages.filter(m => m.role === 'assistant' && m.asked_contact).length;
  // Ask on step 1 (second bot message, first customer reply) and once more on step 4 if still no contact
  // Never ask more than twice total
  const currentStepForLead = negotiation.current_step || 0;
  const needsLeadCapture = !hasContact && timesAskedContact < 2 && (timesAskedContact === 0 || currentStepForLead >= 1);

  // ── OPENING MOVE ────────────────────────────────────────────────────────────
  if (isOpening) {
    const nextPrice = priceLadder[0];
    const brandStatement = pickBrandStatement(brandStatements, 0, usedStatements);
    const hasContactAlready = !!(negotiation.customer_whatsapp || negotiation.customer_email);
    const systemPrompt = buildSystemPrompt({
      tone: merchantSettings.tone, productName, nextPrice,
      brandStatement, customerInsight: null,
      stepIndex: 0, isOpening: true, isLowball: false, isEscalating: false,
      lastBotMessages: [], needsLeadCapture: !hasContactAlready
    });

    const { reply } = await callLLM({
      systemPrompt, messages: [], customerMessage: null,
      negotiationId: negotiation.id, merchantId,
      nextPrice, brandStatement, isOpening: true, tone: merchantSettings.tone
    });

    // Mark opening as asked_contact:true so step 2 knows to ask for contact
    const updatedMessages = [{ role: 'assistant', content: reply, brand_statement: brandStatement, asked_contact: true }];
    await supabase.from('negotiations').update({
      messages: updatedMessages,
      bot_last_offered_price: nextPrice,
      current_step: 0,  // ← CRITICAL: persist step 0 so subsequent messages advance correctly
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    return { negotiationId: negotiation.id, reply, status: 'active', dealPrice: null, checkoutUrl: null, discountCode: null, brokerFee: null, expiresAt: null, needsLeadCapture: !hasContactAlready };
  }

  // ── STEP 1: ACCEPTANCE CHECK (before anything else, no LLM) ────────────────
  if (isAcceptance(customerMessage, botLastPrice)) {
    const customerOffer = parseCustomerOffer(customerMessage);
    let dealPrice = botLastPrice;
    if (customerOffer !== null && customerOffer < botLastPrice) {
      dealPrice = Math.max(Math.round(customerOffer), Math.ceil(floorPrice));
    }
    const updatedMessages = [...messages, { role: 'user', content: customerMessage }];
    // Pass freshly-detected email/phone — negotiation object was loaded before contact detection ran
    const freshEmail = contactUpdates.customer_email || negotiation.customer_email;
    const result = await strikeDeal({
      negotiation: { ...negotiation, messages: updatedMessages, customer_email: freshEmail },
      dealPrice, merchantSettings, shopifyDomain, shopifyAccessToken, messages: updatedMessages, merchantId, productImage
    });
    return { negotiationId: negotiation.id, ...result };
  }

  // ── STEP 2: LOWBALL CHECK ───────────────────────────────────────────────────
  const customerOffer = parseCustomerOffer(customerMessage);
  let currentStep = negotiation.current_step || 0;
  let lowballHold = negotiation.lowball_hold_messages || 0;
  let isLowball = false;
  let advanceStep = true;

  if (customerOffer !== null && customerOffer < floorPrice) {
    // Always advance on lowball — customers always lowball with a bot, stalling kills the negotiation
    isLowball = true;
    advanceStep = true;
  }

  // ── STEP 3: GET NEXT PRICE FROM LADDER ─────────────────────────────────────
  let nextStep = advanceStep ? Math.min(currentStep + 1, 5) : currentStep;
  let nextPrice = priceLadder[nextStep] ?? Math.round(floorPrice);
  // Never offer the same price as last time — skip ahead if needed
  while (nextPrice >= botLastPrice && nextStep < 5) {
    nextStep += 1;
    nextPrice = priceLadder[nextStep] ?? Math.round(floorPrice);
  }
  const isFinalOffer = nextStep === 5;

  // ── NEAR-MISS: if customer named a price and bot's next step lands within $5
  // of it, close the deal at the customer's price rather than look petty ────────
  if (customerOffer !== null && customerOffer >= Math.ceil(floorPrice) && Math.abs(nextPrice - customerOffer) <= 5) {
    const dealPrice = Math.max(Math.round(customerOffer), Math.ceil(floorPrice));
    const updatedMessages = [...messages, { role: 'user', content: customerMessage }];
    const freshEmail = contactUpdates.customer_email || negotiation.customer_email;
    const result = await strikeDeal({
      negotiation: { ...negotiation, messages: updatedMessages, customer_email: freshEmail },
      dealPrice, merchantSettings, shopifyDomain, shopifyAccessToken, messages: updatedMessages, merchantId, productImage
    });
    return { negotiationId: negotiation.id, ...result };
  }

  // ── PARALLEL: insights extraction + LLM call ───────────────────────────────
  const botRepliesAlready = messages.filter(m => m.role === 'assistant').length;
  const isEscalating = isFinalOffer && botRepliesAlready >= 5;
  const lastBotMessages = messages.filter(m => m.role === 'assistant').slice(-2).map(m => m.content);
  const latestInsight = customerInsights.slice(-1)[0]?.insight || null;
  const brandStatement = pickBrandStatement(brandStatements, nextStep, usedStatements);

  const systemPrompt = buildSystemPrompt({
    tone: merchantSettings.tone, productName: negotiation.product_name,
    nextPrice, brandStatement,
    customerInsight: latestInsight,
    stepIndex: nextStep, isOpening: false, isLowball, isEscalating, lastBotMessages,
    needsLeadCapture: needsLeadCapture && !isEscalating
  });

  const [insightResult, llmResult] = await Promise.all([
    extractCustomerInsight(customerMessage),
    callLLM({
      systemPrompt, messages, customerMessage,
      negotiationId: negotiation.id, merchantId,
      nextPrice, brandStatement, isOpening: false,
      tone: merchantSettings.tone
    })
  ]);

  const { reply } = llmResult;

  // Update insights
  let updatedInsights = customerInsights;
  if (insightResult.insight) {
    updatedInsights = [...customerInsights, { text: insightResult.insight, category: insightResult.category, message_index: messages.length }];
  }

  const updatedMessages = [
    ...messages,
    { role: 'user', content: customerMessage },
    { role: 'assistant', content: reply, brand_statement: brandStatement, asked_contact: needsLeadCapture || undefined, was_lowball: isLowball || undefined }
  ];

  // ── STEP 4: PERSIST ─────────────────────────────────────────────────────────
  let status = isEscalating ? 'human_escalated' : isFinalOffer ? 'final_offer' : 'active';

  if (isEscalating) {
    await supabase.from('admin_alerts').insert({
      merchant_id: merchantId,
      type: 'human_escalation',
      message: `Customer needs human follow-up on ${negotiation.product_name}. Their best offer: ${customerOffer ? '$' + customerOffer : 'unknown'}. Bot floor: $${floorPrice}. Contact: ${negotiation.customer_whatsapp || negotiation.customer_email || 'none captured'}`,
      severity: 'warning'
    });
    await trackNegotiationEvent({ merchantId, negotiationId: negotiation.id, event: 'negotiation_escalated', properties: { message_count: updatedMessages.length } });
  }

  await supabase.from('negotiations').update({
    messages: updatedMessages,
    current_step: nextStep,
    lowball_hold_messages: lowballHold,
    bot_last_offered_price: nextPrice,
    customer_insights: updatedInsights,
    status,
    updated_at: new Date().toISOString()
  }).eq('id', negotiation.id);

  // Log training row
  try {
    await supabase.from('negotiations_training').insert({
      negotiation_id: negotiation.id,
      merchant_id: merchantId,
      message_index: messages.length,
      customer_message: customerMessage,
      customer_offer: customerOffer,
      bot_message: reply,
      bot_price: nextPrice,
      pricing_action: isLowball ? 'lowball_hold' : advanceStep ? 'concede' : 'hold',
      brand_statement_used: brandStatement
    });
  } catch {}

  return {
    negotiationId: negotiation.id,
    reply,
    status,
    isFinalOffer,
    dealPrice: null,
    checkoutUrl: null,
    discountCode: null,
    brokerFee: null,
    expiresAt: null
  };
}

module.exports = { processNegotiation };
