/**
 * Customer Insights Extraction — runs in parallel with main LLM call.
 * Uses a fast small model. Gracefully returns null on any failure.
 */

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function extractCustomerInsight(message) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Extract personal context from this shopping chat message. Look for: occasion (wedding, birthday, gift, graduation), recipient (for a friend, for my daughter), timeline (need by Friday), emotional situation.

Message: "${message}"

Return JSON only: {"insight": "brief description or null", "category": "occasion|recipient|timeline|emotional|null"}
Only extract if genuinely present. A pure price offer like "can you do $50?" has no insight — return null.`
      }],
      max_tokens: 80,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    if (!parsed.insight) return { insight: null, category: null };
    return { insight: parsed.insight, category: parsed.category };
  } catch {
    return { insight: null, category: null };
  }
}

module.exports = { extractCustomerInsight };
