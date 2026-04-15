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

// Human escalation message — in the merchant's tone, never reveals floor
const ESCALATION_DIRECTION = `You've genuinely given everything you can. You're not going to reveal any limit or number. Instead, warmly hand off to your human team — frame it as them potentially having more flexibility than you, not as a dead end. Keep it warm, in character, and leave the door wide open. 2 sentences max.`;

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

  // Step 6 (floor)
  `This is genuinely your last offer. Warm, not dramatic. Suggest that your team might be able to help if they need more — frame it as passing them to someone with more flexibility, not as a dead end.`,
];

const LOWBALL_DIRECTION = `Their offer was way off. Hold your position warmly — do not drop your price, do not lecture them. Acknowledge it briefly with lightness or humour. One sentence.`;

// Phrase pool per step — force variety in openings
const OPENERS = [
  ['Okay, so —', 'Here\'s the thing —', 'So listen —', 'Alright —', 'Between us —'],
  ['I hear you —', 'Fair enough —', 'Okay so', 'Alright,', 'Right, so —'],
  ['Getting real here —', 'Honestly,', 'Look,', 'Not gonna lie,', 'I\'ll be straight —'],
  ['Pushing hard for you:', 'Real talk —', 'Almost there —', 'You\'re testing me here —', 'Okay last push:'],
  ['This one took some doing:', 'Nearly there —', 'I went back and forth on this:', 'Okay, last real move:', 'Here\'s what I can do:'],
  ['Genuinely, this is it.', 'My team would kill me but —', 'Last card:', 'Okay, final answer:', 'This is everything:'],
];

function pickOpener(stepIndex, lastBotMessages) {
  const pool = OPENERS[Math.min(stepIndex, 5)];
  const usedFirst = (lastBotMessages || []).map(m => m.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''));
  const available = pool.filter(p => !usedFirst.includes(p.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '')));
  const choices = available.length ? available : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function buildSystemPrompt({ tone, productName, nextPrice, brandStatement, customerInsight, stepIndex, isOpening, isLowball, isEscalating, lastBotMessages, needsLeadCapture }) {
  const voice = TONE_VOICE[tone] || TONE_VOICE.friendly;
  const priceStr = `$${nextPrice}`;
  const direction = isLowball ? LOWBALL_DIRECTION : isEscalating ? ESCALATION_DIRECTION : STEP_DIRECTION[Math.min(stepIndex, 5)];
  const opener = isOpening ? null : pickOpener(stepIndex, lastBotMessages);

  const prevMessages = (lastBotMessages || []).slice(-2);

  return `You are a sales assistant for a boutique selling "${productName}".
Voice: ${voice}

YOUR PRICE THIS MESSAGE: ${priceStr}
You MUST include "${priceStr}" in your reply. Do not write any other price.

Brand reason to use naturally (do not quote verbatim): "${brandStatement || 'real quality and craftsmanship'}"
${customerInsight ? `Customer mentioned: "${customerInsight}" — acknowledge this warmly if natural.` : ''}
${needsLeadCapture && !isLowball ? `Weave in a natural ask for their phone or email at the end — like "What's your WhatsApp in case we get disconnected?" or "Drop me your email so I can hold this for you?" — phrase it your own way, keep it light.` : ''}
${opener ? `Start your reply with: "${opener}" — then continue naturally in your own voice.` : ''}
${prevMessages.length ? `\nYour previous messages — do NOT repeat their structure, phrasing, or opening:\n${prevMessages.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}` : ''}

What you are doing this message: ${direction}

RULES — every one is hard:
- 2 sentences MAX. One is often better. This is chat, not email.
- MUST contain "${priceStr}" — never write a different number.
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

async function callLLM({ systemPrompt, messages, customerMessage, negotiationId, merchantId, nextPrice, brandStatement, isOpening, tone }) {
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
      const reply = validateAndFixPrice(rawReply.trim(), nextPrice);
      await logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd: estimateCost(provider, inputTokens, outputTokens), prompt: systemPrompt, response: rawReply });

      return { reply, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  return { reply: fallbackReply(nextPrice, brandStatement, isOpening, tone), provider: 'fallback', latencyMs: 0 };
}

module.exports = { callLLM, buildSystemPrompt };
