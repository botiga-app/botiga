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
    : listPrice * (1 - settings.max_discount_pct / 100);
  const fromFixed = settings.floor_price_fixed || 0;
  return Math.max(fromPct, fromFixed);
}

async function generateCheckoutUrl({ productUrl, variantId, dealPrice, listPrice, negotiationId, expiresAt, shopifyDomain, shopifyAccessToken }) {
  let discountCode = null;

  // Try to create a real Shopify discount code if merchant has OAuth connected
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
        cartUrl.searchParams.set('botiga_price', dealPrice.toFixed(2));
        cartUrl.searchParams.set('botiga_deal', negotiationId);
      }
      return cartUrl.toString();
    } catch {}
  }

  const base = productUrl || 'https://checkout.botiga.ai';
  const url = new URL(base);
  if (discountCode) {
    url.searchParams.set('discount', discountCode);
  } else {
    url.searchParams.set('botiga_price', dealPrice.toFixed(2));
    url.searchParams.set('botiga_deal', negotiationId);
  }
  return url.toString();
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
  // Load or create negotiation record
  let negotiation;

  if (negotiationId) {
    const { data, error } = await supabase
      .from('negotiations')
      .select('*')
      .eq('id', negotiationId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !data) {
      throw new Error('Negotiation not found');
    }
    negotiation = data;
  } else {
    // Check for repeat negotiator before creating
    const isRepeat = await checkRepeatNegotiator(sessionId, merchantId);
    if (isRepeat) {
      return {
        negotiationId: null,
        reply: "You already got our best deal on this item!",
        status: 'lost',
        dealPrice: null,
        checkoutUrl: null,
        brokerFee: null,
        expiresAt: null
      };
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
        tone_used: merchantSettings.tone,
        messages: [],
        status: 'active'
      })
      .select()
      .single();

    if (error) throw new Error('Failed to create negotiation: ' + error.message);
    negotiation = data;

    await trackNegotiationEvent({
      merchantId,
      negotiationId: negotiation.id,
      event: 'negotiation_started',
      properties: { list_price: listPrice, product_name: productName, tone: merchantSettings.tone }
    });
  }

  // Guard: don't continue finished negotiations
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

  const systemPrompt = buildSystemPrompt({
    tone: merchantSettings.tone,
    productName: negotiation.product_name,
    listPrice: negotiation.list_price,
    floorPrice: negotiation.floor_price,
    messageCount,
    maxMessages: MAX_MESSAGES
  });

  const { reply, isDealStruck, dealPrice: rawDealPrice } = await callLLMWithFallback({
    systemPrompt,
    messages,
    customerMessage,
    negotiationId: negotiation.id,
    merchantId
  });

  // Append to message history
  const updatedMessages = [
    ...messages,
    { role: 'user', content: customerMessage },
    { role: 'assistant', content: reply }
  ];

  let status = 'active';
  let finalDealPrice = null;
  let checkoutUrl = null;
  let brokerFee = null;
  let expiresAt = null;

  if (isDealStruck && rawDealPrice != null) {
    // CRITICAL: Enforce floor price server-side
    finalDealPrice = Math.max(rawDealPrice, negotiation.floor_price);

    const fees = calculateBrokerFee({
      listPrice: negotiation.list_price,
      floorPrice: negotiation.floor_price,
      dealPrice: finalDealPrice,
      brokerFeePct: merchantSettings.broker_fee_pct || 25
    });

    brokerFee = fees.brokerFee;
    status = 'won';
    expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
    checkoutUrl = await generateCheckoutUrl({ productUrl: negotiation.product_url, variantId: negotiation.variant_id, dealPrice: finalDealPrice, listPrice: negotiation.list_price, negotiationId: negotiation.id, expiresAt, shopifyDomain, shopifyAccessToken });

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status,
      deal_price: finalDealPrice,
      spread: fees.spread,
      broker_fee: brokerFee,
      checkout_url: checkoutUrl,
      deal_expires_at: expiresAt,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    await trackNegotiationEvent({
      merchantId,
      negotiationId: negotiation.id,
      event: 'deal_struck',
      properties: {
        list_price: negotiation.list_price,
        deal_price: finalDealPrice,
        broker_fee: brokerFee,
        discount_pct: ((negotiation.list_price - finalDealPrice) / negotiation.list_price * 100).toFixed(1)
      }
    });
  } else if (messageCount + 1 >= MAX_MESSAGES && !isDealStruck) {
    status = 'lost';

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      status,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);

    await trackNegotiationEvent({
      merchantId,
      negotiationId: negotiation.id,
      event: 'negotiation_lost',
      properties: { message_count: messageCount + 1 }
    });
  } else {
    await supabase.from('negotiations').update({
      messages: updatedMessages,
      updated_at: new Date().toISOString()
    }).eq('id', negotiation.id);
  }

  return {
    negotiationId: negotiation.id,
    reply,
    status,
    dealPrice: finalDealPrice,
    checkoutUrl,
    brokerFee,
    expiresAt
  };
}

module.exports = { processNegotiation };
