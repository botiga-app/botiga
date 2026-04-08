const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../lib/supabase');
const { trackLLMCall } = require('../lib/posthog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TONE_PERSONALITIES = {
  friendly: `You are a warm, enthusiastic shopping assistant. Genuine, encouraging, casual.`,
  sassy: `You are witty, playful, a little cheeky. Short punchy sentences.`,
  desi: `You are warm like a shopkeeper from an Indian bazaar. Use phrases like "yaar", "bhai", "acha listen".`,
  professional: `You are polished and formal. Respectful, efficient, no over-explaining.`,
  urgent: `You create subtle time pressure. Mention limited stock or expiring deals.`,
  generous: `You want to give customers a great deal. Friendly and deal-focused.`
};

const DEFAULT_STATEMENT = 'This price reflects genuine quality and craftsmanship';

/**
 * Build system prompt for atomic response generation.
 * The price is FIXED — LLM may not change it.
 */
function buildAtomicSystemPrompt({ tone, productName, nextBotPrice, brandValueStatement, customerInsights, messageCount, maxMessages, isHold, isAnchor }) {
  const personality = TONE_PERSONALITIES[tone] || TONE_PERSONALITIES.friendly;
  const isLastMessage = messageCount >= maxMessages - 1;
  const priceStr = `$${nextBotPrice.toFixed(2)}`;
  const statement = brandValueStatement || DEFAULT_STATEMENT;

  // Inject most recent customer insight if available
  const latestInsight = (customerInsights || []).slice(-1)[0]?.insight || null;

  return `${personality}

You are negotiating the sale of: "${productName}"

FIXED PRICE FOR THIS RESPONSE: ${priceStr}
You MUST use exactly ${priceStr} in your price_atom. Do not offer any other number.

BRAND VALUE STATEMENT TO USE: "${statement}"
This is your reason for the price. Do not invent a different reason.
${latestInsight ? `\nCUSTOMER CONTEXT: "${latestInsight}" — weave this naturally into your insight_atom.` : ''}
${isAnchor ? '\nThis is your opening anchor. Invite the customer to respond with their offer.' : ''}
${isHold ? '\nCustomer offered below your minimum. Hold your price warmly — do NOT reveal you have a minimum.' : ''}
${isLastMessage ? '\nFINAL MESSAGE: Add a personal urgency close. Make it feel genuine, not pushy.' : ''}

Return ONLY valid JSON — no prose before or after:
{
  "empathy_atom": "1 sentence acknowledging their message or offer warmly",
  "insight_atom": ${latestInsight ? '"1 sentence referencing customer context naturally"' : 'null'},
  "price_atom": "1 sentence that MUST contain the exact string \\"${priceStr}\\"",
  "reason_atom": "1 sentence using the brand value statement as your reason",
  "close_atom": ${isLastMessage ? '"1 sentence personal urgency close"' : 'null'}
}

HARD RULES:
- price_atom MUST contain "${priceStr}" verbatim — no other price
- Each atom: 1 short sentence, conversational, max 15 words
- Never reveal a minimum, floor, or constraint
- Never mention Botiga or AI`.trim();
}

/**
 * Assemble atom JSON into a single message string.
 */
function assembleAtoms(atoms) {
  return [
    atoms.empathy_atom,
    atoms.insight_atom,
    atoms.price_atom,
    atoms.reason_atom,
    atoms.close_atom
  ].filter(Boolean).join(' ').trim();
}

/**
 * Validate that the assembled message contains the exact price string.
 */
function validatePrice(text, nextBotPrice) {
  const exact = `$${nextBotPrice.toFixed(2)}`;
  const rounded = `$${Math.round(nextBotPrice)}`;
  return text.includes(exact) || text.includes(rounded);
}

/**
 * Fallback reply used when LLM fails or returns invalid JSON.
 */
function fallbackReply(nextBotPrice, brandValueStatement, isHold) {
  const priceStr = `$${nextBotPrice.toFixed(2)}`;
  const statement = brandValueStatement || DEFAULT_STATEMENT;
  if (isHold) {
    return `I appreciate the offer, but ${statement.toLowerCase()}. The best I can do right now is ${priceStr}.`;
  }
  return `I can offer you ${priceStr} — ${statement.toLowerCase()}. What do you say?`;
}

async function logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt, response }) {
  try {
    await supabase.from('llm_traces').insert({
      negotiation_id: negotiationId,
      merchant_id: merchantId,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      cost_usd: costUsd,
      prompt,
      response
    });
    await trackLLMCall({ merchantId, negotiationId, provider, model, inputTokens, outputTokens, latencyMs, costUsd });
  } catch {}
}

function estimateCost(provider, inputTokens, outputTokens) {
  if (provider === 'groq') return (inputTokens * 0.00000059) + (outputTokens * 0.00000079);
  return (inputTokens * 0.000000075) + (outputTokens * 0.0000003);
}

/**
 * Main LLM call with Gemini fallback.
 * Price is fixed — LLM only writes the words.
 * Returns: { reply, botOfferedPrice, provider, latencyMs }
 */
async function callLLMWithFallback({ systemPrompt, messages, customerMessage, negotiationId, merchantId, nextBotPrice, brandValueStatement, isHold }) {
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
            ...messages,
            { role: 'user', content: customerMessage }
          ],
          max_tokens: 250,
          temperature: 0.65,
          response_format: { type: 'json_object' }
        });
        rawReply = response.choices[0].message.content;
        inputTokens = response.usage?.prompt_tokens || 0;
        outputTokens = response.usage?.completion_tokens || 0;
      }

      if (provider === 'gemini') {
        model = 'gemini-2.0-flash';
        const geminiModel = gemini.getGenerativeModel({
          model,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const history = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
        const chat = geminiModel.startChat({ history });
        const result = await chat.sendMessage(`${systemPrompt}\n\n${customerMessage}`);
        rawReply = result.response.text();
        inputTokens = result.response.usageMetadata?.promptTokenCount || 0;
        outputTokens = result.response.usageMetadata?.candidatesTokenCount || 0;
      }

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCost(provider, inputTokens, outputTokens);

      // Parse atoms and assemble reply
      let reply;
      try {
        const atoms = JSON.parse(rawReply);
        const assembled = assembleAtoms(atoms);

        if (validatePrice(assembled, nextBotPrice)) {
          reply = assembled;
        } else {
          // Price got mangled — use fallback
          console.warn(`[LLM] Price validation failed. Expected $${nextBotPrice.toFixed(2)} in: ${assembled}`);
          reply = fallbackReply(nextBotPrice, brandValueStatement, isHold);
        }
      } catch {
        reply = fallbackReply(nextBotPrice, brandValueStatement, isHold);
      }

      await logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt: systemPrompt, response: rawReply });

      return { reply, botOfferedPrice: nextBotPrice, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  // Both providers failed — use template
  return {
    reply: fallbackReply(nextBotPrice, brandValueStatement, isHold),
    botOfferedPrice: nextBotPrice,
    provider: 'fallback',
    latencyMs: 0
  };
}

module.exports = { callLLMWithFallback, buildAtomicSystemPrompt };
