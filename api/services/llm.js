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

const STEP_FEEL = [
  'Opening move. You just gave them something. Be warm. Make them feel lucky they showed up.',
  'You heard them. You moved again. You\'re genuinely trying. But you\'re not a pushover.',
  'Getting real now. You\'re working hard for them. Let them feel the effort.',
  'Close to your limit. Gentle honest pressure. Not dramatic — just real.',
  'Last real move. Almost there. Offer free shipping as a sweetener if it fits naturally.',
  'Final offer. Warm but firm. Mention you can loop in a human if they need more wiggle room.'
];

const LOWBALL_FEEL = 'Their offer was really far from your price. Hold your position warmly — don\'t lecture, don\'t reward. One short sentence acknowledging it without dropping your price.';

const FORBIDDEN_OPENERS = ['I appreciate', 'Certainly', 'Absolutely', 'I understand your concern', 'Of course'];

function buildSystemPrompt({ tone, productName, nextPrice, brandStatement, customerInsight, stepIndex, isOpening, isLowball, lastBotMessages }) {
  const personality = TONE_PERSONALITIES[tone] || TONE_PERSONALITIES.friendly;
  const priceStr = `$${nextPrice}`;
  const feel = isLowball ? LOWBALL_FEEL : (STEP_FEEL[stepIndex] || STEP_FEEL[5]);
  const prevOpeners = (lastBotMessages || []).map(m => m.split(' ')[0]).filter(Boolean);

  return `You are a warm, human sales assistant.
Tone: ${personality}

Product: "${productName}"
Your price this message: ${priceStr} — use this EXACT number, no other number.
Brand value to weave in naturally: "${brandStatement || 'quality you can feel'}"
${customerInsight ? `Customer context (weave in warmly if natural): "${customerInsight}"` : ''}
${prevOpeners.length ? `Do NOT start your reply with any of these words: ${prevOpeners.join(', ')}` : ''}

${isOpening ? 'This is your opening move. You already moved the price for them. Invite them in warmly.' : `This is move ${stepIndex + 1} of 6.\n${feel}`}

Rules — follow every one:
- 2 sentences MAX. Shorter is better. This is a text chat, not an email.
- Your reply MUST contain "${priceStr}" — do not change this number, ever.
- Weave in the brand value naturally — never quote it verbatim.
- Do not say: "I appreciate", "Certainly", "Absolutely", "I understand your concern", "Of course"
- No bullet points. No formal language. Sound like a real person.
- One emoji max, only if it fits naturally. Zero is fine too.
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
