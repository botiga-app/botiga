const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Groq = require('groq-sdk');
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
    'max_discount_pct', 'cart_max_discount_pct', 'floor_price_pct', 'floor_price_fixed', 'broker_fee_pct',
    'negotiate_on_product', 'negotiate_on_cart', 'recovery_enabled', 'recovery_channel',
    'dwell_time_seconds', 'brand_value_statements',
    'proactive_delay', 'proactive_message', 'auto_open_delay',
    'widget_type', 'show_trigger', 'chat_popup_delay', 'cart_trigger',
    'bot_name', 'bot_greeting', 'bot_avatar_url', 'bot_personality'
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

// Generate brand value statements from About Us text
router.post('/merchants/:id/generate-statements', async (req, res) => {
  const { about_text } = req.body;
  if (!about_text) return res.status(400).json({ error: 'about_text required' });

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are helping an e-commerce merchant write brand value statements for their AI negotiation bot. The bot uses these statements as reasons when offering a price — e.g. "I can do $199 — [statement]."

From the text below, extract exactly 5 short, punchy brand value statements. Each should be:
- 1 sentence, max 12 words
- A genuine reason why the product/brand commands its price
- Focused on: craftsmanship, materials, sustainability, returns policy, exclusivity, shipping, story, or scarcity
- Written as a fact about the brand, not a sales pitch

About Us text:
"""
${about_text}
"""

Return JSON only: {"statements": ["...", "...", "...", "...", "..."]}`
      }],
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    res.json({ statements: parsed.statements || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate statements: ' + err.message });
  }
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
