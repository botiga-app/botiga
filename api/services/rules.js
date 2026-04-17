const supabase = require('../lib/supabase');

/**
 * Resolve effective negotiation rules for a product.
 * Priority: product rule > tag rules > merchant global defaults
 *
 * @param {string} merchantId
 * @param {object} opts
 * @param {string} opts.handle   - Shopify product handle (from URL)
 * @param {string[]} opts.tags   - product tags from Shopify meta
 * @param {object} opts.defaults - merchant_settings fallback
 * @returns {{ negotiable, max_discount_pct, floor_price_fixed, floor_price_pct }}
 */
async function resolveProductRules(merchantId, { handle, tags = [], defaults = {} }) {
  const { data: rules } = await supabase
    .from('negotiation_rules')
    .select('*')
    .eq('merchant_id', merchantId);

  if (!rules || rules.length === 0) {
    return buildResult(null, defaults);
  }

  // 1. Exact product match by handle
  const productRule = rules.find(r => r.rule_type === 'product' && r.entity_id === handle);
  if (productRule) return buildResult(productRule, defaults);

  // 2. Tag match — first matching tag rule wins
  const normalizedTags = tags.map(t => t.toLowerCase().trim());
  const tagRule = rules.find(
    r => r.rule_type === 'tag' && normalizedTags.includes(r.entity_id.toLowerCase().trim())
  );
  if (tagRule) return buildResult(tagRule, defaults);

  // 3. Fall back to merchant defaults
  return buildResult(null, defaults);
}

function buildResult(rule, defaults) {
  if (!rule) {
    return {
      negotiable: true,
      max_discount_pct: defaults.max_discount_pct ?? 20,
      floor_price_fixed: defaults.floor_price_fixed ?? null,
      floor_price_pct: defaults.floor_price_pct ?? null
    };
  }
  return {
    negotiable: rule.negotiable,
    max_discount_pct: rule.max_discount_pct ?? defaults.max_discount_pct ?? 20,
    floor_price_fixed: rule.floor_price_fixed ?? defaults.floor_price_fixed ?? null,
    floor_price_pct: rule.floor_price_pct ?? defaults.floor_price_pct ?? null
  };
}

module.exports = { resolveProductRules };
