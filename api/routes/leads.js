// Leads API — backs the /dashboard/leads page.
//
// Three buckets, each capped by the merchant's plan:
//   hot:  human_escalated | won_abandoned (or any negotiation with lead_tier='hot')
//   warm: lead_tier='warm' (engaged, contact captured, didn't reach floor)
//   cold: lead_tier='cold' (concierge captured contact pre-engagement)
//
// We sort by "earnable" (list_price - best_customer_offer) desc so the
// most lucrative leads surface first. The dashboard renders sales-y copy
// like "Up to $X in pending leads" using the totals returned here.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { widgetCors } = require('../middleware/cors');
const { getLimits, getLimitsForUI, PLAN_LIMITS } = require('../services/planLimits');

router.use(widgetCors);

function bestCustomerOffer(messages) {
  if (!Array.isArray(messages)) return null;
  const offers = [];
  for (const m of messages) {
    if (m.role !== 'user' || !m.content) continue;
    const matches = m.content.match(/\$?\s*([\d,]+(?:\.[\d]{1,2})?)/g) || [];
    for (const p of matches) {
      const n = parseFloat(p.replace(/[$,\s]/g, ''));
      if (n > 10) offers.push(n);
    }
  }
  return offers.length ? Math.max(...offers) : null;
}

function earnable(neg) {
  // For abandoned-won, the deal price is what merchant could earn back.
  if (neg.status === 'won_abandoned' && neg.deal_price) return Number(neg.deal_price);
  // Otherwise: customer's best offer (or 70% of list as a floor estimate)
  const best = bestCustomerOffer(neg.messages || []);
  if (best) return best;
  if (neg.list_price) return Math.round(Number(neg.list_price) * 0.7);
  return 0;
}

function shapeLead(neg) {
  return {
    id: neg.id,
    product_name: neg.product_name,
    product_url: neg.product_url,
    list_price: neg.list_price,
    floor_price: neg.floor_price,
    deal_price: neg.deal_price,
    status: neg.status,
    lead_tier: neg.lead_tier,
    lead_status: neg.lead_status,
    customer_email: neg.customer_email,
    customer_whatsapp: neg.customer_whatsapp,
    customer_name: neg.customer_name,
    best_offer: bestCustomerOffer(neg.messages || []),
    earnable: earnable(neg),
    last_message_at: neg.last_customer_message_at || neg.updated_at,
    escalated_at: neg.escalated_at,
    abandoned_at: neg.abandoned_at,
    merchant_contacted_at: neg.merchant_contacted_at,
    created_at: neg.created_at,
  };
}

router.get('/leads/:merchantId', async (req, res) => {
  const merchantId = req.params.merchantId;

  const { data: merchant, error: mErr } = await supabase
    .from('merchants')
    .select('id, plan, trial_ends_at')
    .eq('id', merchantId)
    .single();
  if (mErr || !merchant) return res.status(404).json({ error: 'merchant not found' });

  const { plan, hot: hotCap, warm: warmCap, cold: coldCap } = getLimits(merchant);

  // Pull recent leads — anything with a lead_tier OR a hot status. We
  // overfetch (500) and bucket+cap in JS rather than running 3 separate
  // queries; for any reasonable merchant this stays well under the limit.
  const { data: rows, error } = await supabase
    .from('negotiations')
    .select('id, merchant_id, product_name, product_url, list_price, floor_price, deal_price, status, lead_tier, lead_status, customer_email, customer_whatsapp, customer_name, messages, last_customer_message_at, updated_at, escalated_at, abandoned_at, merchant_contacted_at, created_at')
    .eq('merchant_id', merchantId)
    .or('lead_tier.not.is.null,status.eq.human_escalated,status.eq.won_abandoned,status.eq.cold_lead')
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[leads] query failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const allLeads = (rows || []).map(shapeLead);

  // Bucket: hot if lead_tier='hot' OR status in {human_escalated, won_abandoned}
  const isHot  = l => l.lead_tier === 'hot'  || l.status === 'human_escalated' || l.status === 'won_abandoned';
  const isWarm = l => l.lead_tier === 'warm' && !isHot(l);
  const isCold = l => l.lead_tier === 'cold' && !isHot(l) && !isWarm(l);

  const hotAll  = allLeads.filter(isHot).sort((a, b) => b.earnable - a.earnable);
  const warmAll = allLeads.filter(isWarm).sort((a, b) => b.earnable - a.earnable);
  const coldAll = allLeads.filter(isCold).sort((a, b) => b.earnable - a.earnable);

  const hot  = hotAll.slice(0, hotCap === Infinity ? hotAll.length : hotCap);
  const warm = warmAll.slice(0, warmCap === Infinity ? warmAll.length : warmCap);
  const cold = coldAll.slice(0, coldCap === Infinity ? coldAll.length : coldCap);

  // Total "earnable" — what the dashboard advertises as pending revenue.
  const totalEarnable = [...hot, ...warm, ...cold].reduce((s, l) => s + (l.earnable || 0), 0);

  res.json({
    plan,
    limits: getLimitsForUI(merchant),
    locked_counts: {
      hot:  Math.max(0, hotAll.length  - hot.length),
      warm: Math.max(0, warmAll.length - warm.length),
      cold: Math.max(0, coldAll.length - cold.length),
    },
    counts: { hot: hot.length, warm: warm.length, cold: cold.length },
    total_earnable: Math.round(totalEarnable),
    hot,
    warm,
    cold,
  });
});

// Mark a lead as contacted / dismissed — UI button hits this.
router.patch('/leads/:negotiationId', async (req, res) => {
  const { lead_status } = req.body || {};
  if (!['contacted', 'dismissed', 'converted', 'new'].includes(lead_status)) {
    return res.status(400).json({ error: 'invalid lead_status' });
  }
  const updates = { lead_status, updated_at: new Date().toISOString() };
  if (lead_status === 'contacted') updates.merchant_contacted_at = new Date().toISOString();

  const { error } = await supabase
    .from('negotiations')
    .update(updates)
    .eq('id', req.params.negotiationId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
