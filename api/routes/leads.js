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
//
// 'won' deals with no recovered_at are treated as hot — the deal is
// locked in but the customer hasn't checked out yet. That's the most
// urgent moment for a merchant nudge ("your deal at $90 is still here").
// Once recovered_at is set the deal converted → not a lead.
function deriveLeadTier(neg) {
  if (neg.lead_tier) return neg.lead_tier;
  if (neg.status === 'human_escalated' || neg.status === 'won_abandoned') return 'hot';
  if (neg.status === 'won' && !neg.recovered_at) return 'hot';
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
    recovered_at: neg.recovered_at,
    deal_expires_at: neg.deal_expires_at,
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

  // Two-step pull from negotiations:
  //   1. anything with contact captured (and not recovered)
  //   2. anything in a special status (cold_lead/human_escalated/won/won_abandoned)
  // We do these as separate queries instead of one big .or() with
  // not.is.null clauses, because the multi-table .or() form has been
  // unreliable across postgrest versions and silently 500s. Two simple
  // queries deduped client-side is more robust.
  let allNegRows = [];
  let queryErrors = [];

  async function safeQuery(label, fn) {
    try {
      const { data, error } = await fn();
      if (error) {
        console.warn(`[leads] ${label} failed: ${error.message}`);
        queryErrors.push(`${label}: ${error.message}`);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn(`[leads] ${label} threw: ${e.message}`);
      queryErrors.push(`${label}: ${e.message}`);
      return [];
    }
  }

  const NEG_COLS = 'id, merchant_id, product_name, product_url, list_price, floor_price, deal_price, status, current_step, lead_tier, lead_status, customer_email, customer_whatsapp, customer_name, messages, last_customer_message_at, updated_at, escalated_at, abandoned_at, merchant_contacted_at, created_at, recovered_at, deal_expires_at';

  // 1. Negotiations with email captured
  const negsWithEmail = await safeQuery('negs.email', () => supabase
    .from('negotiations')
    .select(NEG_COLS)
    .eq('merchant_id', merchantId)
    .is('recovered_at', null)
    .not('customer_email', 'is', null)
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(300));

  // 2. Negotiations with phone captured
  const negsWithPhone = await safeQuery('negs.phone', () => supabase
    .from('negotiations')
    .select(NEG_COLS)
    .eq('merchant_id', merchantId)
    .is('recovered_at', null)
    .not('customer_whatsapp', 'is', null)
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(300));

  // 3. Negotiations in special status (covers `won` even if no contact yet)
  const negsWithSpecialStatus = await safeQuery('negs.status', () => supabase
    .from('negotiations')
    .select(NEG_COLS)
    .eq('merchant_id', merchantId)
    .is('recovered_at', null)
    .in('status', ['cold_lead', 'human_escalated', 'won', 'won_abandoned'])
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(300));

  // 4. Negotiations with lead_tier already set
  const negsWithTier = await safeQuery('negs.tier', () => supabase
    .from('negotiations')
    .select(NEG_COLS)
    .eq('merchant_id', merchantId)
    .is('recovered_at', null)
    .not('lead_tier', 'is', null)
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(300));

  // De-dupe by id
  const negsById = new Map();
  [...negsWithEmail, ...negsWithPhone, ...negsWithSpecialStatus, ...negsWithTier]
    .forEach(n => { if (!negsById.has(n.id)) negsById.set(n.id, n); });
  allNegRows = Array.from(negsById.values());

  // 5. Concierge threads (separate table — may not exist if migration 034
  // hasn't run; safeQuery swallows that). Two queries deduped, same
  // pattern as negotiations.
  const THREAD_COLS = 'id, merchant_id, customer_email, customer_whatsapp, customer_name, messages, last_product_url, last_page_type, lead_tier, lead_status, merchant_contacted_at, created_at, updated_at';
  const threadsWithEmail = await safeQuery('threads.email', () => supabase
    .from('concierge_threads')
    .select(THREAD_COLS)
    .eq('merchant_id', merchantId)
    .not('customer_email', 'is', null)
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(100));

  const threadsWithTier = await safeQuery('threads.tier', () => supabase
    .from('concierge_threads')
    .select(THREAD_COLS)
    .eq('merchant_id', merchantId)
    .not('lead_tier', 'is', null)
    .neq('lead_status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(100));

  const threadsById = new Map();
  [...threadsWithEmail, ...threadsWithTier].forEach(t => {
    if (!threadsById.has(t.id)) threadsById.set(t.id, t);
  });
  const allThreadRows = Array.from(threadsById.values());

  // Use the legacy variable names below for minimal-diff downstream.
  const rows = allNegRows;
  const threadRows = allThreadRows;
  const error = null;

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
    debug_query_errors: queryErrors.length ? queryErrors : undefined,
    debug_raw_neg_count: rows.length,
    debug_raw_thread_count: threadRows.length,
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
