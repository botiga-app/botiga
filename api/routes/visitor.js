// Visitor signals — dwell time per product + funnel-stage events.
// Both are append/upsert endpoints called from the storefront widget.
// They power /dashboard/funnel and the dwell-boost in product scoring.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateApiKey } = require('../middleware/auth');
const { settingsLimiter } = require('../middleware/rateLimit');
const { widgetCors, dashboardCors } = require('../middleware/cors');

// ── Dwell ───────────────────────────────────────────────────────────────────
// Widget POSTs a batch every 30s + on pagehide. dwell_map is
// { "product-handle": seconds_added_since_last_batch }. We add (not
// replace) so a customer who lingers across multiple batches accumulates.
router.post('/visitor/dwell', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const { session_id, dwell_map } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  if (!dwell_map || typeof dwell_map !== 'object') {
    return res.status(400).json({ error: 'dwell_map required' });
  }

  const entries = Object.entries(dwell_map)
    .filter(([handle, secs]) => handle && Number.isFinite(Number(secs)) && Number(secs) > 0)
    .slice(0, 50);                 // cap batch size — bad actor protection

  if (!entries.length) return res.json({ ok: true, applied: 0 });

  const nowIso = new Date().toISOString();
  let applied = 0;
  for (const [handle, secsRaw] of entries) {
    const secs = Math.min(Math.round(Number(secsRaw)), 600);   // cap per-batch at 10 min — anti-cheat
    const { data: existing } = await supabase
      .from('visitor_dwell')
      .select('dwell_seconds')
      .eq('merchant_id', merchantId)
      .eq('session_id', session_id)
      .eq('product_handle', handle)
      .maybeSingle();
    const next = (existing?.dwell_seconds || 0) + secs;
    const { error } = await supabase
      .from('visitor_dwell')
      .upsert({
        merchant_id: merchantId,
        session_id,
        product_handle: handle,
        dwell_seconds: next,
        last_updated_at: nowIso,
      }, { onConflict: 'merchant_id,session_id,product_handle' });
    if (!error) applied++;
  }

  res.json({ ok: true, applied });
});

// ── Funnel events ──────────────────────────────────────────────────────────
// Append-only per-stage log. The unique index on (merchant, session, stage)
// makes re-firing the same event a no-op — safe to call from any client
// path without dedupe logic.
const VALID_STAGES = ['arrived', 'engaged', 'captured', 'discovered', 'negotiated', 'held', 'won', 'checked_out', 'lost'];

router.post('/visitor/event', widgetCors, settingsLimiter, validateApiKey, async (req, res) => {
  const merchantId = req.merchant.id;
  const { session_id, stage, metadata = null } = req.body || {};
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  if (!VALID_STAGES.includes(stage)) return res.status(400).json({ error: 'invalid stage' });

  const { error } = await supabase
    .from('visitor_events')
    .upsert({
      merchant_id: merchantId,
      session_id,
      stage,
      metadata,
    }, { onConflict: 'merchant_id,session_id,stage', ignoreDuplicates: true });

  if (error) {
    // Duplicate key = customer already at this stage = success
    if (error.code === '23505') return res.json({ ok: true, deduped: true });
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── Dashboard: funnel summary + per-visitor drilldown ──────────────────────
// Returns per-stage counts + drop-off percentages + a list of recent
// sessions with their max stage reached + dwell totals. Drives the
// /dashboard/funnel page.
router.get('/merchants/:merchantId/funnel', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Stage counts
  const { data: events, error: evErr } = await supabase
    .from('visitor_events')
    .select('session_id, stage, metadata, created_at')
    .eq('merchant_id', merchantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (evErr) return res.status(500).json({ error: evErr.message });

  const counts = {};
  for (const stage of VALID_STAGES) counts[stage] = 0;
  const sessionStages = new Map();           // session_id → Set of stages
  const sessionLastSeen = new Map();          // session_id → latest created_at
  for (const e of events || []) {
    counts[e.stage] = (counts[e.stage] || 0) + 1;
    if (!sessionStages.has(e.session_id)) sessionStages.set(e.session_id, new Set());
    sessionStages.get(e.session_id).add(e.stage);
    const prev = sessionLastSeen.get(e.session_id);
    if (!prev || new Date(e.created_at).getTime() > new Date(prev).getTime()) {
      sessionLastSeen.set(e.session_id, e.created_at);
    }
  }

  const totalVisitors = sessionStages.size;
  const reach = {};
  for (const stage of VALID_STAGES) {
    reach[stage] = 0;
    for (const stages of sessionStages.values()) if (stages.has(stage)) reach[stage]++;
  }

  // Top dwell aggregations across all sessions in window — limited 200
  const { data: dwellRows } = await supabase
    .from('visitor_dwell')
    .select('session_id, product_handle, dwell_seconds, last_updated_at')
    .eq('merchant_id', merchantId)
    .gte('last_updated_at', since)
    .order('last_updated_at', { ascending: false })
    .limit(2000);

  const sessionDwell = new Map();             // session_id → [ {handle, seconds} ]
  for (const r of dwellRows || []) {
    if (!sessionDwell.has(r.session_id)) sessionDwell.set(r.session_id, []);
    sessionDwell.get(r.session_id).push({ handle: r.product_handle, seconds: r.dwell_seconds });
  }

  // Compose recent visitor list
  const STAGE_ORDER = VALID_STAGES;
  const visitors = Array.from(sessionStages.entries()).map(([sid, stagesSet]) => {
    const stages = Array.from(stagesSet);
    const maxStage = STAGE_ORDER.filter(s => stagesSet.has(s)).pop() || 'arrived';
    const dwell = (sessionDwell.get(sid) || []).sort((a, b) => b.seconds - a.seconds).slice(0, 5);
    return {
      session_id: sid,
      max_stage: maxStage,
      stages,
      dwell,
      last_seen: sessionLastSeen.get(sid),
    };
  }).sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());

  // Earnable estimate — sum of (list - best_offer) for all "negotiated"
  // sessions that haven't checked out, scaled by typical close rate.
  // Pull negotiation rows for these sessions to compute.
  const sessionIds = Array.from(sessionStages.keys()).slice(0, 500);
  let earnable = 0;
  if (sessionIds.length) {
    const { data: negs } = await supabase
      .from('negotiations')
      .select('session_id, list_price, deal_price, recovered_at')
      .eq('merchant_id', merchantId)
      .in('session_id', sessionIds)
      .gte('updated_at', since);
    for (const n of negs || []) {
      if (n.recovered_at) continue;
      const v = Number(n.deal_price || n.list_price || 0);
      if (v > 0) earnable += v;
    }
  }

  res.json({
    days,
    total_visitors: totalVisitors,
    counts,
    reach,
    visitors: visitors.slice(0, 200),
    earnable_pending: Math.round(earnable),
  });
});

module.exports = router;
