const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../lib/supabase');
const { trackLLMCall } = require('../lib/posthog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Voice per tone — specific vocabulary and energy, not just a descriptor
const TONE_VOICE = {
  friendly:     'Warm, genuine, like a friend who works at the boutique. Contractions, short sentences, one emoji if it fits.',
  sassy:        'Witty and confident. A little cheeky. Short, punchy. Playful — not rude. Keeps it fun.',
  desi:         'Like a warm shopkeeper from an Indian bazaar. Use "yaar", "bhai", "acha listen", "chal" naturally. Makes them feel like family.',
  professional: 'Polished and clear. No slang. Respectful, direct. Suits luxury or business buyers.',
  urgent:       'Friendly with a light sense of time pressure. Mentions limited stock or timing — once, naturally.',
  generous:     'You genuinely want them to have it. Deal-focused, warm, rooting for them.',
};

// Floor-hold direction — used when the bot has reached its best price.
// The bot NEVER closes first. It holds the line warmly, repeats the
// floor price with fresh phrasing, and leaves the door wide open for
// the customer to accept. Never reveal any limit or hand off — the
// customer is the only one who can end the conversation.
const FLOOR_HOLD_DIRECTION = `You're at your best price. Hold the line warmly — repeat the price with fresh phrasing each turn, never the same opener twice. Don't say "last offer", "can't go lower", "final price" or hand off to anyone. Pair the price with a real reason this is a great deal — craftsmanship, materials, the moment, something specific. Stay open and inviting; the customer can take it whenever they're ready. One short sentence.`;

// Per-step concrete instruction — what the bot is doing emotionally at each step
// These change what the LLM writes, not just how it starts
const STEP_DIRECTION = [
  // Step 1 (opening)
  `You already moved the price for them before they even asked. They should feel like you're on their side. Warm invitation — make them feel lucky they showed up. Then ask naturally for their phone or email in case you get disconnected — weave it in at the end, like: "What's your WhatsApp in case we lose each other?" or "Drop me your email so I can hold this for you?" Phrase it your way — natural, never pushy.`,

  // Step 2
  `They pushed back. You heard them and you moved. Show you fought for this — "I had to really push for that" energy. Brief and real. Do NOT ask for contact again if already asked.`,

  // Step 3
  `Still moving but the steps are getting smaller. Let them feel the effort slowing down. One honest sentence about how tight it's getting. Brief.`,

  // Step 4
  `You're close to your edge. Genuine, light pressure — not dramatic. Make it feel real without revealing any limit. One sentence.`,

  // Step 5
  `Near final. Pair your price with a specific product reason (craftsmanship, shipping, materials). Almost there energy — make them feel the deal is within reach.`,

  // Step 6 (floor) — handled by FLOOR_HOLD_DIRECTION when isFinalOffer=true
  FLOOR_HOLD_DIRECTION,
];

const LOWBALL_DIRECTION = `Their offer was way off. Hold your position warmly — do not drop your price, do not lecture them. Acknowledge it briefly with lightness or humour, then nudge them toward something closer to your price without being pushy. One sentence.`;

// Phrase pool per step — force variety in openings.
// Step 5 (floor) phrases never imply "this is the end" — bot holds warmly
// and lets the customer choose to accept whenever they're ready.
const OPENERS = [
  ['Okay, so —', 'Here\'s the thing —', 'So listen —', 'Alright —', 'Between us —'],
  ['I hear you —', 'Fair enough —', 'Okay so', 'Alright,', 'Right, so —'],
  ['Getting real here —', 'Honestly,', 'Look,', 'Not gonna lie,', 'I\'ll be straight —'],
  ['Pushing hard for you:', 'Real talk —', 'Almost there —', 'You\'re testing me here —', 'Okay last push:'],
  ['This one took some doing:', 'Nearly there —', 'I went back and forth on this:', 'Okay, last real move:', 'Here\'s what I can do:'],
  ['Honestly, this is the spot —', 'Genuinely a great price here —', 'Real talk:', 'Between us:', 'Look — at this point:'],
];

function pickOpener(stepIndex, lastBotMessages) {
  const pool = OPENERS[Math.min(stepIndex, 5)];
  const usedFirst = (lastBotMessages || []).map(m => m.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''));
  const available = pool.filter(p => !usedFirst.includes(p.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')));
  const choices = available.length ? available : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function buildSystemPrompt({ tone, productName, nextPrice, brandStatement, customerInsight, stepIndex, isOpening, isLowball, isFinalOffer, isEscalating, lastBotMessages, needsLeadCapture, needsNameCapture, productContext }) {
  const voice = TONE_VOICE[tone] || TONE_VOICE.friendly;
  const priceStr = `$${nextPrice}`;
  // isEscalating kept as backwards-compat alias for old callers (marketplace
  // routes still pass it). Both flags now route to FLOOR_HOLD_DIRECTION —
  // the bot never hands off, never closes first.
  const atFloor = !!(isFinalOffer || isEscalating);
  const direction = isLowball ? LOWBALL_DIRECTION : atFloor ? FLOOR_HOLD_DIRECTION : STEP_DIRECTION[Math.min(stepIndex, 5)];
  const opener = isOpening ? null : pickOpener(stepIndex, lastBotMessages);

  const prevMessages = (lastBotMessages || []).slice(-2);

  let productDetails = '';
  if (productContext) {
    const parts = [];
    if (productContext.vendor) parts.push(`Vendor: ${productContext.vendor}`);
    if (productContext.product_type) parts.push(`Type: ${productContext.product_type}`);
    if (productContext.tags && productContext.tags.length) parts.push(`Tags: ${productContext.tags.slice(0, 8).join(', ')}`);
    if (productContext.description) parts.push(`About: ${productContext.description}`);
    if (parts.length) {
      productDetails = `\nProduct details — weave in naturally to justify the price, don't list or quote verbatim:\n${parts.map(p => `- ${p}`).join('\n')}`;
    }
  }

  return `You are a sales assistant for a boutique selling "${productName}".
Voice: ${voice}
${productDetails}
YOUR PRICE THIS MESSAGE: ${priceStr}
You MUST include "${priceStr}" in your reply. Do not write any other price.

Brand reason to use naturally (do not quote verbatim): "${brandStatement || 'real quality and craftsmanship'}"
${customerInsight ? `Customer mentioned: "${customerInsight}" — acknowledge this warmly if natural.` : ''}
${needsLeadCapture && !isLowball ? `Weave in a natural ONE-CHANNEL ask at the end — email by default, like "Drop me your email so I can hold this for you?". Pick ONE channel only (email OR phone, not both). Phrase it your way, keep it light.` : ''}
${needsNameCapture && !isLowball ? `You already have their contact. Now ask their NAME naturally at the end — like "What should I call you?" or "Who am I helping today?". One quick line, never a follow-up form.` : ''}
${opener ? `Start your reply with: "${opener}" — then continue naturally in your own voice.` : ''}
${prevMessages.length ? `\nYour previous messages — do NOT repeat their structure, phrasing, or opening:\n${prevMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}` : ''}

What you are doing this message: ${direction}

RULES — every one is hard:
- 2 sentences MAX. One is often better. This is chat, not email.
- MUST contain "${priceStr}" — never write a different number.
- You are an AI salesperson. EVERY reply must move the customer toward purchase. Never small-talk. Never share opinions outside the catalog. If the customer asks something unrelated, redirect once: "I'm here to help you find something — what are you looking for?".
- NEVER say: "I appreciate", "Certainly", "Absolutely", "Of course", "I understand your concern", "Great question", "Happy to help"
- NEVER say: "that's my minimum", "I can't go lower", "that's my floor", "my hands are tied", "that's the lowest I can go", "I'm at my limit" — these reveal your constraints. Just move on naturally.
- No bullet points. No formal language. Sound like a real human texting.
- One emoji max. Zero is fine.`.trim();
}

function validateAndFixPrice(text, nextPrice) {
  const exact = `$${nextPrice}`;
  if (text.includes(exact)) return text;
  // LLM wrote a different price — replace the first dollar amount inline
  return text.replace(/\$[\d,]+(?:\.[\d]{1,2})?/, exact);
}

function fallbackReply(nextPrice, brandStatement, isOpening, tone) {
  const price = `$${nextPrice}`;
  if (isOpening) {
    if (tone === 'desi') return `Yaar, I can already do ${price} for you — ${brandStatement || 'this is quality stuff'}. What do you think? 😊`;
    if (tone === 'sassy') return `Okay so I already moved — ${price} is yours if you want it. What's your call?`;
    return `Hey! I can already offer ${price} on this — ${brandStatement || 'it\'s worth every bit'}. What do you think? 😊`;
  }
  return `I can do ${price} — ${brandStatement || 'real quality here'}. What do you say?`;
}

async function logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt, response }) {
  try {
    await supabase.from('llm_traces').insert({
      negotiation_id: negotiationId, merchant_id: merchantId,
      provider, model, input_tokens: inputTokens, output_tokens: outputTokens,
      latency_ms: latencyMs, cost_usd: costUsd, prompt, response
    });
    await trackLLMCall({ merchantId, negotiationId, provider, model, inputTokens, outputTokens, latencyMs, costUsd });
  } catch {}
}

function estimateCost(provider, i, o) {
  if (provider === 'groq') return (i * 0.00000059) + (o * 0.00000079);
  return (i * 0.000000075) + (o * 0.0000003);
}

// Builds a discovery system prompt — used when the customer asks about
// the catalog rather than negotiating the current product. The bot
// becomes a helpful concierge for one turn: it can mention specific
// matched products by name + price + handle, and gently bring the
// conversation back to the current item.
function buildDiscoveryPrompt({ tone, productName, currentPrice, query, matches, shopifyDomain, lastBotMessages }) {
  const voice = TONE_VOICE[tone] || TONE_VOICE.friendly;
  const origin = shopifyDomain ? `https://${shopifyDomain}` : '';
  const matchLines = (matches || []).map(m => {
    const url = origin && m.handle ? `${origin}/products/${m.handle}` : '';
    const tagBits = (m.tags || []).slice(0, 3).join(', ');
    return `- ${m.title} — $${m.price}${tagBits ? ` (${tagBits})` : ''}${url ? ` ${url}` : ''}`;
  }).join('\n');

  const prevMessages = (lastBotMessages || []).slice(-2);
  const noMatches = !matches || matches.length === 0;

  return `You are a sales assistant for a boutique. The customer is currently looking at "${productName}" (your current offer: $${currentPrice}), but they just asked a discovery question about the wider catalog.
Voice: ${voice}

Customer's question: "${query}"

${noMatches
  ? `No matching products were found in the catalog. Be honest — say you don't see anything matching their description right now, and offer to keep them in mind. Then warmly bring it back to "${productName}" at $${currentPrice}.`
  : `Catalog matches you may reference (these are the ONLY products you may mention by name — do not invent any others):\n${matchLines}\n\nMention 1–3 of these by name with their prices. Be specific and useful — short list, not a sales pitch. After listing them, offer to keep talking about "${productName}" or send them to one of the matches if it's a better fit.`}
${prevMessages.length ? `\nYour previous messages — do NOT repeat their structure or opening:\n${prevMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}` : ''}

RULES — every one is hard:
- 3 sentences MAX. Brief and useful.
- You are an AI salesperson. EVERY reply must move the customer toward purchase. Never small-talk. Never share opinions outside the catalog. If asked something unrelated, redirect once: "I'm here to help you find something — what are you looking for?".
- ONLY reference products from the catalog list above. NEVER invent products, prices, or descriptions.
- NEVER make up a price. If you mention a product, use the exact price from the list.
- NEVER say: "I appreciate", "Certainly", "Absolutely", "Of course", "Great question", "Happy to help"
- No bullet points. No formal language. Sound like a real human texting.
- One emoji max. Zero is fine.`.trim();
}

async function callLLM({ systemPrompt, messages, customerMessage, negotiationId, merchantId, nextPrice, brandStatement, isOpening, tone, isDiscovery }) {
  const userMessage = isOpening
    ? '[Customer just opened the chat. Make your warm opening offer now.]'
    : customerMessage;

  const providers = ['groq', 'gemini'];

  for (const provider of providers) {
    try {
      const startTime = Date.now();
      let rawReply, inputTokens = 0, outputTokens = 0, model;

      // Strip DB-only metadata fields — LLM APIs only accept role + content
      const cleanMessages = (isOpening ? [] : messages).map(m => ({ role: m.role, content: m.content }));

      if (provider === 'groq') {
        model = 'llama-3.3-70b-versatile';
        const response = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...cleanMessages,
            { role: 'user', content: userMessage }
          ],
          max_tokens: 120,
          temperature: 0.9,
        });
        rawReply = response.choices[0].message.content;
        inputTokens = response.usage?.prompt_tokens || 0;
        outputTokens = response.usage?.completion_tokens || 0;
      }

      if (provider === 'gemini') {
        model = 'gemini-2.0-flash';
        const geminiModel = gemini.getGenerativeModel({ model });
        const history = cleanMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
        const chat = geminiModel.startChat({ history });
        const result = await chat.sendMessage(`${systemPrompt}\n\n${userMessage}`);
        rawReply = result.response.text();
        inputTokens = result.response.usageMetadata?.promptTokenCount || 0;
        outputTokens = result.response.usageMetadata?.candidatesTokenCount || 0;
      }

      const latencyMs = Date.now() - startTime;
      // Discovery turns mention catalog prices — don't rewrite them to nextPrice.
      const reply = isDiscovery ? rawReply.trim() : validateAndFixPrice(rawReply.trim(), nextPrice);
      await logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd: estimateCost(provider, inputTokens, outputTokens), prompt: systemPrompt, response: rawReply });

      return { reply, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  return { reply: fallbackReply(nextPrice, brandStatement, isOpening, tone), provider: 'fallback', latencyMs: 0 };
}

module.exports = { callLLM, buildSystemPrompt, buildDiscoveryPrompt };
