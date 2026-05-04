// Onboarding API for the post-signup wizard. All endpoints are merchant-
// scoped via auth_uid passed in the body — no admin secret needed.
//
//   POST /api/onboarding/detect-store    { url } → returns auto-detected store info
//   POST /api/onboarding/save-step       { merchant_id, step, data } → upsert merchant fields
//   POST /api/onboarding/auto-setup      { merchant_id, bot_* } → create Floating Feed + concierge defaults
//   POST /api/onboarding/complete        { merchant_id } → mark completed_at, fire IG pull

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { dashboardCors } = require('../middleware/cors');
const { detectStore } = require('../services/storeDetect');

router.use('/onboarding', dashboardCors);

// ─── Step 1: detect store info from URL ─────────────────────────────────────
router.post('/onboarding/detect-store', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const info = await detectStore(url);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Save partial progress for any step ─────────────────────────────────────
// Updates merchant fields in place. Lets the wizard be refresh-safe.
const ALLOWED_FIELDS = new Set([
  'name',
  'website_url',
  'source_url',
  'ig_handle',
  'logo_url',
  'theme_color',
  'onboarding_step',
]);

router.post('/onboarding/save-step', async (req, res) => {
  const { merchant_id, data: stepData = {}, step } = req.body || {};
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  const update = {};
  for (const [k, v] of Object.entries(stepData)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (v === undefined) continue;
    update[k] = v === '' ? null : v;
  }
  if (step) update.onboarding_step = step;

  // If website_url was set, mirror to source_url so storeContext picks it up
  if (update.website_url && !update.source_url) {
    update.source_url = update.website_url;
  }

  if (!Object.keys(update).length) return res.json({ ok: true, no_op: true });

  const { error } = await supabase
    .from('merchants')
    .update(update)
    .eq('id', merchant_id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, updated: update });
});

