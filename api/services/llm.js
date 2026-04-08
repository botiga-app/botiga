const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../lib/supabase');
const { trackLLMCall } = require('../lib/posthog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TONE_PERSONALITIES = {
  friendly:     'Warm, genuine, like a friend who works there. Enthusiastic but not pushy.',
  sassy:        'Witty, playful, a little cheeky. Short punchy sentences. Fun to talk to.',
  desi:         'Warm like a bazaar shopkeeper. Use "yaar", "bhai", "acha". Makes customer feel like family.',
  professional: 'Polished, respectful, efficient. Luxury or B2B feel. No slang.',
  urgent:       'Friendly but creates subtle urgency. Mentions limited stock or expiring deal.',
  generous:     'Deal-focused, wants customer to win. Closing over margin.'
};

// Per-step feel AND a pool of starter phrases so no two messages sound alike
const STEP_FEEL = [
  'Opening. You made the first move — they should feel like you\'re already on their side.',
  'You heard them and you moved. Show genuine effort. Make it feel like you pushed for this.',
  'Slowing down now. Each dollar is harder. Let that show — briefly.',
  'Getting real. You\'re close to your limit. A single honest sentence of pressure.',
  'Last real move. Mention something specific — shipping, the item itself, timing.',
  'This is it. Warm, final, no room left. Offer to loop in your team if they need more.',
];

const LOWBALL_FEEL = 'Their offer was very far from your price. Hold warmly — one sentence, no lecture, no drop.';

// Rotate opening phrases — pick one that hasn't been used recently
const STARTER_POOLS = [
  ['Honestly,', 'Look,', 'Between us,', 'Real talk —', 'Here\'s the thing —'],
  ['Okay so', 'Alright,', 'So here\'s where I\'m at:', 'I hear you —', 'Fair enough —'],
  ['Let me be straight with you:', 'Pushing hard here:', 'I went back and forth on this:', 'Not gonna lie,', 'You\'re close —'],
  ['This one\'s tough for me,', 'I really want to make this work.', 'You\'re testing me here!', 'Almost there —', 'Okay, last push:'],
  ['We\'re nearly there.', 'I\'m genuinely at my limit here.', 'This is everything I\'ve got.', 'Last card —', 'I mean it this time:'],
  ['Honestly, this is it.', 'I can\'t move from here.', 'My hands are tied now.', 'You\'ve got my best.', 'That\'s all I have.'],
];

function pickStarter(stepIndex, lastBotMessages) {
  const pool = STARTER_POOLS[Math.min(stepIndex, 5)];
  const usedWords = (lastBotMessages || []).map(m => m.split(' ')[0].replace(/[^a-zA-Z]/g, '').toLowerCase());
  const available = pool.filter(s => !usedWords.includes(s.split(' ')[0].replace(/[^a-zA-Z]/g, '').toLowerCase()));
  const choices = available.length > 0 ? available : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function buildSystemPrompt({ tone, productName, nextPrice, brandStatement, customerInsight, stepIndex, isOpening, isLowball, lastBotMessages }) {
  const personality = TONE_PERSONALITIES[tone] || TONE_PERSONALITIES.friendly;
  const priceStr = `$${nextPrice}`;
  const feel = isLowball ? LOWBALL_FEEL : (STEP_FEEL[stepIndex] || STEP_FEEL[5]);
  const starter = isOpening ? null : pickStarter(stepIndex, lastBotMessages);

  // Show last 2 bot messages verbatim so LLM can actively avoid repeating them
  const prevMessages = (lastBotMessages || []).slice(-2);

  return `You are a warm, human sales assistant. Tone: ${personality}

Product: "${productName}"
FIXED PRICE THIS MESSAGE: ${priceStr} — include this EXACT number, do not change it.
Brand reason to weave in: "${brandStatement || 'real quality'}"
${customerInsight ? `Customer said something personal: "${customerInsight}" — acknowledge this warmly in one sentence if natural.` : ''}
${starter ? `START your reply with this phrase: "${starter}" — then continue naturally.` : 'Open with a warm invitation. Already gave them a price. Make them feel the deal is theirs to take.'}
${prevMessages.length ? `\nYour PREVIOUS messages (do NOT repeat these or use the same structure):\n${prevMessages.map((m, i) => `  [${i + 1}] ${m}`).join('\n')}` : ''}

Feel for this message: ${feel}

Hard rules:
- 2 sentences MAX. One is often better.
- MUST include "${priceStr}" — never write a different number.
- No "I appreciate", "Certainly", "Absolutely", "I understand your concern", "Of course", "Great question"
- No bullet points. No formal language. Real person, text message energy.
- One emoji max, only if it genuinely fits. Zero is fine.
- Never reveal you have a minimum or floor price.`.trim();
}

function validateAndFixPrice(text, nextPrice) {
  const exact = `$${nextPrice}`;
  if (text.includes(exact)) return text;
  // LLM changed the price — replace inline
  const pricePattern = /\$[\d,]+(?:\.[\d]{1,2})?/g;
  return text.replace(pricePattern, exact);
}

function fallbackReply(nextPrice, brandStatement, isOpening) {
  if (isOpening) {
    return `Hey! I can already offer you $${nextPrice} on this — ${brandStatement || 'it\'s genuinely worth it'}. What do you think? 😊`;
  }
  return `I can do $${nextPrice} — ${brandStatement || 'this is real quality'}. What do you say?`;
}

async function logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt, response }) {
  try {
    await supabase.from('llm_traces').insert({
      negotiation_id: negotiationId,
      merchant_id: merchantId,
      provider, model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      cost_usd: costUsd,
      prompt, response
    });
    await trackLLMCall({ merchantId, negotiationId, provider, model, inputTokens, outputTokens, latencyMs, costUsd });
  } catch {}
}

function estimateCost(provider, inputTokens, outputTokens) {
  if (provider === 'groq') return (inputTokens * 0.00000059) + (outputTokens * 0.00000079);
  return (inputTokens * 0.000000075) + (outputTokens * 0.0000003);
}

async function callLLM({ systemPrompt, messages, customerMessage, negotiationId, merchantId, nextPrice, brandStatement, isOpening }) {
  const userMessage = isOpening
    ? '[Customer just opened the chat. Make your warm opening offer.]'
    : customerMessage;

  const providers = ['groq', 'gemini'];

  for (const provider of providers) {
    try {
      const startTime = Date.now();
      let rawReply, inputTokens = 0, outputTokens = 0, model;

      if (provider === 'groq') {
        model = 'llama-3.3-70b-versatile';
        const response = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...(isOpening ? [] : messages),
            { role: 'user', content: userMessage }
          ],
          max_tokens: 120,
          temperature: 0.75
        });
        rawReply = response.choices[0].message.content;
        inputTokens = response.usage?.prompt_tokens || 0;
        outputTokens = response.usage?.completion_tokens || 0;
      }

      if (provider === 'gemini') {
        model = 'gemini-2.0-flash';
        const geminiModel = gemini.getGenerativeModel({ model });
        const history = (isOpening ? [] : messages).map(m => ({
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
      const costUsd = estimateCost(provider, inputTokens, outputTokens);

      // Validate price — fix inline if LLM changed it
      const reply = validateAndFixPrice(rawReply.trim(), nextPrice);

      await logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt: systemPrompt, response: rawReply });

      return { reply, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  return {
    reply: fallbackReply(nextPrice, brandStatement, isOpening),
    provider: 'fallback',
    latencyMs: 0
  };
}

module.exports = { callLLM, buildSystemPrompt };
