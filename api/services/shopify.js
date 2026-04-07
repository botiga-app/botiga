const SHOPIFY_API_VERSION = '2024-01';

/**
 * Creates a Shopify price rule + single-use discount code for a negotiated deal.
 * Returns the discount code string (e.g. "BOTIGA-A1B2C3D4").
 */
async function createShopifyDiscountCode({ shop, accessToken, listPrice, dealPrice, negotiationId, expiresAt }) {
  const discountAmount = (listPrice - dealPrice).toFixed(2);
  const code = `BOTIGA-${negotiationId.slice(0, 8).toUpperCase()}`;

  // Step 1: Create price rule
  const priceRuleRes = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/price_rules.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken
    },
    body: JSON.stringify({
      price_rule: {
        title: code,
        value_type: 'fixed_amount',
        value: `-${discountAmount}`,
        customer_selection: 'all',
        target_type: 'line_item',
        target_selection: 'all',
        allocation_method: 'across',
        starts_at: new Date().toISOString(),
        ends_at: expiresAt,
        usage_limit: 1,
        once_per_customer: true
      }
    })
  });

  if (!priceRuleRes.ok) {
    throw new Error(`Shopify price rule failed: ${await priceRuleRes.text()}`);
  }

  const { price_rule } = await priceRuleRes.json();

  // Step 2: Create discount code under that price rule
  const codeRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/price_rules/${price_rule.id}/discount_codes.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      body: JSON.stringify({ discount_code: { code } })
    }
  );

  if (!codeRes.ok) {
    throw new Error(`Shopify discount code failed: ${await codeRes.text()}`);
  }

  const { discount_code } = await codeRes.json();
  return discount_code.code;
}

module.exports = { createShopifyDiscountCode };
