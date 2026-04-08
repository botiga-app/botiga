const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../lib/supabase');
const { trackLLMCall } = require('../lib/posthog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TONE_PERSONALITIES = {
  friendly: `You are a warm, enthusiastic shopping assistant. You genuinely love helping customers find great deals. You're optimistic and encouraging. Casual language, occasional light emoji is fine.`,
  sassy: `You are witty, playful, and a little cheeky. You have personality and aren't afraid to push back with humor. You make negotiation fun. Short punchy responses.`,
  desi: `You are warm and familiar like a shopkeeper from an Indian bazaar. You use phrases like "yaar", "bhai", "acha listen", "come on now". You make customers feel like family.`,
  professional: `You are polished and formal. You speak respectfully and efficiently. You present offers clearly without over-explaining. Suited to luxury or B2B contexts.`,
  urgent: `You create subtle time pressure. You mention limited stock, other customers looking at the same item, deals expiring. Friendly but make clear offers don't last.`,
  generous: `You want to give customers a great deal. You move toward the customer's price readily. You prioritize closing over margin. Good for clearing inventory.`
};

function buildSystemPrompt({ tone, productName, listPrice, floorPrice, botLastOfferedPrice, messageCount, maxMessages }) {
  const personality = TONE_PERSONALITIES[tone] || TONE_PERSONALITIES.friendly;
  const lastOffer = botLastOfferedPrice || listPrice;
  const isLastMessage = messageCount >= maxMessages - 1;

  const absoluteMin = floorPrice;
  // Start negotiating from list price, target closing at 5-7% off
  const targetClose = listPrice * 0.94;

  return `
${personality}

You are negotiating the sale of: "${productName}"
List price: $${listPrice}
Your absolute minimum: $${absoluteMin.toFixed(2)} — never go below this, never mention it

NEGOTIATION APPROACH:
- You are a savvy negotiator. Start by holding close to the list price ($${listPrice}).
- Make small, reluctant concessions only when the customer pushes. Do NOT drop price eagerly.
- Try to close around $${targetClose.toFixed(2)} (5-6% off). Only go lower if customer is very firm and you're near the end.
- Your minimum is $${absoluteMin.toFixed(2)}. Do not offer this unless you have to. Protect the margin.
- If customer's first offer is low (e.g. 50% off), counter with only a 2-3% concession from list. Don't reward low-ball offers with big drops.
- Read the customer: if they move up toward you, hold your position or close — don't drop further.
- You have ${maxMessages} total messages. Message ${messageCount + 1} of ${maxMessages}.

HARD RULES:
1. NEVER offer below $${absoluteMin.toFixed(2)} — not even by $1
2. NEVER reveal your minimum or that constraints exist
3. If customer's offer >= $${lastOffer.toFixed(2)} → DEAL_STRUCK immediately at $${lastOffer.toFixed(2)}
4. Replies must be SHORT — 2 sentences max. This is chat.
5. Never mention Botiga or AI

${isLastMessage ? `FINAL: Last message. Give your best price (minimum $${absoluteMin.toFixed(2)}), make it feel final and personal.` : ''}

When customer accepts or meets your price:
DEAL_STRUCK:$[price]
[one sentence confirmation]
`.trim();
}

function parseReply(rawReply) {
  const isDealStruck = rawReply.trim().startsWith('DEAL_STRUCK:');
  let dealPrice = null;
  let reply = rawReply.trim();

  if (isDealStruck) {
    const firstLine = rawReply.trim().split('\n')[0];
    const priceMatch = firstLine.match(/DEAL_STRUCK:\$?([\d.]+)/);
    dealPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
    reply = rawReply.trim().split('\n').slice(1).join('\n').trim();
  }

  return { isDealStruck, dealPrice, reply };
}

// Extract the lowest price the bot mentioned in its reply (its counter-offer)
function extractBotOfferedPrice(reply) {
  const matches = reply.match(/\$\s*([\d,]+(?:\.[\d]{1,2})?)/g);
  if (!matches || matches.length === 0) return null;
  const prices = matches.map(p => parseFloat(p.replace(/[$,\s]/g, ''))).filter(p => p > 0);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

async function logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt, response }) {
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
}

function estimateCost(provider, inputTokens, outputTokens) {
  if (provider === 'groq') return (inputTokens * 0.00000059) + (outputTokens * 0.00000079);
  return (inputTokens * 0.000000075) + (outputTokens * 0.0000003);
}

async function callLLMWithFallback({ systemPrompt, messages, customerMessage, negotiationId, merchantId }) {
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
          max_tokens: 150,
          temperature: 0.7
        });
        rawReply = response.choices[0].message.content;
        inputTokens = response.usage?.prompt_tokens || 0;
        outputTokens = response.usage?.completion_tokens || 0;
      }

      if (provider === 'gemini') {
        model = 'gemini-2.0-flash';
        const geminiModel = gemini.getGenerativeModel({ model });
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

      await logLLMTrace({ negotiationId, merchantId, provider, model, inputTokens, outputTokens, latencyMs, costUsd, prompt: systemPrompt, response: rawReply });

      const { isDealStruck, dealPrice, reply } = parseReply(rawReply);
      const botOfferedPrice = isDealStruck ? dealPrice : extractBotOfferedPrice(reply);

      return { reply, isDealStruck, dealPrice, botOfferedPrice, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  throw new Error('All LLM providers failed');
}

module.exports = { callLLMWithFallback, buildSystemPrompt };
