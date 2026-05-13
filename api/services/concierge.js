// Willow — the cross-page concierge.
//
// One persistent chat thread per (merchant, session). Willow:
//   - Greets with a deterministic scripted opener (we never let the LLM
//     fumble the first impression).
//   - Asks for ONE contact channel (email or phone, whichever the
//     customer offers) and reveals the best-deal price after capture.
//   - Travels with the customer across pages, acknowledging context
//     naturally ("saw you peeked at the sale").
//   - Hands off to the negotiation engine when the customer wants to
//     haggle on a specific product (separate negotiations row).
//   - Speaks proactively at most 4 times per session, gated by the
//     widget's trigger list (greet, page-change, idle, cart-entry).
//
// Catalog awareness reuses storeContext.getProducts() — same cached
// /products.json layer the negotiation engine uses, no duplication.

const supabase = require('../lib/supabase');
const storeContext = require('./storeContext');
const { searchProducts, detectDiscoveryIntent } = require('./productSearch');
const { callLLM } = require('./llm');
const { getActiveDirectives } = require('./botInstructions');

// Maximum messages we keep in the prompt — the full thread is stored
// in the DB but we only feed the last 12 turns to the LLM to keep
// cost low. Earlier context is summarized via the "session memory"
// fields stored on the thread row.
const PROMPT_HISTORY_LIMIT = 12;

const TONE_VOICE = {
  friendly:     'Warm, genuine, like a friend at the boutique. Short sentences, contractions, occasional emoji.',
  sassy:        'Witty, confident, a touch cheeky. Playful — never rude.',
  desi:         'Warm shopkeeper energy — "yaar", "acha listen", "chal" used naturally. Family vibes.',
  professional: 'Polished and clear. No slang. Respectful, direct.',
  urgent:       'Friendly with a light sense of timing. Once-mention scarcity, never twice.',
  generous:     'Genuinely rooting for them. Deal-focused, warm.',
};

// ── Best-seller / featured-deal picker ───────────────────────────────────────
// "On deal" = product where compare_at_price > price. We pick the one with
// the deepest discount as Willow's opener hook. Returns null if no products
// have a compare_at_price set yet — caller falls back to a generic line.
async function pickFeaturedDeal(merchant) {
  const products = await storeContext.getProducts(merchant);
  if (!products || !products.length) return null;

  let best = null;
  let bestSpread = 0;
  for (const p of products) {
    const variants = p.variants || [];
    for (const v of variants) {
      const price = parseFloat(v.price);
      const compareAt = parseFloat(v.compare_at_price);
      if (!Number.isFinite(price) || !Number.isFinite(compareAt) || compareAt <= price) continue;
      const spread = compareAt - price;
      if (spread > bestSpread) {
        bestSpread = spread;
        best = {
          title: p.title,
          handle: p.handle,
          price,
          compare_at_price: compareAt,
          discount_pct: Math.round(((compareAt - price) / compareAt) * 100),
          vendor: p.vendor || null,
          tags: (p.tags || []).slice(0, 5),
        };
      }
    }
  }
  return best;
}

// ── Scripted Willow opener ───────────────────────────────────────────────────
// We script the very first message so the value-hook is bulletproof.
// NO contact ask in the opener — capture happens later at a buying-intent
// moment (price reveal, deal interest), per JTBD. Lead with value + a
// shopper question, not a gate.
function buildOpener({ botName, featuredDeal }) {
  const name = botName || 'Willow';
  if (featuredDeal && featuredDeal.discount_pct) {
    return `Hey, I'm ${name} 👋 We've got some great picks on sale — including the **${featuredDeal.title}** at ${featuredDeal.discount_pct}% off. Want a few options, or are you looking for something specific?`;
  }
  return `Hey, I'm ${name} 👋 What can I help you find — something specific, or want to see what's good today?`;
}

