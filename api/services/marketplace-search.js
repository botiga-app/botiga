/**
 * Marketplace NLP search.
 * Parses customer intent with an LLM, then runs full-text + filter query against marketplace_products.
 */

const Groq = require('groq-sdk');
const supabase = require('../lib/supabase');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Use LLM to extract structured intent from a free-text query.
 * Returns { keywords, category, minPrice, maxPrice, style, occasion }
 */
async function parseIntent(query) {
  const systemPrompt = `You are a shopping search parser. Extract search intent from the user's query and return ONLY valid JSON — no markdown, no extra text.

Return this exact shape:
{
  "keywords": "core product keywords for full-text search, 3-6 words",
  "category": "product category if mentioned, else null",
  "minPrice": number or null,
  "maxPrice": number or null,
  "style": "style descriptor if mentioned, else null",
  "occasion": "occasion if mentioned, else null"
}`;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      max_tokens: 150,
      temperature: 0.1,
    });
    const raw = response.choices[0].message.content.trim();
    return JSON.parse(raw);
  } catch {
    // Fallback: use raw query as keywords
    return { keywords: query, category: null, minPrice: null, maxPrice: null, style: null, occasion: null };
  }
}

/**
 * Search marketplace_products using parsed intent.
 * Sponsored products are injected at top if keyword-relevant.
 * Returns array of product rows with merchant context.
 */
async function searchProducts({ query, limit = 20, offset = 0 }) {
  const intent = await parseIntent(query);

  // Build tsquery from keywords
  const tsQuery = (intent.keywords || query)
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(w => w.length > 1)
    .join(' & ');

  if (!tsQuery) return { products: [], intent };

  // Full-text search with optional price filters
  let dbQuery = supabase
    .from('marketplace_products')
    .select(`
      id, merchant_id, shopify_product_id, title, description,
      price, compare_at_price, images, tags, handle,
      product_type, vendor, variants, store_domain, store_name,
      max_discount_pct, is_sponsored,
      ts_rank(search_vector, to_tsquery('english', '${tsQuery.replace(/'/g, "''")}')) as rank
    `)
    .textSearch('search_vector', tsQuery, { type: 'plain', config: 'english' })
    .order('is_sponsored', { ascending: false })
    .order('rank', { ascending: false })
    .range(offset, offset + limit - 1);

  if (intent.minPrice != null) dbQuery = dbQuery.gte('price', intent.minPrice);
  if (intent.maxPrice != null) dbQuery = dbQuery.lte('price', intent.maxPrice);
  if (intent.category) dbQuery = dbQuery.ilike('product_type', `%${intent.category}%`);

  const { data, error } = await dbQuery;
  if (error) throw error;

  return { products: data || [], intent };
}

module.exports = { searchProducts, parseIntent };
