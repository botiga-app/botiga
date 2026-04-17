const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

router.use(widgetCors);

// Fetch Shopify products merged with existing rules
router.get('/merchants/:merchantId/shopify-products', async (req, res) => {
  const { merchantId } = req.params;
  const { page = 1 } = req.query;

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('id', merchantId)
    .single();

  const domain = merchant?.shopify_domain || process.env.SHOPIFY_DOMAIN;
  const token = merchant?.shopify_access_token || process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(200).json({ products: [], error: 'no_shopify', message: 'Connect your Shopify store first' });
  }

  try {
    // Fetch one page of products from Shopify (250 max per request)
    const limit = 20;
    const sinceId = req.query.since_id || null;
    const url = `https://${domain}/admin/api/2024-01/products.json?limit=${limit}${sinceId ? `&since_id=${sinceId}` : ''}`;
    console.log(`[shopify-products] fetching from domain=${domain} token=${token.slice(0,10)}...`);
    const shopRes = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!shopRes.ok) {
      const body = await shopRes.text();
      console.error(`[shopify-products] ${shopRes.status} from domain=${domain}: ${body}`);
      throw new Error(`Shopify ${shopRes.status} (domain: ${domain}, token: ${token.slice(0,10)}...): ${body}`);
    }
    const { products } = await shopRes.json();

    // Fetch all rules (product + tag + collection) for this merchant
    const { data: rules } = await supabase
      .from('negotiation_rules')
      .select('*')
      .eq('merchant_id', merchantId);

    const productRulesByHandle = {};
    const tagRulesMap = {};
    const collectionRulesMap = {};
    for (const r of (rules || [])) {
      if (r.rule_type === 'product') productRulesByHandle[r.entity_id] = r;
      if (r.rule_type === 'tag') tagRulesMap[r.entity_id] = r;
      if (r.rule_type === 'collection') collectionRulesMap[r.entity_id] = r;
    }

    // Merge — include tags so frontend can derive tag groupings
    const merged = products.map(p => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      image: p.image?.src || null,
      price: p.variants?.[0]?.price || null,
      product_type: p.product_type || null,
      tags: p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      rule: productRulesByHandle[p.handle] || null
    }));

    res.json({
      products: merged,
      tag_rules: tagRulesMap,
      collection_rules: collectionRulesMap,
      has_more: products.length === limit,
      last_id: products[products.length - 1]?.id
    });
  } catch (err) {
    console.error('[shopify-products]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch Shopify collections merged with existing collection rules
router.get('/merchants/:merchantId/shopify-collections', async (req, res) => {
  const { merchantId } = req.params;

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('id', merchantId)
    .single();

  const domain = merchant?.shopify_domain || process.env.SHOPIFY_DOMAIN;
  const token = merchant?.shopify_access_token || process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(200).json({ collections: [], error: 'no_shopify' });
  }

  try {
    const headers = { 'X-Shopify-Access-Token': token };
    const [customRes, smartRes] = await Promise.all([
      fetch(`https://${domain}/admin/api/2024-01/custom_collections.json?limit=250`, { headers }),
      fetch(`https://${domain}/admin/api/2024-01/smart_collections.json?limit=250`, { headers })
    ]);

    const [customData, smartData] = await Promise.all([
      customRes.ok ? customRes.json() : { custom_collections: [] },
      smartRes.ok ? smartRes.json() : { smart_collections: [] }
    ]);

    const all = [
      ...(customData.custom_collections || []).map(c => ({ ...c, type: 'custom' })),
      ...(smartData.smart_collections || []).map(c => ({ ...c, type: 'smart' }))
    ].sort((a, b) => a.title.localeCompare(b.title));

    // Fetch collection-level rules
    const { data: rules } = await supabase
      .from('negotiation_rules')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('rule_type', 'collection');

    const rulesByHandle = {};
    for (const r of (rules || [])) rulesByHandle[r.entity_id] = r;

    const merged = all.map(c => ({
      id: c.id,
      title: c.title,
      handle: c.handle,
      type: c.type,
      products_count: c.products_count || 0,
      rule: rulesByHandle[c.handle] || null
    }));

    res.json({ collections: merged });
  } catch (err) {
    console.error('[shopify-collections]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List all rules for a merchant
router.get('/merchants/:merchantId/rules', async (req, res) => {
  const { merchantId } = req.params;

  const { data, error } = await supabase
    .from('negotiation_rules')
    .select('*')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Create a rule
router.post('/merchants/:merchantId/rules', async (req, res) => {
  const { merchantId } = req.params;
  const { rule_type, entity_id, entity_name, negotiable, max_discount_pct, floor_price_fixed, floor_price_pct } = req.body;

  if (!rule_type || !entity_id) {
    return res.status(400).json({ error: 'rule_type and entity_id required' });
  }
  if (!['product', 'tag', 'collection'].includes(rule_type)) {
    return res.status(400).json({ error: 'rule_type must be product, tag, or collection' });
  }

  const { data, error } = await supabase
    .from('negotiation_rules')
    .upsert({
      merchant_id: merchantId,
      rule_type,
      entity_id: entity_id.toLowerCase().trim(),
      entity_name: entity_name || entity_id,
      negotiable: negotiable !== undefined ? negotiable : true,
      max_discount_pct: max_discount_pct || null,
      floor_price_fixed: floor_price_fixed || null,
      floor_price_pct: floor_price_pct || null
    }, { onConflict: 'merchant_id,rule_type,entity_id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Update a rule
router.patch('/merchants/:merchantId/rules/:ruleId', async (req, res) => {
  const { merchantId, ruleId } = req.params;
  const updates = req.body;

  // Only allow safe fields
  const allowed = ['negotiable', 'max_discount_pct', 'floor_price_fixed', 'floor_price_pct', 'entity_name'];
  const patch = {};
  for (const key of allowed) {
    if (key in updates) patch[key] = updates[key];
  }

  const { data, error } = await supabase
    .from('negotiation_rules')
    .update(patch)
    .eq('id', ruleId)
    .eq('merchant_id', merchantId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Delete a rule
router.delete('/merchants/:merchantId/rules/:ruleId', async (req, res) => {
  const { merchantId, ruleId } = req.params;

  const { error } = await supabase
    .from('negotiation_rules')
    .delete()
    .eq('id', ruleId)
    .eq('merchant_id', merchantId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