// ── Willow system prompt — used after the opener ─────────────────────────────
function buildWillowPrompt({ tone, botName, thread, productContext, featuredDeal, pageContext, matches, ownerInstructions, customerMessage }) {
  const voice = TONE_VOICE[tone] || TONE_VOICE.friendly;
  const name = botName || 'Willow';
  const haveContact = !!(thread.customer_email || thread.customer_whatsapp);
  const haveName = !!thread.customer_name;

  // Capture timing: only ask for contact at a buying-intent moment, never
  // during discovery. Per JTBD the email gate fires at the price-reveal /
  // deal-interest moment, not on every untargeted turn.
  const lastUser = (customerMessage || '').toLowerCase();
  const highIntent = /\b(price|cost|how much|deal|discount|offer|buy|order|deliver|ship|negotiate|haggle|checkout)\b/i.test(lastUser);

  let job;
  if (!haveContact) {
    if (highIntent && (matches?.length || productContext)) {
      job = `Customer just signaled buying intent on a product. THIS is the moment for the email gate — end your reply with one warm soft-ask: "drop your email and I'll send the private offer 💌". Never both email and phone. One ask, then stop.`;
    } else {
      job = `You don't have contact yet, and that's fine. DO NOT ask for email or phone this turn. Focus on helping them browse/decide. Capture comes later when they're closer to buying. NEVER ask for contact in the same message that surfaces products.`;
    }
  } else if (!haveName) {
    job = `You have their contact. Focus on helping. Only ask their name if you're already in a friendly back-and-forth — never as the lead of a reply.`;
  } else {
    job = `You have their contact and name. Just be useful.`;
  }

  const contextLines = [];
  if (pageContext?.page_type) contextLines.push(`Customer is currently on a ${pageContext.page_type} page${pageContext.product_name ? `: "${pageContext.product_name}"` : pageContext.collection_title ? `: "${pageContext.collection_title}"` : ''}.`);
  if (thread.last_page_type && thread.last_page_type !== pageContext?.page_type) contextLines.push(`Earlier they were on ${thread.last_page_type}.`);
  if (featuredDeal) contextLines.push(`Today's headline deal: "${featuredDeal.title}" at $${featuredDeal.price} (was $${featuredDeal.compare_at_price}).`);

  let matchLines = '';
  if (matches?.length) {
    matchLines = '\nMatching catalog products you may name (NEVER invent others):\n' +
      matches.map(m => `- ${m.title} — $${m.price}${m.handle ? ` (/products/${m.handle})` : ''}`).join('\n');
  }

  let productLine = '';
  if (productContext?.product_name) {
    productLine = `\nThe customer is looking at "${productContext.product_name}" (list $${productContext.list_price}). If they want to negotiate it, say so warmly and tell them you'll take them through it.`;
  }

  let ownerLine = '';
  if (ownerInstructions) {
    const phrases = ownerInstructions.context_phrases || [];
    const claims = ownerInstructions.claims || [];
    if (phrases.length || claims.length) {
      const lines = [];
      if (phrases.length) lines.push(`Context to mention naturally if relevant: ${phrases.slice(0, 3).join(' · ')}`);
      if (claims.length) lines.push(`Promotional claims you may use: ${claims.slice(0, 3).join(' · ')}`);
      ownerLine = `\n\nOWNER INSTRUCTIONS (highest priority):\n${lines.map(l => '- ' + l).join('\n')}`;
    }
  }

  return `You are ${name}, a friendly storefront concierge for a boutique. You travel with the customer across pages and help them find, decide, and negotiate.
Voice: ${voice}${ownerLine}

${contextLines.length ? 'Context:\n' + contextLines.map(l => `- ${l}`).join('\n') : ''}
${matchLines}
${productLine}

Your job this turn: ${job}

RULES — every one is hard:
- 2 sentences MAX. One is often better. Chat, not email.
- ONLY name products from the catalog list above. Never invent product names or prices.
- Follow the JOB above for contact-capture timing. NEVER ask for contact in the same message that surfaces products. If you do ask, it's ONE channel (email OR phone), never both.
- Do NOT reference holidays, dates, seasons, or events unless they appear in OWNER INSTRUCTIONS.
- NEVER say: "I appreciate", "Certainly", "Absolutely", "Of course", "Great question", "Happy to help".
- No bullet points. Sound like a real human texting.
- One emoji max. Zero is fine.`.trim();
}

