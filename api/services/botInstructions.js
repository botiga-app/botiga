// Bot training — owner gives free-form instructions, we parse them
// once at save time into structured directives that the deterministic
// product-search scorer + the LLM can both consume.
//
// Free-form input examples:
//   "4th of July coming up — push the patriot collection"
//   "Don't promote the sale collection, it's running out"
//   "Always mention free shipping over $75"
//   "Push our summer dresses, they're moving slow"
//
// Parsed at save time into:
//   directives: [
//     { type: 'boost',   target_kind: 'collection', target_value: 'patriot', weight: 3.0, reason: '4th of July promotion' },
//     { type: 'context_phrase', value: '4th of July is coming up', until: '2026-07-05' }
//   ]
//
// Directives flow into:
//   - product scoring  (boost / suppress, see api/services/productQuery.js)
//   - LLM prompts      (context_phrase + a "Owner says..." line in the system prompt)

const Groq = require('groq-sdk');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const PARSE_PROMPT = `You parse merchant instructions for an AI shopping assistant into structured directives.

The merchant types free-form instructions like:
  "4th of July coming up — push the patriot collection"
  "Don't push the sale collection, it's running out"
  "Mention free shipping over $75"
  "Promote our cardigan collection — fall vibes"

Return ONLY a JSON array of directives. Each directive is one of these shapes:

  { "type": "boost",   "target_kind": "collection"|"tag", "target_value": "<handle-or-tag>", "weight": <number 1.0-5.0>, "reason": "<short>" }
  { "type": "suppress","target_kind": "collection"|"tag", "target_value": "<handle-or-tag>", "weight": 0,                "reason": "<short>" }
  { "type": "context_phrase", "value": "<short phrase the bot may mention>", "until": "<YYYY-MM-DD or null>" }
  { "type": "claim",   "value": "<promotional claim like 'free shipping over \$75'>" }

Rules:
- target_value: lowercase, hyphenated handle form (e.g. "patriot", "sale", "summer-dresses").
- weight for boost: 2.0 default, 3.0 if "really push" / "promote", 5.0 if "always show first".
- weight for suppress: always 0.
- "until" date: only if the merchant gives a clear time hint (e.g. "for 4th of July" → 2026-07-05). Otherwise null.
- Output ONLY the JSON array. No explanation. No markdown fence.

Examples:

Input: "4th of July coming up — promote the patriot collection"
Output: [{"type":"boost","target_kind":"collection","target_value":"patriot","weight":3.0,"reason":"4th of July promotion"},{"type":"context_phrase","value":"4th of July is coming up","until":"2026-07-05"}]

Input: "Don't push the sale collection, running out of stock"
Output: [{"type":"suppress","target_kind":"collection","target_value":"sale","weight":0,"reason":"running out of stock"}]

Input: "Mention free shipping over \$75"
Output: [{"type":"claim","value":"free shipping over \$75"}]

Input: "Push cardigans for fall"
Output: [{"type":"boost","target_kind":"tag","target_value":"cardigan","weight":2.0,"reason":"fall season"}]`;

async function parseInstructionToDirectives(text) {
  const fallback = [{ type: 'context_phrase', value: String(text).slice(0, 200), until: null }];
  if (!groq) return fallback;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: PARSE_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });
    const raw = (res.choices[0]?.message?.content || '').trim();
    // Strip markdown fence if model added one anyway
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter(d => d && typeof d === 'object' && d.type);
  } catch (err) {
    console.warn('[botInstructions] parse failed, using fallback context_phrase:', err.message);
    return fallback;
  }
}

// Pull active directives for a merchant. Skips expired ones. Used by both
// productQuery scoring and LLM prompt injection.
async function getActiveDirectives(supabase, merchantId) {
  const { data: rows, error } = await supabase
    .from('bot_instructions')
    .select('directives, expires_at, instruction_text')
    .eq('merchant_id', merchantId)
    .eq('active', true)
    .order('priority', { ascending: false });
  if (error || !rows) return { directives: [], context_phrases: [], claims: [] };

  const now = Date.now();
  const directives = [];
  const context_phrases = [];
  const claims = [];

  for (const row of rows) {
    if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
    if (!Array.isArray(row.directives)) continue;
    for (const d of row.directives) {
      if (d.until && new Date(d.until).getTime() < now) continue;
      if (d.type === 'context_phrase' && d.value) context_phrases.push(d.value);
      else if (d.type === 'claim' && d.value) claims.push(d.value);
      else if (d.type === 'boost' || d.type === 'suppress') directives.push(d);
    }
  }
  return { directives, context_phrases, claims };
}

module.exports = { parseInstructionToDirectives, getActiveDirectives };
