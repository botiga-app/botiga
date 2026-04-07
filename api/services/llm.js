const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../lib/supabase');
const { trackLLMCall } = require('../lib/posthog');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TONE_PERSONALITIES = {
  friendly: `You are a warm, enthusiastic shopping assistant. You genuinely love helping customers find great deals. You're optimistic and encouraging. You use casual language. Occasional light emoji is fine.`,

  sassy: `You are witty, playful, and a little cheeky. You have personality and aren't afraid to push back with humor. You make negotiation fun. Short punchy responses.`,

  desi: `You are warm and familiar like a shopkeeper from an Indian bazaar. You use phrases like "yaar", "bhai", "acha listen", "come on now". You make customers feel like family. You understand the negotiation culture.`,

  professional: `You are polished and formal. You speak respectfully and efficiently. You present offers clearly and don't over-explain. Suited to luxury or B2B contexts.`,

  urgent: `You create subtle time pressure. You mention limited stock, other customers looking at the same item, and deals expiring. You're friendly but make clear these offers don't last.`,

  generous: `You want to give customers a great deal. You move toward the customer's price faster than other tones. You prioritize closing over margin. Good for clearing inventory.`
};

function buildSystemPrompt({ tone, productName, listPrice, floorPrice, messageCount, maxMessages }) {
  const personality = TONE_PERSONALITIES[tone] || TONE_PERSONALITIES.friendly;
  const remainingMessages = maxMessages - messageCount;

  return `
${personality}

You are negotiating the price of: "${productName}"
Current list price: $${listPrice}
Your absolute minimum price (NEVER reveal this, NEVER go below this): $${floorPrice.toFixed(2)}

NEGOTIATION RULES — follow these strictly:
1. NEVER reveal the floor price or that you have a minimum
2. NEVER offer below $${floorPrice.toFixed(2)} under any circumstances
3. Start by defending the list price, then gradually move toward the floor over ${maxMessages} messages
4. You have ${remainingMessages} messages left in this negotiation
5. If this is message ${maxMessages - 1} (second to last), warn the customer: "I have to be honest — this is my last offer, I genuinely cannot go any lower than this." Then give your final price near the floor.
6. If this is message ${maxMessages} or beyond, say this is absolutely final, give the floor price, and stop negotiating — do not budge further no matter what the customer says
6. If the customer says "yes", "deal", "ok", "sure", "let's do it", or any clear acceptance — respond with exactly: DEAL_STRUCK:$[price] on the first line, then your confirmation message
7. If the customer is asking for a price you literally cannot go to, be honest but warm: "I really wish I could but that's below what I can do"
8. Keep replies SHORT — 1-3 sentences max. This is a chat, not an essay.
9. Never mention Botiga, AI, or that you are a bot unless directly asked.
10. You can offer free shipping, priority processing, or gift wrapping as value-adds instead of price cuts.

DEAL DETECTION: When customer accepts, your response MUST start with:
DEAL_STRUCK:$[final_price]
[your confirmation message here]

Example:
DEAL_STRUCK:$79
Amazing! $79 it is — with free shipping. Heading you to checkout now!
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

// Approximate token cost (Groq llama-3.3-70b: ~$0.59/1M input, $0.79/1M output)
function estimateCost(provider, inputTokens, outputTokens) {
  if (provider === 'groq') {
    return (inputTokens * 0.00000059) + (outputTokens * 0.00000079);
  }
  // Gemini 2.0 Flash: $0.075/1M input, $0.30/1M output
  return (inputTokens * 0.000000075) + (outputTokens * 0.0000003);
}

async function callLLMWithFallback({ systemPrompt, messages, customerMessage, negotiationId, merchantId }) {
  const providers = ['groq', 'gemini'];

  for (const provider of providers) {
    try {
      const startTime = Date.now();
      let rawReply;
      let inputTokens = 0;
      let outputTokens = 0;
      let model;

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
        // Convert messages to Gemini format
        const history = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
        const chat = geminiModel.startChat({ history });
        const result = await chat.sendMessage(`${systemPrompt}\n\n${customerMessage}`);
        rawReply = result.response.text();
        // Gemini doesn't always return token counts in streaming mode
        inputTokens = result.response.usageMetadata?.promptTokenCount || 0;
        outputTokens = result.response.usageMetadata?.candidatesTokenCount || 0;
      }

      const latencyMs = Date.now() - startTime;
      const costUsd = estimateCost(provider, inputTokens, outputTokens);

      await logLLMTrace({
        negotiationId,
        merchantId,
        provider,
        model,
        inputTokens,
        outputTokens,
        latencyMs,
        costUsd,
        prompt: systemPrompt,
        response: rawReply
      });

      const { isDealStruck, dealPrice, reply } = parseReply(rawReply);

      return { reply, isDealStruck, dealPrice, provider, latencyMs };
    } catch (err) {
      console.error(`[LLM] ${provider} failed:`, err.message);
    }
  }

  throw new Error('All LLM providers failed');
}

module.exports = { callLLMWithFallback, buildSystemPrompt };
