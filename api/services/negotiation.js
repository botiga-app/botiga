const supabase = require('../lib/supabase');
const { callLLMWithFallback, buildAtomicSystemPrompt } = require('./llm');
const { computeNextBotPrice } = require('./pricing-engine');
const { extractCustomerInsight } = require('./insights');
const { calculateBrokerFee } = require('./broker-fee');
const { checkRepeatNegotiator } = require('./fingerprint');
const { trackNegotiationEvent } = require('../lib/posthog');
const { createShopifyDiscountCode } = require('./shopify');

const MAX_MESSAGES = 6;

function computeFloorPrice(listPrice, settings) {
  const fromPct = settings.floor_price_pct
    ? listPrice * (1 - settings.floor_price_pct / 100)
    : listPrice * (1 - (settings.max_discount_pct || 20) / 100);
  const fromFixed = settings.floor_price_fixed || 0;
  return Math.max(fromPct, fromFixed);
}

function parseCustomerOffer(message) {
  if (!message) return null;
  const matches = message.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g);
  if (!matches) return null;
  const prices = matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 10);
  return prices.length > 0 ? Math.max(...prices) : null;
}

/**
 * Pick one brand value statement that hasn't been used yet in this negotiation.
 * Returns a statement string or null.
 */
function pickBrandStatement(brandStatements, usedStatements) {
  const available = (brandStatements || []).filter(s => s && !usedStatements.includes(s));
  if (available.length === 0) return null;
  // Deterministic pick based on how many have been used so far
  return available[0];
}

