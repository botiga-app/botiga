const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { dashboardCors } = require('../middleware/cors');

// Get negotiations for a merchant (dashboard)
router.get('/merchants/:merchantId/negotiations', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { status, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('negotiations')
    .select('*')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Get single negotiation with full messages
router.get('/negotiations/:id', dashboardCors, async (req, res) => {
  const { data, error } = await supabase
    .from('negotiations')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

// Dashboard metrics
router.get('/merchants/:merchantId/metrics', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: thisWeek },
    { data: thisMonth },
    { data: allTime }
  ] = await Promise.all([
    supabase.from('negotiations').select('status, deal_price, list_price, broker_fee').eq('merchant_id', merchantId).gte('created_at', weekAgo),
    supabase.from('negotiations').select('status, deal_price, list_price, broker_fee').eq('merchant_id', merchantId).gte('created_at', monthAgo),
    supabase.from('negotiations').select('status, deal_price, list_price, broker_fee').eq('merchant_id', merchantId)
  ]);

  function computeMetrics(rows) {
    const total = rows?.length || 0;
    const won = rows?.filter(r => r.status === 'won') || [];
    const recovered = rows?.filter(r => r.status === 'recovered') || [];
    const revenue = won.reduce((s, r) => s + (r.deal_price || 0), 0);
    const brokerFees = won.reduce((s, r) => s + (r.broker_fee || 0), 0);
    const avgDiscount = won.length
      ? won.reduce((s, r) => s + ((r.list_price - r.deal_price) / r.list_price * 100), 0) / won.length
      : 0;
    const avgDeal = won.length ? revenue / won.length : 0;

    return {
      total,
      won: won.length,
      win_rate: total ? Math.round((won.length / total) * 100) : 0,
      recovered: recovered.length,
      revenue_recovered: Math.round(revenue * 100) / 100,
      broker_fees: Math.round(brokerFees * 100) / 100,
      avg_discount_pct: Math.round(avgDiscount * 10) / 10,
      avg_deal_value: Math.round(avgDeal * 100) / 100
    };
  }

  res.json({
    this_week: computeMetrics(thisWeek),
    this_month: computeMetrics(thisMonth),
    all_time: computeMetrics(allTime)
  });
});

module.exports = router;
