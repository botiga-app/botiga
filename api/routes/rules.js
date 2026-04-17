const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

router.use(widgetCors);

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
  if (!['product', 'tag'].includes(rule_type)) {
    return res.status(400).json({ error: 'rule_type must be product or tag' });
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
