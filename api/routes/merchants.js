const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

router.use(widgetCors);

// Create merchant (called after Supabase auth signup)
router.post('/merchants', async (req, res) => {
  const { email, name, website_url, auth_uid } = req.body;
  if (!email || !auth_uid) return res.status(400).json({ error: 'email and auth_uid required' });

  const apiKey = uuidv4();

  const { data: merchant, error } = await supabase
    .from('merchants')
    .insert({ id: auth_uid, email, name, website_url, api_key: apiKey })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Create default settings
  await supabase.from('merchant_settings').insert({ merchant_id: auth_uid });

  res.json(merchant);
});

// Get merchant profile
router.get('/merchants/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants')
    .select('*, merchant_settings(*)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

// Update merchant settings
router.put('/merchants/:id/settings', async (req, res) => {
  const allowed = [
    'tone', 'button_label', 'button_color', 'button_text_color', 'button_position',
    'max_discount_pct', 'floor_price_pct', 'floor_price_fixed', 'broker_fee_pct',
    'negotiate_on_product', 'negotiate_on_cart', 'recovery_enabled', 'recovery_channel',
    'dwell_time_seconds'
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('merchant_settings')
    .update(updates)
    .eq('merchant_id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Rotate API key
router.post('/merchants/:id/rotate-key', async (req, res) => {
  const newKey = uuidv4();
  const { data, error } = await supabase
    .from('merchants')
    .update({ api_key: newKey })
    .eq('id', req.params.id)
    .select('api_key')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
