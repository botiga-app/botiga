const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');

// Capture contact info from exit-intent popup
router.post('/recovery/capture', widgetCors, async (req, res) => {
  const { negotiation_id, customer_whatsapp, customer_email } = req.body;
  if (!negotiation_id) return res.status(400).json({ error: 'negotiation_id required' });

  const updates = {};
  if (customer_whatsapp) updates.customer_whatsapp = customer_whatsapp;
  if (customer_email) updates.customer_email = customer_email;
  // Mark as pending so recovery cron picks it up
  updates.status = 'pending';

  const { error } = await supabase
    .from('negotiations')
    .update(updates)
    .eq('id', negotiation_id);

  if (error) return res.status(400).json({ error: error.message });

  // Log exit intent recovery attempt
  await supabase.from('recovery_attempts').insert({
    negotiation_id,
    step: 1,
    channel: 'exit_intent',
    sent_at: new Date().toISOString()
  });

  res.json({ success: true });
});

// Track recovery link clicks (merchants redirect through this)
router.get('/recovery/click', async (req, res) => {
  const { negotiation_id } = req.query;
  if (negotiation_id) {
    await supabase.from('recovery_attempts').update({
      clicked_at: new Date().toISOString()
    }).eq('negotiation_id', negotiation_id).is('clicked_at', null);
  }
  res.redirect(req.query.redirect || '/');
});

// Track recovery conversions (called from checkout confirmation)
router.post('/recovery/converted', widgetCors, async (req, res) => {
  const { negotiation_id } = req.body;
  if (!negotiation_id) return res.status(400).json({ error: 'negotiation_id required' });

  await supabase.from('negotiations').update({
    status: 'recovered',
    recovered_at: new Date().toISOString()
  }).eq('id', negotiation_id);

  await supabase.from('recovery_attempts').update({
    converted_at: new Date().toISOString()
  }).eq('negotiation_id', negotiation_id).is('converted_at', null);

  res.json({ success: true });
});

module.exports = router;
