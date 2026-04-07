const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateAdminSecret } = require('../middleware/auth');

router.use(validateAdminSecret);

// All active negotiations (live feed)
router.get('/admin/negotiations', async (req, res) => {
  const { status = 'active', limit = 100 } = req.query;

  const { data, error } = await supabase
    .from('negotiations')
    .select('*, merchants(name, email, website_url)')
    .eq('status', status)
    .order('updated_at', { ascending: false })
    .limit(Number(limit));

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// All merchants with analytics
router.get('/admin/merchants', async (req, res) => {
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('*, merchant_settings(*)')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  // Enrich each merchant with today's metrics and LLM costs
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const enriched = await Promise.all(merchants.map(async (m) => {
    const [
      { data: todayNegs },
      { data: monthNegs },
      { data: llmCosts }
    ] = await Promise.all([
      supabase.from('negotiations').select('status').eq('merchant_id', m.id).gte('created_at', today),
      supabase.from('negotiations').select('status, deal_price').eq('merchant_id', m.id).gte('created_at', monthAgo),
      supabase.from('llm_traces').select('cost_usd').eq('merchant_id', m.id).gte('created_at', monthAgo)
    ]);

    const won = monthNegs?.filter(n => n.status === 'won') || [];
    const llmCostTotal = llmCosts?.reduce((s, t) => s + (t.cost_usd || 0), 0) || 0;
    const revenueMonth = won.reduce((s, n) => s + (n.deal_price || 0), 0);

    // Risk classification
    let riskBadge = 'Good';
    if (llmCostTotal > revenueMonth * 0.15) riskBadge = 'Watch';
    if (!todayNegs?.length && monthNegs?.length === 0) riskBadge = 'Churn Risk';

    return {
      ...m,
      negotiations_today: todayNegs?.length || 0,
      win_rate_month: monthNegs?.length
        ? Math.round((won.length / monthNegs.length) * 100)
        : 0,
      revenue_month: Math.round(revenueMonth * 100) / 100,
      llm_cost_month: Math.round(llmCostTotal * 10000) / 10000,
      llm_cost_pct: revenueMonth ? Math.round((llmCostTotal / revenueMonth) * 100) : 0,
      risk_badge: riskBadge
    };
  }));

  res.json(enriched);
});

// Unresolved alerts
router.get('/admin/alerts', async (req, res) => {
  const { data, error } = await supabase
    .from('admin_alerts')
    .select('*, merchants(name, email)')
    .eq('resolved', false)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Resolve an alert
router.post('/admin/alerts/:id/resolve', async (req, res) => {
  const { error } = await supabase
    .from('admin_alerts')
    .update({ resolved: true })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