async function generateCheckoutUrl({ productUrl, variantId, dealPrice, listPrice, negotiationId, expiresAt, shopifyDomain, shopifyAccessToken }) {
  let discountCode = null;

  if (shopifyDomain && shopifyAccessToken) {
    try {
      discountCode = await createShopifyDiscountCode({
        shop: shopifyDomain,
        accessToken: shopifyAccessToken,
        listPrice,
        dealPrice,
        negotiationId,
        expiresAt
      });
    } catch (err) {
      console.error('[Shopify] Discount code creation failed:', err.message);
    }
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

async function logTrainingRow({ negotiationId, merchantId, messageIndex, customerMessage, customerOffer, botMessage, botPrice, pricingAction, customerPricePrev, brandStatementUsed }) {
  try {
    const customerPriceMovement = (customerOffer !== null && customerPricePrev !== null)
      ? customerOffer - customerPricePrev
      : null;

    await supabase.from('negotiations_training').insert({
      negotiation_id: negotiationId,
      merchant_id: merchantId,
      message_index: messageIndex,
      customer_message: customerMessage,
      customer_offer: customerOffer,
      bot_message: botMessage,
      bot_price: botPrice,
      pricing_action: pricingAction,
      customer_price_movement: customerPriceMovement,
      brand_statement_used: brandStatementUsed
    });
  } catch {}
}

async function processNegotiation({
  merchantId,
  merchantSettings,
  shopifyDomain,
  shopifyAccessToken,
  sessionId,
  negotiationId,
  productName,
  productUrl,
  variantId,
  listPrice,
  customerMessage
}) {
  let negotiation;

  if (negotiationId) {
    const { data, error } = await supabase
      .from('negotiations')
      .select('*')
      .eq('id', negotiationId)
      .eq('merchant_id', merchantId)
      .single();
    if (error || !data) throw new Error('Negotiation not found');
    negotiation = data;
  } else {
    const isRepeat = await checkRepeatNegotiator(sessionId, merchantId);
    if (isRepeat) {
      return { negotiationId: null, reply: "You already got our best deal on this item!", status: 'lost', dealPrice: null, checkoutUrl: null, brokerFee: null, expiresAt: null };
    }

    const floorPrice = computeFloorPrice(listPrice, merchantSettings);

    const { data, error } = await supabase
      .from('negotiations')
      .insert({
        merchant_id: merchantId,
        session_id: sessionId,
        product_name: productName,
        product_url: productUrl,
        variant_id: variantId || null,
        list_price: listPrice,
        floor_price: floorPrice,
        bot_last_offered_price: listPrice,
        tone_used: merchantSettings.tone,
        messages: [],
        customer_insights: [],
        status: 'active'
      })
      .select()
      .single();

    if (error) throw new Error('Failed to create negotiation: ' + error.message);
    negotiation = data;

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'negotiation_started',
      properties: { list_price: listPrice, product_name: productName, tone: merchantSettings.tone }
    });
  }

  if (negotiation.status === 'won' || negotiation.status === 'lost') {
    return {
      negotiationId: negotiation.id,
      reply: negotiation.status === 'won'
        ? `This deal is already locked at $${negotiation.deal_price}!`
        : "Sorry, this negotiation has ended.",
      status: negotiation.status,
      dealPrice: negotiation.deal_price,
      checkoutUrl: negotiation.checkout_url,
      brokerFee: negotiation.broker_fee,
      expiresAt: negotiation.deal_expires_at
    };
  }

  const messages = negotiation.messages || [];
  const messageCount = messages.length;
  const floorPrice = negotiation.floor_price;
  const botLastOfferedPrice = negotiation.bot_last_offered_price || negotiation.list_price;
  const customerInsights = negotiation.customer_insights || [];
  const brandStatements = merchantSettings.brand_value_statements || [];

  // Track which brand statements have been used so far (from messages)
  const usedStatements = messages
    .filter(m => m.role === 'assistant' && m.brand_statement)
    .map(m => m.brand_statement);

  const customerOffer = parseCustomerOffer(customerMessage);

  // Previous customer offer (for training movement tracking)
  const prevUserMessages = messages.filter(m => m.role === 'user');
  const prevCustomerOffer = prevUserMessages.length > 0
    ? parseCustomerOffer(prevUserMessages[prevUserMessages.length - 1].content)
    : null;

  // Step 1: PricingEngine computes the next price — LLM cannot override this
  const { price: nextBotPrice, isDeal, isHold, isAnchor } = computeNextBotPrice({
    listPrice: negotiation.list_price,
    floorPrice,
    botLastOffer: botLastOfferedPrice,
    customerOffer,
    messageCount,
    maxMessages: MAX_MESSAGES
  });

  // Step 2: If deal, close immediately without calling LLM
  if (isDeal) {
    const finalDealPrice = nextBotPrice;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { url: checkoutUrl, discountCode } = await generateCheckoutUrl({
      productUrl: negotiation.product_url,
      variantId: negotiation.variant_id,
      dealPrice: finalDealPrice,
      listPrice: negotiation.list_price,
      negotiationId: negotiation.id,
      expiresAt,
      shopifyDomain,
      shopifyAccessToken
    });

    const fees = calculateBrokerFee({
      listPrice: negotiation.list_price,
      floorPrice,
      dealPrice: finalDealPrice,
      brokerFeePct: merchantSettings.broker_fee_pct || 25
    });

    const dealReply = `You've got a deal at $${finalDealPrice.toFixed(2)}! Heading you to checkout now 🎉`;
    const updatedMessages = [
      ...messages,
      { role: 'user', content: customerMessage },
      { role: 'assistant', content: dealReply }
    ];

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status: 'won',
      deal_price: finalDealPrice,
      spread: fees.spread,
      broker_fee: fees.brokerFee,
      checkout_url: checkoutUrl,
      discount_code: discountCode,
      deal_expires_at: expiresAt,
      bot_last_offered_price: finalDealPrice,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    await logTrainingRow({
      negotiationId: negotiation.id, merchantId, messageIndex: messageCount,
      customerMessage, customerOffer, botMessage: dealReply, botPrice: finalDealPrice,
      pricingAction: 'deal', customerPricePrev: prevCustomerOffer, brandStatementUsed: null
    });

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'deal_struck',
      properties: { list_price: negotiation.list_price, deal_price: finalDealPrice, broker_fee: fees.brokerFee }
    });

    return { negotiationId: negotiation.id, reply: dealReply, status: 'won', dealPrice: finalDealPrice, checkoutUrl, brokerFee: fees.brokerFee, expiresAt };
  }

  // Step 3: Pick brand statement and run insight extraction in parallel with LLM
  const selectedStatement = pickBrandStatement(brandStatements, usedStatements);
  const pricingAction = isAnchor ? 'anchor' : isHold ? 'hold' : 'concede';

  const systemPrompt = buildAtomicSystemPrompt({
    tone: merchantSettings.tone,
    productName: negotiation.product_name,
    nextBotPrice,
    brandValueStatement: selectedStatement,
    customerInsights,
    messageCount,
    maxMessages: MAX_MESSAGES,
    isHold,
    isAnchor
  });

  // Parallel: insight extraction + main LLM call
  const [insightResult, llmResult] = await Promise.all([
    extractCustomerInsight(customerMessage),
    callLLMWithFallback({
      systemPrompt,
      messages,
      customerMessage,
      negotiationId: negotiation.id,
      merchantId,
      nextBotPrice,
      brandValueStatement: selectedStatement,
      isHold
    })
  ]);

  const { reply, botOfferedPrice } = llmResult;

  // Update insights if new one found
  let updatedInsights = customerInsights;
  if (insightResult.insight) {
    updatedInsights = [...customerInsights, {
      text: insightResult.insight,
      category: insightResult.category,
      message_index: messageCount
    }];
  }

  const updatedMessages = [
    ...messages,
    { role: 'user', content: customerMessage },
    { role: 'assistant', content: reply, brand_statement: selectedStatement }
  ];

  // Step 4: Persist and handle escalation
  if (messageCount + 1 >= MAX_MESSAGES) {
    const status = 'human_escalated';

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status,
      bot_last_offered_price: botOfferedPrice,
      customer_insights: updatedInsights,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    await supabase.from('admin_alerts').insert({
      merchant_id: merchantId,
      type: 'human_escalation',
      message: `Customer needs follow-up on ${negotiation.product_name}. Their best offer: ${customerOffer ? '$' + customerOffer : 'unknown'}. Bot floor: $${floorPrice}. Contact: ${negotiation.customer_whatsapp || negotiation.customer_email || 'none captured'}`,
      severity: 'warning'
    });

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'negotiation_escalated',
      properties: { message_count: messageCount + 1 }
    });
  } else {
    await supabase.from('negotiations').update({
      messages: updatedMessages,
      bot_last_offered_price: botOfferedPrice,
      customer_insights: updatedInsights,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);
  }

  await logTrainingRow({
    negotiationId: negotiation.id, merchantId, messageIndex: messageCount,
    customerMessage, customerOffer, botMessage: reply, botPrice: botOfferedPrice,
    pricingAction, customerPricePrev: prevCustomerOffer, brandStatementUsed: selectedStatement
  });

  const status = (messageCount + 1 >= MAX_MESSAGES) ? 'human_escalated' : 'active';
  return { negotiationId: negotiation.id, reply, status, dealPrice: null, checkoutUrl: null, brokerFee: null, expiresAt: null };
}

module.exports = { processNegotiation };
