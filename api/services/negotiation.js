const supabase = require('../lib/supabase');
const { callLLMWithFallback, buildSystemPrompt } = require('./llm');
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

// Parse customer's numeric offer from their message
function parseCustomerOffer(message) {
  const matches = message.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g);
  if (!matches) return null;
  const prices = matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 10);
  return prices.length > 0 ? Math.max(...prices) : null;
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
      if (discountCode) {
        cartUrl.searchParams.set('discount', discountCode);
      } else {
        cartUrl.searchParams.set('botiga_deal', negotiationId);
      }
      return { url: cartUrl.toString(), discountCode };
    } catch {}
  }

  const base = productUrl || 'https://checkout.botiga.ai';
  const url = new URL(base);
  if (discountCode) {
    url.searchParams.set('discount', discountCode);
  } else {
    url.searchParams.set('botiga_deal', negotiationId);
  }
  return { url: url.toString(), discountCode };
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
      reply: negotiation.status === 'won' ? `This deal is already locked at $${negotiation.deal_price}!` : "Sorry, this negotiation has ended.",
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

  // SERVER-SIDE: Check if customer's offer meets or beats bot's last offer → instant deal
  const customerOffer = parseCustomerOffer(customerMessage);
  if (customerOffer !== null && customerOffer >= botLastOfferedPrice) {
    const finalDealPrice = Math.max(botLastOfferedPrice, floorPrice);
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

    const updatedMessages = [
      ...messages,
      { role: 'user', content: customerMessage },
      { role: 'assistant', content: `You've got a deal at $${finalDealPrice.toFixed(2)}! Heading you to checkout now 🎉` }
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
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    return {
      negotiationId: negotiation.id,
      reply: `You've got a deal at $${finalDealPrice.toFixed(2)}! Heading you to checkout now 🎉`,
      status: 'won',
      dealPrice: finalDealPrice,
      checkoutUrl,
      brokerFee: fees.brokerFee,
      expiresAt
    };
  }

  const systemPrompt = buildSystemPrompt({
    tone: merchantSettings.tone,
    productName: negotiation.product_name,
    listPrice: negotiation.list_price,
    floorPrice,
    botLastOfferedPrice,
    messageCount,
    maxMessages: MAX_MESSAGES
  });

  const { reply: rawReply, isDealStruck, dealPrice: rawDealPrice, botOfferedPrice } = await callLLMWithFallback({
    systemPrompt,
    messages,
    customerMessage,
    negotiationId: negotiation.id,
    merchantId
  });

  // Enforce floor price on LLM deal
  let reply = rawReply;
  let finalDealPrice = null;
  let checkoutUrl = null;
  let discountCode = null;
  let brokerFee = null;
  let expiresAt = null;
  let status = 'active';

  const updatedMessages = [
    ...messages,
    { role: 'user', content: customerMessage },
    { role: 'assistant', content: reply }
  ];

  // Track bot's new offered price — never let it go lower than previous offer if customer moved up
  let newBotOfferedPrice = botOfferedPrice;
  if (customerOffer !== null && customerOffer > (parseCustomerOffer(messages[messages.length - 2]?.content || '') || 0)) {
    // Customer moved UP — bot should not drop lower than before
    if (newBotOfferedPrice !== null && newBotOfferedPrice < botLastOfferedPrice) {
      newBotOfferedPrice = botLastOfferedPrice;
    }
  }
  // Never let bot offer below floor
  if (newBotOfferedPrice !== null && newBotOfferedPrice < floorPrice) {
    newBotOfferedPrice = floorPrice;
  }

  if (isDealStruck && rawDealPrice != null) {
    finalDealPrice = Math.max(rawDealPrice, floorPrice);
    expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const result = await generateCheckoutUrl({
      productUrl: negotiation.product_url,
      variantId: negotiation.variant_id,
      dealPrice: finalDealPrice,
      listPrice: negotiation.list_price,
      negotiationId: negotiation.id,
      expiresAt,
      shopifyDomain,
      shopifyAccessToken
    });
    checkoutUrl = result.url;
    discountCode = result.discountCode;

    const fees = calculateBrokerFee({
      listPrice: negotiation.list_price,
      floorPrice,
      dealPrice: finalDealPrice,
      brokerFeePct: merchantSettings.broker_fee_pct || 25
    });
    brokerFee = fees.brokerFee;
    status = 'won';

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status,
      deal_price: finalDealPrice,
      spread: fees.spread,
      broker_fee: brokerFee,
      checkout_url: checkoutUrl,
      discount_code: discountCode,
      deal_expires_at: expiresAt,
      bot_last_offered_price: finalDealPrice,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'deal_struck',
      properties: { list_price: negotiation.list_price, deal_price: finalDealPrice, broker_fee: brokerFee }
    });

  } else if (messageCount + 1 >= MAX_MESSAGES && !isDealStruck) {
    status = 'human_escalated';

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status,
      bot_last_offered_price: newBotOfferedPrice || botLastOfferedPrice,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    // Create admin alert for human escalation
    await supabase.from('admin_alerts').insert({
      merchant_id: merchantId,
      type: 'human_escalation',
      message: `Customer needs human follow-up on ${negotiation.product_name}. Their best offer: ${customerOffer ? '$' + customerOffer : 'unknown'}. Bot floor: $${floorPrice}. Contact: ${negotiation.customer_whatsapp || negotiation.customer_email || 'none captured'}`,
      severity: 'warning'
    });

    await trackNegotiationEvent({
      merchantId, negotiationId: negotiation.id, event: 'negotiation_escalated',
      properties: { message_count: messageCount + 1 }
    });
  } else {
    await supabase.from('negotiations').update({
      messages: updatedMessages,
      bot_last_offered_price: newBotOfferedPrice || botLastOfferedPrice,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);
  }

  return { negotiationId: negotiation.id, reply, status, dealPrice: finalDealPrice, checkoutUrl, brokerFee, expiresAt };
}

module.exports = { processNegotiation };
