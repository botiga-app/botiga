const supabase = require('../lib/supabase');
const { callLLM, buildSystemPrompt } = require('./llm');
const storeContext = require('./storeContext');
const { PricingEngine, isAcceptance, parseCustomerOffer } = require('./PricingEngine');
const { extractCustomerInsight } = require('./insights');
const { calculateBrokerFee } = require('./broker-fee');
const { checkRepeatNegotiator } = require('./fingerprint');
const { trackNegotiationEvent } = require('../lib/posthog');
const { createShopifyDiscountCode } = require('./shopify');
const { upsertNegotiatedItem } = require('./draftOrder');
const { sendDealEmail } = require('./email');
const { sendDealSms } = require('./sms');
const { resolveProductRules } = require('./rules');
const { detectDiscoveryIntent, searchProducts } = require('./productSearch');
const { getActiveDirectives } = require('./botInstructions');

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

  // Build a /checkout fallback URL — redirects the customer straight to
  // checkout instead of stopping at the cart page. The frontend has
  // already added the variant via /cart/add.js, so cart has the item;
  // /checkout pulls from cart and starts the checkout flow with the
  // discount pre-applied.
  //
  // Why /checkout not /cart/{variant}:1?discount=...:
  //   - The variant-permalink format ("/cart/{id}:1") fails on Online
  //     Store 2.0 themes when the variant doesn't resolve cleanly →
  //     "Link no longer exists" error
  //   - /cart works but stops the customer at a redundant cart page;
  //     merchants prefer fewer clicks-to-checkout
  if (productUrl) {
    try {
      const origin = new URL(productUrl).origin;
      const checkoutUrl = new URL(`${origin}/checkout`);
      if (discountCode) checkoutUrl.searchParams.set('discount', discountCode);
      else checkoutUrl.searchParams.set('botiga_deal', negotiationId);
      return { url: checkoutUrl.toString(), discountCode };
    } catch {}
  }

  const base = productUrl || 'https://checkout.botiga.ai';
  const url = new URL(base);
  if (discountCode) url.searchParams.set('discount', discountCode);
  else url.searchParams.set('botiga_deal', negotiationId);
  return { url: url.toString(), discountCode };
}