// ─── Auto-setup: provision the obvious defaults so the merchant lands in a
// working state without manual config. Idempotent — safe to call repeatedly.
//
// Creates the Floating Feed video widget (if missing), populates it with the
// merchant's active videos, flips video_enabled on, and applies concierge bot
// defaults (name/avatar/personality) when the wizard supplies them.
router.post('/onboarding/auto-setup', async (req, res) => {
  const {
    merchant_id,
    bot_name,
    bot_avatar_url,
    bot_personality,
    bot_greeting,
  } = req.body || {};
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  try {
    // 1. Floating Feed widget — find or create
    const { data: existing } = await supabase
      .from('video_widgets')
      .select('id, name, type')
      .eq('merchant_id', merchant_id)
      .eq('type', 'feed')
      .limit(1);

    let widget = existing?.[0];
    if (!widget) {
      const { data: created, error: cErr } = await supabase
        .from('video_widgets')
        .insert({ merchant_id, name: 'Floating Feed', type: 'feed' })
        .select()
        .single();
      if (cErr) throw new Error(`widget_create: ${cErr.message}`);
      widget = created;
    }

    // 2. Populate widget with all active videos (replace existing items)
    const { data: vids } = await supabase
      .from('videos')
      .select('id')
      .eq('merchant_id', merchant_id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    let video_count = 0;
    if (vids?.length) {
      await supabase.from('video_widget_items').delete().eq('widget_id', widget.id);
      const items = vids.map((v, i) => ({
        widget_id: widget.id,
        video_id: v.id,
        sort_order: i,
      }));
      const { error: iErr } = await supabase.from('video_widget_items').insert(items);
      if (iErr) throw new Error(`widget_items: ${iErr.message}`);
      video_count = vids.length;
    }

    // 3. Concierge defaults on merchant_settings (upsert so it works even if
    // 028 backfill didn't run for this merchant).
    const settingsUpdate = { video_enabled: true };
    if (bot_name) settingsUpdate.bot_name = bot_name;
    if (bot_avatar_url) settingsUpdate.bot_avatar_url = bot_avatar_url;
    if (bot_personality) settingsUpdate.bot_personality = bot_personality;
    if (bot_greeting) settingsUpdate.bot_greeting = bot_greeting;

    const { error: sErr } = await supabase
      .from('merchant_settings')
      .upsert({ merchant_id, ...settingsUpdate }, { onConflict: 'merchant_id' });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    res.json({
      ok: true,
      widget_id: widget.id,
      video_count,
      bot: {
        name: bot_name || null,
        avatar_url: bot_avatar_url || null,
        personality: bot_personality || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Complete onboarding ────────────────────────────────────────────────────
// Marks completed_at, optionally kicks off the first IG video pull (if
// the merchant has an ig_handle and didn't skip the content step).
router.post('/onboarding/complete', async (req, res) => {
  const { merchant_id, fire_ig_pull = true, ig_limit = 20 } = req.body || {};
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  await supabase
    .from('merchants')
    .update({
      onboarding_completed_at: new Date().toISOString(),
      onboarding_step: 'completed',
    })
    .eq('id', merchant_id);

  // Best-effort: trigger first IG pull if handle is set
  let ig_pull_status = 'skipped';
  if (fire_ig_pull) {
    try {
      const { data: merchant } = await supabase
        .from('merchants')
        .select('ig_handle')
        .eq('id', merchant_id)
        .single();
      if (merchant?.ig_handle && process.env.RAPIDAPI_KEY) {
        // Fire IG preview + import inline so the dashboard's video grid
        // shows reels by the time the merchant lands. Tagging happens
        // afterwards via the existing /auto-tag-tick endpoint, polled
        // by /dashboard/videos.
        ig_pull_status = await firstIgPull(merchant_id, merchant.ig_handle, ig_limit);
      } else if (merchant?.ig_handle) {
        ig_pull_status = 'no_rapidapi_key';
      } else {
        ig_pull_status = 'no_ig_handle';
      }
    } catch (err) {
      ig_pull_status = `error: ${err.message}`;
    }
  }

  res.json({ ok: true, ig_pull_status });
});

// Helper: do the IG preview → import for the merchant's first reels.
// Mirrors the inline preview/normalize logic from /admin/videos/import-ig.
async function firstIgPull(merchantId, handle, limit) {
  const cleanHandle = String(handle).replace(/^@/, '').trim();
  const previewRes = await fetch('https://instagram120.p.rapidapi.com/api/instagram/posts', {
    method: 'POST',
    headers: {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': 'instagram120.p.rapidapi.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: cleanHandle, maxId: '' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!previewRes.ok) return `ig_preview_${previewRes.status}`;
  const raw = await previewRes.json();

  let items = [];
  if (raw?.result?.edges) items = raw.result.edges.map(e => e.node || e);
  else if (raw?.data?.items) items = raw.data.items;
  else if (Array.isArray(raw?.items)) items = raw.items;

  // Accept both reels AND photo posts. Photos render as static frames in
  // the shop feed (widget falls back to <img> when s3_url is null), so the
  // merchant gets a fuller feed even on photo-heavy IG accounts.
  const posts = items
    .map(i => {
      const isVideo = !!(i.is_video || i.media_type === 2 || i.video_url ||
        (Array.isArray(i.video_versions) && i.video_versions.length));
      return {
        video_url: isVideo ? (i.video_url || i.video_versions?.[0]?.url || null) : null,
        thumbnail_url: i.thumbnail_url || i.display_url || i.image_versions2?.candidates?.[0]?.url || null,
        caption: (i.caption?.text || i.edge_media_to_caption?.edges?.[0]?.node?.text || '').slice(0, 200),
        post_url: i.shortcode ? `https://www.instagram.com/p/${i.shortcode}/` : null,
      };
    })
    .filter(p => p.thumbnail_url || p.video_url)
    .slice(0, limit);

  if (!posts.length) return 'no_posts_found';

  const toInsert = posts.map(post => ({
    merchant_id: merchantId,
    title: post.caption || null,
    s3_key: null,
    s3_url: post.video_url || null,                    // null for photos — widget falls back to thumbnail
    thumbnail_url: post.thumbnail_url,
    source: 'instagram',
    source_url: post.post_url || post.video_url,
    status: 'active',
  }));

  const { data, error } = await supabase
    .from('videos')
    .insert(toInsert)
    .select('id');
  if (error) return `db_${error.code || 'error'}`;
  return `imported_${data.length}`;
}

module.exports = router;