// ── Thread access ────────────────────────────────────────────────────────────
async function getOrCreateThread({ merchantId, sessionId }) {
  const { data: existing } = await supabase
    .from('concierge_threads')
    .select('*')
    .eq('merchant_id', merchantId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('concierge_threads')
    .insert({ merchant_id: merchantId, session_id: sessionId, messages: [] })
    .select('*')
    .single();
  if (error) throw new Error('failed to create concierge_thread: ' + error.message);
  return created;
}

// Detect contact / name in customer message and persist incrementally.
function detectIncomingContact(message, thread) {
  const updates = {};
  if (!message) return updates;
  const phoneMatch = message.match(/(?:\+?[\d\s\-().]{7,20})/);
  const emailMatch = message.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const nameMatch  = message.match(/(?:i['’]m|my name is|this is|call me)\s+([A-Z][a-zA-Z]{1,30})/i);

  if (phoneMatch && !thread.customer_whatsapp) {
    const cleaned = phoneMatch[0].replace(/[\s\-().]/g, '');
    if (cleaned.length >= 7) updates.customer_whatsapp = cleaned;
  }
  if (emailMatch && !thread.customer_email) {
    updates.customer_email = emailMatch[0].toLowerCase();
  }
  if (nameMatch && !thread.customer_name) {
    updates.customer_name = nameMatch[1];
  }
  return updates;
}

// Upgrades the thread's lead_tier when contact lands.
function recomputeLeadTier(thread, contactUpdates) {
  const haveContact = !!(thread.customer_email || thread.customer_whatsapp || contactUpdates.customer_email || contactUpdates.customer_whatsapp);
  if (!haveContact) return null;
  const customerMsgs = (thread.messages || []).filter(m => m.role === 'user').length;
  if (customerMsgs >= 3) return 'warm';
  return 'cold';
}

// ── Main entry: send a message, get a reply ──────────────────────────────────
// trigger:
//   'user'           — customer typed a message
//   'greet'          — first chat open this session (returns scripted opener)
//   'page_change'    — customer navigated; bot may proactively comment
//   'idle'           — 90s with no engagement on a single page
//   'cart_entry'     — landed on /cart
async function handleConciergeTurn({ merchantId, sessionId, customerMessage, trigger, pageContext, merchantSettings, shopifyDomain, merchant }) {
  const thread = await getOrCreateThread({ merchantId, sessionId });
  const messages = thread.messages || [];
  const nowIso = new Date().toISOString();

  // ── Greeting (scripted) — fires the very first time the chat is opened.
  if (trigger === 'greet' && messages.length === 0) {
    const featuredDeal = await pickFeaturedDeal(merchant).catch(() => null);
    const opener = buildOpener({
      botName: merchantSettings?.bot_name,
      featuredDeal,
      shopifyDomain,
    });
    const updatedMessages = [{ role: 'assistant', content: opener, scripted: true, trigger: 'greet' }];
    await supabase.from('concierge_threads').update({
      messages: updatedMessages,
      pages_visited: 1,
      last_page_type: pageContext?.page_type || null,
      last_product_url: pageContext?.product_url || null,
      updated_at: nowIso,
    }).eq('id', thread.id);
    return { reply: opener, thread_id: thread.id, scripted: true, featured_deal: featuredDeal };
  }

  // Contact + name detection on every customer message
  const contactUpdates = customerMessage ? detectIncomingContact(customerMessage, thread) : {};

  // Discovery search if customer asked about catalog ("yellow dresses under $60")
  let matches = [];
  if (customerMessage && detectDiscoveryIntent(customerMessage)) {
    try {
      matches = await searchProducts(merchant, customerMessage, { limit: 5 });
    } catch (e) {
      console.warn('[concierge] productSearch failed:', e.message);
    }
  }

  // Featured deal + product context for the prompt
  const featuredDeal = await pickFeaturedDeal(merchant).catch(() => null);
  const productContext = pageContext?.product_name && pageContext?.list_price
    ? { product_name: pageContext.product_name, list_price: pageContext.list_price }
    : null;

  // ── Proactive triggers ────────────────────────────────────────────────────
  // Hard caps so Willow never feels pushy:
  //   - max 4 proactive messages per session
  //   - never within 30s of customer's own message
  //   - never within 60s of last proactive message
  const proactiveAllowed = (() => {
    if (trigger === 'user' || trigger === 'greet') return true;
    if ((thread.proactive_count || 0) >= 4) return false;
    const lastBotAt = thread.last_proactive_at ? new Date(thread.last_proactive_at).getTime() : 0;
    if (Date.now() - lastBotAt < 60_000) return false;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser?.created_at && Date.now() - new Date(lastUser.created_at).getTime() < 30_000) return false;
    return true;
  })();
  if (!proactiveAllowed) {
    return { reply: null, thread_id: thread.id, suppressed: true };
  }

  // Build the user-facing turn input. For proactive triggers we synthesize
  // a brief instruction the LLM responds to; for user messages we pass
  // theirs through.
  let userMessageForLLM = customerMessage;
  if (trigger === 'page_change' && pageContext) {
    userMessageForLLM = `[Customer just navigated to a ${pageContext.page_type} page${pageContext.product_name ? `: "${pageContext.product_name}"` : ''}. Drop ONE short, warm line acknowledging the context. Don't ask a question — just be present.]`;
  } else if (trigger === 'idle' && pageContext) {
    userMessageForLLM = `[Customer has been on this ${pageContext.page_type} page for 90 seconds without engaging. Drop ONE short, gentle nudge — "still browsing? want me to find something specific?" energy. Never pushy.]`;
  } else if (trigger === 'cart_entry') {
    userMessageForLLM = `[Customer just landed on the cart page. Drop ONE warm line offering to negotiate the cart total down. Brief.]`;
  }

  // Owner instructions feed into the prompt as highest-priority context.
  // Failing to load them mustn't block a turn — fall back to empty.
  let ownerInstructions = { directives: [], context_phrases: [], claims: [] };
  try {
    ownerInstructions = await getActiveDirectives(supabase, merchantId);
  } catch (e) {
    console.warn('[concierge] getActiveDirectives failed:', e.message);
  }

  const systemPrompt = buildWillowPrompt({
    tone: merchantSettings?.tone || 'friendly',
    botName: merchantSettings?.bot_name,
    thread: { ...thread, ...contactUpdates },
    productContext,
    featuredDeal,
    pageContext,
    matches,
    ownerInstructions,
    customerMessage,
  });

  // Trim history sent to the LLM to keep cost down.
  const historyForLLM = messages.slice(-PROMPT_HISTORY_LIMIT).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const { reply } = await callLLM({
    systemPrompt,
    messages: historyForLLM,
    customerMessage: userMessageForLLM,
    negotiationId: null,
    merchantId,
    nextPrice: 0,
    brandStatement: null,
    isOpening: false,
    tone: merchantSettings?.tone || 'friendly',
    isDiscovery: true,   // skips price-substitution validator (no nextPrice in concierge)
  });

  // Append the turn to the thread
  const turn = [];
  if (customerMessage) turn.push({ role: 'user', content: customerMessage, created_at: nowIso });
  turn.push({
    role: 'assistant',
    content: reply,
    trigger: trigger !== 'user' ? trigger : undefined,
    created_at: nowIso,
  });

  const updatedMessages = [...messages, ...turn];
  const proactiveBumps = trigger !== 'user' && trigger !== 'greet' ? 1 : 0;

  const tier = recomputeLeadTier({ ...thread, messages: updatedMessages }, contactUpdates);

  const updates = {
    messages: updatedMessages,
    updated_at: nowIso,
    last_page_type: pageContext?.page_type ?? thread.last_page_type,
    last_product_url: pageContext?.product_url ?? thread.last_product_url,
    last_collection_url: pageContext?.collection_url ?? thread.last_collection_url,
    pages_visited: (thread.pages_visited || 0) + (trigger === 'page_change' ? 1 : 0),
    ...contactUpdates,
  };
  if (proactiveBumps) {
    updates.proactive_count = (thread.proactive_count || 0) + proactiveBumps;
    updates.last_proactive_at = nowIso;
  }
  if (tier && tier !== thread.lead_tier) {
    updates.lead_tier = tier;
  }

  await supabase.from('concierge_threads').update(updates).eq('id', thread.id);

  return {
    reply,
    thread_id: thread.id,
    contact_captured: !!(contactUpdates.customer_email || contactUpdates.customer_whatsapp),
    name_captured:    !!contactUpdates.customer_name,
    featured_deal: featuredDeal,
    matches,
  };
}

module.exports = {
  handleConciergeTurn,
  pickFeaturedDeal,
  getOrCreateThread,
  buildOpener,
};