async function fetchProductImage(productUrl) {
  try {
    const u = new URL(productUrl);
    // Strip query string and append .json to get Shopify product JSON
    const jsonUrl = u.origin + u.pathname.split('?')[0].replace(/\/$/, '') + '.json';
    const resp = await fetch(jsonUrl, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.product?.images?.[0]?.src || null;
  } catch {
    return null;
  }
}

async function strikeDeal({ negotiation, dealPrice, merchantSettings, shopifyDomain, shopifyAccessToken, messages, merchantId, productImage }) {
  // ── FLOOR GUARD — sacred constraint ──
  // No deal can close below the merchant's stored floor. Even if a caller
  // passes a lower dealPrice (bug, hallucination, race condition), bump
  // it back up to the floor and log loudly so we catch the regression.
  // The floor was calculated at negotiation start and stored in
  // negotiations.floor_price — it's the source of truth.
  if (negotiation.floor_price != null && dealPrice < negotiation.floor_price) {
    console.error(
      `[strikeDeal] FLOOR VIOLATION blocked: dealPrice=${dealPrice} < floor=${negotiation.floor_price} ` +
      `for negotiation ${negotiation.id}. Bumping to floor.`
    );
    dealPrice = Math.ceil(negotiation.floor_price);
  }

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h — link valid 2 days

  // Resolve product image: widget → DB → fetch from Shopify product JSON
  let resolvedImage = productImage || negotiation.product_image || null;
  if (!resolvedImage && negotiation.product_url) {
    resolvedImage = await fetchProductImage(negotiation.product_url);
  }
  let checkoutUrl, discountCode;
  let draftOrderId = null, draftOrderLineItemId = null, draftOrderInvoiceUrl = null;

  if (shopifyDomain && shopifyAccessToken && negotiation.variant_id && !negotiation.is_cart_bundle) {
    // Primary path: Draft Order — exact per-item price, supports multiple items
    try {
      const result = await upsertNegotiatedItem({
        supabase,
        shop: shopifyDomain,
        accessToken: shopifyAccessToken,
        sessionToken: negotiation.session_token || negotiation.session_id,
        variantId: negotiation.variant_id,
        negotiatedPrice: dealPrice,
        listPrice: negotiation.list_price
      });
      draftOrderId = result.draftOrderId;
      draftOrderLineItemId = result.lineItemId ? parseInt(result.lineItemId, 10) : null;
      draftOrderInvoiceUrl = result.invoiceUrl;
      checkoutUrl = result.invoiceUrl;
      discountCode = null;
      console.log('[DraftOrder] Upserted:', draftOrderId, 'line item:', draftOrderLineItemId);
    } catch (err) {
      console.error('[DraftOrder] Failed, falling back to discount code:', err.message);
    }
  }

  // Fallback: discount code (cart-bundle or Draft Order failed or no Shopify creds)
  if (!checkoutUrl) {
    if (negotiation.is_cart_bundle) {
      discountCode = shopifyDomain && shopifyAccessToken
        ? await (async () => {
            try {
              return await createShopifyDiscountCode({
                shop: shopifyDomain, accessToken: shopifyAccessToken,
                listPrice: negotiation.list_price, dealPrice,
                negotiationId: negotiation.id, expiresAt
              });
            } catch (e) { console.error('[Shopify] Cart bundle discount failed:', e.message); return null; }
          })()
        : null;
      const origin = shopifyDomain ? `https://${shopifyDomain}` : '';
      checkoutUrl = discountCode ? `${origin}/checkout?discount=${discountCode}` : `${origin}/checkout`;
    } else {
      ({ url: checkoutUrl, discountCode } = await generateCheckoutUrl({
        productUrl: negotiation.product_url,
        variantId: negotiation.variant_id,
        dealPrice, listPrice: negotiation.list_price,
        negotiationId: negotiation.id, expiresAt,
        shopifyDomain, shopifyAccessToken
      }));
    }
  }

  const fees = calculateBrokerFee({
    listPrice: negotiation.list_price,
    floorPrice: negotiation.floor_price,
    dealPrice,
    brokerFeePct: merchantSettings.broker_fee_pct || 25
  });

  const reply = `You've got a deal at $${dealPrice}! 🎉`;

  await supabase.from('negotiations').update({
    messages: [...messages, { role: 'assistant', content: reply }],
    status: 'won',
    deal_price: dealPrice,
    spread: fees.spread,
    broker_fee: fees.brokerFee,
    checkout_url: checkoutUrl,
    discount_code: discountCode,
    draft_order_id: draftOrderId,
    draft_order_line_item_id: draftOrderLineItemId,
    draft_order_invoice_url: draftOrderInvoiceUrl,
    deal_expires_at: expiresAt,
    bot_last_offered_price: dealPrice,
    updated_at: new Date().toISOString()
  }).eq('id', negotiation.id);

  await trackNegotiationEvent({
    merchantId, negotiationId: negotiation.id, event: 'deal_struck',
    properties: { list_price: negotiation.list_price, deal_price: dealPrice, broker_fee: fees.brokerFee }
  });

  // Send deal notification — email if email captured, SMS if phone captured
  const emailTo = negotiation.customer_email || null;
  const phoneTo = negotiation.customer_whatsapp || null; // stored as phone (not WhatsApp)
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
        productImage: resolvedImage
      });
    } catch (err) {
      console.error('[Email] strikeDeal send failed:', err.message);
    }
  } else if (phoneTo) {
    try {
      await sendDealSms({
        to: phoneTo,
        productName: negotiation.product_name,
        dealPrice,
        discountCode,
        checkoutUrl
      });
    } catch (err) {
      console.error('[SMS] strikeDeal send failed:', err.message);
    }
  } else {
    console.warn('[Notify] No contact on negotiation', negotiation.id);
  }

  return {
    reply, status: 'won', dealPrice, checkoutUrl, discountCode,
    draftOrderId, draftOrderLineItemId, draftOrderInvoiceUrl,
    brokerFee: fees.brokerFee, expiresAt, emailSentTo: emailTo
  };
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
  sessionId, sessionToken, negotiationId, productName, productUrl, productImage, variantId,
  listPrice, customerMessage, isOpening, isCartBundle, customerEmail, productContext
}) {
  let negotiation;

  // Best-effort: enrich productContext with live store context (collections,
  // active site-wide promos, brand voice) from merchant.source_url. Failure
  // here must never block a negotiation, so we swallow errors.
  try {
    const { data: merchantRow } = await supabase
      .from('merchants')
      .select('id, source_url, shopify_domain')
      .eq('id', merchantId)
      .maybeSingle();
    if (merchantRow) {
      const storeCtx = await storeContext.buildLLMContext(merchantRow);
      if (storeCtx) {
        productContext = (productContext ? productContext + '\n\n' : '') + storeCtx;
      }
    }
  } catch (e) {
    console.warn('[negotiation] storeContext enrichment failed:', e.message);
  }

  // ── CREATE NEW NEGOTIATION ──────────────────────────────────────────────────
  if (!negotiationId) {
    if (!isOpening) {
      const isRepeat = await checkRepeatNegotiator(sessionId, merchantId);
      if (isRepeat) {
        return { negotiationId: null, reply: "You already got our best deal on this item!", status: 'lost', dealPrice: null, checkoutUrl: null, brokerFee: null, expiresAt: null, discountCode: null };
      }
    }

    // Resolve per-product rules (product/tag overrides) for non-cart bundles
    let effectiveSettings = merchantSettings;
    if (!isCartBundle && productUrl) {
      try {
        const handleMatch = productUrl.match(/\/products\/([^/?#]+)/);
        const handle = handleMatch ? handleMatch[1] : '';
        const resolved = await resolveProductRules(merchantId, { handle, tags: [], defaults: merchantSettings });
        effectiveSettings = { ...merchantSettings, ...resolved };
      } catch {}
    }

    // Cart bundles use cart_max_discount_pct (default 10%) — tighter than per-product
    const maxDiscountPct = isCartBundle
      ? (merchantSettings.cart_max_discount_pct || 10)
      : (effectiveSettings.max_discount_pct || 20);

    // Build price ladder once, store immediately
    const engine = new PricingEngine({
      listPrice,
      floorPrice: effectiveSettings.floor_price_fixed || 0,
      maxDiscountPct
    });

    const { data, error } = await supabase.from('negotiations').insert({
      merchant_id: merchantId,
      session_id: sessionId,
      session_token: sessionToken || sessionId,
      product_name: productName,
      product_url: productUrl,
      product_image: productImage || null,
      variant_id: variantId || null,
      is_cart_bundle: isCartBundle || false,
      list_price: listPrice,
      floor_price: engine.floorPrice,
      price_ladder: engine.priceLadder,
      current_step: 0,
      lowball_hold_messages: 0,
      bot_last_offered_price: listPrice,
      tone_used: merchantSettings.tone,
      messages: [],
      customer_insights: [],
      status: 'active',
      ...(customerEmail ? { customer_email: customerEmail.toLowerCase().trim() } : {})
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

  // ── CONTACT + NAME DETECTION — save anything the customer shares ───────────
  // The bot asks for ONE contact channel only (email by default). A second
  // ask later in the conversation requests their NAME, not the other channel.
  // Piling on questions kills conversion — we capture whatever the customer
  // happens to type and stop asking once any one is in.
  const contactUpdates = {};
  if (customerMessage) {
    const phoneMatch = customerMessage.match(/(?:\+?[\d\s\-().]{7,20})/);
    const emailMatch = customerMessage.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const nameMatch = customerMessage.match(/(?:i['’]m|my name is|this is|call me)\s+([A-Z][a-zA-Z]{1,30})/i);

    if (phoneMatch && !negotiation.customer_whatsapp) {
      const cleaned = phoneMatch[0].replace(/[\s\-().]/g, '');
      if (cleaned.length >= 7) contactUpdates.customer_whatsapp = cleaned;
    }
    if (emailMatch && !negotiation.customer_email) {
      contactUpdates.customer_email = emailMatch[0];
    }
    if (nameMatch && !negotiation.customer_name) {
      contactUpdates.customer_name = nameMatch[1];
    }
    if (Object.keys(contactUpdates).length > 0) {
      await supabase.from('negotiations').update(contactUpdates).eq('id', negotiation.id);
    }
  }

  const hasContact = !!(negotiation.customer_whatsapp || negotiation.customer_email || contactUpdates.customer_whatsapp || contactUpdates.customer_email);
  const hasName = !!(negotiation.customer_name || contactUpdates.customer_name);
  const timesAskedContact = messages.filter(m => m.role === 'assistant' && m.asked_contact).length;
  const timesAskedName = messages.filter(m => m.role === 'assistant' && m.asked_name).length;
  const currentStepForLead = negotiation.current_step || 0;
  // First pass: ask for contact in opening. If still no contact at step 1+,
  // give it one more shot — but never more than twice total.
  const needsLeadCapture = !hasContact && timesAskedContact < 2 && (timesAskedContact === 0 || currentStepForLead >= 1);
  // Once contact is in, the next "would-have-been-contact" ask becomes a
  // name ask. One ask only — never both contact and name in the same turn.
  const needsNameCapture = !needsLeadCapture && hasContact && !hasName && timesAskedName === 0 && currentStepForLead >= 2;

  // Pull merchant's bot training directives once per turn — fed into both
  // the LLM prompt (context phrases + claims) and any subsequent
  // product-search calls (boost/suppress).
  let ownerInstructions = { directives: [], context_phrases: [], claims: [] };
  try {
    ownerInstructions = await getActiveDirectives(supabase, merchantId);
  } catch (e) {
    console.warn('[negotiation] getActiveDirectives failed:', e.message);
  }

  // ── OPENING MOVE ────────────────────────────────────────────────────────────
  if (isOpening) {
    const nextPrice = priceLadder[0];
    const brandStatement = pickBrandStatement(brandStatements, 0, usedStatements);
    const hasContactAlready = !!(negotiation.customer_whatsapp || negotiation.customer_email);
    const systemPrompt = buildSystemPrompt({
      tone: merchantSettings.tone, productName, nextPrice,
      brandStatement, customerInsight: null,
      stepIndex: 0, isOpening: true, isLowball: false, isEscalating: false,
      lastBotMessages: [], needsLeadCapture: !hasContactAlready,
      productContext: productContext || null,
      ownerInstructions,
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

    return { negotiationId: negotiation.id, reply, status: 'active', dealPrice: null, checkoutUrl: null, discountCode: null, brokerFee: null, expiresAt: null, needsLeadCapture: !hasContactAlready, offeredPrice: nextPrice };
  }

  // ── DISCOVERY SHORT-CIRCUIT ────────────────────────────────────────────────
  // The widget chat lives on a single product page, but customers often type
  // discovery queries like "any yellow dresses for Mother's Day under $60".
  // Without this branch, parseCustomerOffer mistakes "$60" for a counter-
  // offer on the current product and the bot hallucinates other items.
  // We pre-filter the merchant's catalog (live /products.json, cached 1h)
  // and feed deterministic results to the LLM. The negotiation step is NOT
  // advanced — this turn is a side conversation about the catalog.
  if (detectDiscoveryIntent(customerMessage)) {
    const merchantRow = { id: merchantId, source_url: null, shopify_domain: shopifyDomain };
    let matches = [];
    try {
      matches = await searchProducts(merchantRow, customerMessage, { limit: 5 });
    } catch (e) {
      console.warn('[negotiation] productSearch failed:', e.message);
    }

    const lastBotMessages = messages.filter(m => m.role === 'assistant').slice(-2).map(m => m.content);
    const discoveryPrompt = require('./llm').buildDiscoveryPrompt({
      tone: merchantSettings.tone,
      productName: negotiation.product_name,
      currentPrice: botLastPrice,
      query: customerMessage,
      matches,
      shopifyDomain,
      lastBotMessages,
      ownerInstructions,
    });

    const { reply } = await callLLM({
      systemPrompt: discoveryPrompt,
      messages,
      customerMessage,
      negotiationId: negotiation.id,
      merchantId,
      nextPrice: botLastPrice,        // not used for substitution — discovery prompt has no price requirement
      brandStatement: null,
      isOpening: false,
      tone: merchantSettings.tone,
      isDiscovery: true,
    });

    const updatedMessages = [
      ...messages,
      { role: 'user', content: customerMessage },
      { role: 'assistant', content: reply, was_discovery: true },
    ];

    await supabase.from('negotiations').update({
      messages: updatedMessages,
      updated_at: new Date().toISOString(),
    }).eq('id', negotiation.id);

    return {
      negotiationId: negotiation.id,
      reply,
      status: 'active',
      dealPrice: null,
      checkoutUrl: null,
      discountCode: null,
      brokerFee: null,
      expiresAt: null,
    };
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
      negotiation: { ...negotiation, messages: updatedMessages, customer_email: freshEmail, session_token: sessionToken || sessionId },
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
  // Never offer below customer's stated willingness — they've signaled this much.
  // Floor still wins if customer is below floor (handled by lowball branch above).
  if (customerOffer !== null && customerOffer >= Math.ceil(floorPrice) && nextPrice < customerOffer) {
    nextPrice = Math.round(customerOffer);
  }
  const isFinalOffer = nextStep === 5;

  // ── NEAR-MISS: if customer named a price and bot's next step lands within $5
  // of it, close the deal at the customer's price rather than look petty ────────
  if (customerOffer !== null && customerOffer >= Math.ceil(floorPrice) && Math.abs(nextPrice - customerOffer) <= 5) {
    const dealPrice = Math.max(Math.round(customerOffer), Math.ceil(floorPrice));
    const updatedMessages = [...messages, { role: 'user', content: customerMessage }];
    const freshEmail = contactUpdates.customer_email || negotiation.customer_email;
    const result = await strikeDeal({
      negotiation: { ...negotiation, messages: updatedMessages, customer_email: freshEmail, session_token: sessionToken || sessionId },
      dealPrice, merchantSettings, shopifyDomain, shopifyAccessToken, messages: updatedMessages, merchantId, productImage
    });
    return { negotiationId: negotiation.id, ...result };
  }

  // ── PARALLEL: insights extraction + LLM call ───────────────────────────────
  // The bot NEVER closes first. We removed automatic human-escalation:
  // previously after step 5 + 5 bot replies the negotiation flipped to
  // 'human_escalated' and the bot effectively walked away. The customer
  // should always be the one who decides to leave. At the floor we hold
  // the line warmly with varied phrasing — see FLOOR_HOLD_DIRECTION in
  // llm.js. The floor guards in PricingEngine + strikeDeal make sure no
  // offer ever closes below floor.
  const lastBotMessages = messages.filter(m => m.role === 'assistant').slice(-2).map(m => m.content);
  const latestInsight = customerInsights.slice(-1)[0]?.insight || null;
  const brandStatement = pickBrandStatement(brandStatements, nextStep, usedStatements);

  const systemPrompt = buildSystemPrompt({
    tone: merchantSettings.tone, productName: negotiation.product_name,
    nextPrice, brandStatement,
    customerInsight: latestInsight,
    stepIndex: nextStep, isOpening: false, isLowball, isFinalOffer, lastBotMessages,
    needsLeadCapture, needsNameCapture,
    productContext: productContext || null,
    ownerInstructions,
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

  const nowIso = new Date().toISOString();
  const updatedMessages = [
    ...messages,
    { role: 'user', content: customerMessage },
    { role: 'assistant', content: reply, brand_statement: brandStatement, asked_contact: needsLeadCapture || undefined, asked_name: needsNameCapture || undefined, was_lowball: isLowball || undefined }
  ];

  // ── STEP 4: PERSIST ─────────────────────────────────────────────────────────
  // Status stays 'active' — the bot never closes first. The cron sweep
  // (escalate-stale-floors) is what flips status to 'human_escalated' when
  // a customer reaches floor and goes idle 5–10min without accepting.
  // The bot's voice never changes; only the merchant-facing flag does.
  const status = 'active';

  // ── LEAD TIER — surfaces this row to /dashboard/leads if non-null ──────────
  // Hot:  reached floor + has contact (customer is qualified, deal stalled)
  // Warm: 3+ exchanges + has contact (engaged, didn't reach floor)
  // Cold: has contact but minimal engagement (or pre-negotiation capture)
  const customerMsgCount = updatedMessages.filter(m => m.role === 'user').length;
  const hasContactNow = !!(negotiation.customer_email || negotiation.customer_whatsapp || contactUpdates.customer_email || contactUpdates.customer_whatsapp);
  let leadTier = null;
  if (hasContactNow) {
    if (isFinalOffer) leadTier = 'hot';
    else if (customerMsgCount >= 3) leadTier = 'warm';
    else leadTier = 'cold';
  }

  await supabase.from('negotiations').update({
    messages: updatedMessages,
    current_step: nextStep,
    lowball_hold_messages: lowballHold,
    bot_last_offered_price: nextPrice,
    customer_insights: updatedInsights,
    status,
    lead_tier: leadTier,
    last_customer_message_at: nowIso,
    last_bot_message_at: nowIso,
    updated_at: nowIso
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
