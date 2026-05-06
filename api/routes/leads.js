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

// Engagement = customer messages sent in the negotiation.
// Drives both the on-the-fly lead_tier classifier (for legacy rows
// where the column was never populated) and the visible "X interactions"
// pill on the leads page.
function interactionCount(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(m => m.role === 'user').length;
}

// Derive lead_tier when the row pre-dates migration 033 or never had
// it computed. Mirrors the in-flow classifier in negotiation.js so
// existing data shows up the same way as new data.
function deriveLeadTier(neg) {
  if (neg.lead_tier) return neg.lead_tier;
  if (neg.status === 'human_escalated' || neg.status === 'won_abandoned') return 'hot';
  const hasContact = !!(neg.customer_email || neg.customer_whatsapp);
  if (!hasContact) return null;
  const interactions = interactionCount(neg.messages || []);
  // At-floor reach (current_step >= 5) is hot regardless of message count
  if ((neg.current_step || 0) >= 5) return 'hot';
  if (interactions >= 6) return 'hot';   // very engaged
  if (interactions >= 3) return 'warm';  // medium
  if (interactions >= 1) return 'cold';
  return 'cold'; // contact only, no engagement
}

function shapeLead(neg) {
  const interactions = interactionCount(neg.messages || []);
  return {
    id: neg.id,
    source: 'negotiation',
    product_name: neg.product_name,
    product_url: neg.product_url,
    list_price: neg.list_price,
    floor_price: neg.floor_price,
    deal_price: neg.deal_price,
    status: neg.status,
    lead_tier: deriveLeadTier(neg),
    lead_status: neg.lead_status || 'new',
    customer_email: neg.customer_email,
    customer_whatsapp: neg.customer_whatsapp,
    customer_name: neg.customer_name,
    best_offer: bestCustomerOffer(neg.messages || []),
    earnable: earnable(neg),
    interactions,
    messages: neg.messages || [],
    last_message_at: neg.last_customer_message_at || neg.updated_at,
    escalated_at: neg.escalated_at,
    abandoned_at: neg.abandoned_at,
    merchant_contacted_at: neg.merchant_contacted_at,
    created_at: neg.created_at,
  };
}

function shapeConciergeLead(thread) {
  // concierge_threads aren't tied to a single product — pass through
  // last_product_url + last_page_type so the dashboard can show context.
  const interactions = interactionCount(thread.messages || []);
  return {
    id: thread.id,
    source: 'concierge',
    product_name: thread.last_product_url ? 'Concierge thread' : 'Browse session',
    product_url: thread.last_product_url || null,
    list_price: null,
    floor_price: null,
    deal_price: null,
    status: 'active',
    lead_tier: thread.lead_tier || (interactions >= 6 ? 'hot' : interactions >= 3 ? 'warm' : 'cold'),
    lead_status: thread.lead_status || 'new',
    customer_email: thread.customer_email,
    customer_whatsapp: thread.customer_whatsapp,
    customer_name: thread.customer_name,
    best_offer: null,
    earnable: 0,
    interactions,
    messages: thread.messages || [],
    last_message_at: thread.updated_at,
    escalated_at: null,
    abandoned_at: null,
    merchant_contacted_at: thread.merchant_contacted_at,
    created_at: thread.created_at,
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

  // Pull anything that COULD be a lead: contact captured, special status,
  // or an existing lead_tier. We compute the tier on-the-fly via
  // deriveLeadTier so legacy rows (pre-033) that never had lead_tier
  // populated still surface here. Won deals are excluded — they're closed
  // unless the won-abandoned cron has flipped them.
  const { data: rows, error } = await supabase
    .from('negotiations')
    .select('id, merchant_id, product_name, product_url, list_price, floor_price, deal_price, status, current_step, lead_tier, lead_status, customer_email, customer_whatsapp, customer_name, messages, last_customer_message_at, updated_at, escalated_at, abandoned_at, merchant_contacted_at, created_at')
    .eq('merchant_id', merchantId)
    .neq('status', 'won')
    .or('lead_tier.not.is.null,status.eq.human_escalated,status.eq.won_abandoned,status.eq.cold_lead,customer_email.not.is.null,customer_whatsapp.not.is.null')
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[leads] query failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // Concierge threads are leads in their own right — even before they've
  // attached to a product negotiation. Fetch in parallel with negotiations.
  const { data: threadRows, error: tErr } = await supabase
    .from('concierge_threads')
    .select('id, merchant_id, customer_email, customer_whatsapp, customer_name, messages, last_product_url, last_page_type, lead_tier, lead_status, merchant_contacted_at, created_at, updated_at')
    .eq('merchant_id', merchantId)
    .or('lead_tier.not.is.null,customer_email.not.is.null,customer_whatsapp.not.is.null')
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (tErr) {
    console.warn('[leads] concierge_threads query failed (non-fatal):', tErr.message);
  }

  // Filter out negotiations that don't actually qualify as leads — i.e.
  // post-deriveLeadTier, lead_tier is still null (means no contact AND
  // no special status). Those slipped through the .or() filter.
  const allLeads = [
    ...(rows || []).map(shapeLead),
    ...(threadRows || []).map(shapeConciergeLead),
  ].filter(l => l.lead_tier);

  const isHot  = l => l.lead_tier === 'hot';
  const isWarm = l => l.lead_tier === 'warm';
  const isCold = l => l.lead_tier === 'cold';

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
