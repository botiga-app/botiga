// Admin endpoints for the AI video → product auto-tag pipeline.
//
// Chunked execution: each video analysis takes ~5s; running 20 in a single
// HTTP request blows past Vercel's 60s function ceiling. Endpoints are split
// so each call stays well under that limit.
//
//  POST /admin/videos/:id/analyze
//     Analyze a single video (vision + caption) and auto-tag.
//
//  POST /admin/videos/import-ig
//     { merchant_id, ig_handle, limit }
//     Imports the latest N IG videos. NO analysis. Fast (~3-8s).
//     Returns { imported, video_ids[] }.
//
//  POST /admin/videos/analyze-tick
//     { merchant_id, chunk_size? }
//     Processes up to chunk_size (default 5) un-analyzed videos.
//     Returns { processed, has_more, remaining, summary }.
//     Caller loops until has_more=false. Stays under 45s per tick.
//
//  POST /admin/videos/batch-analyze
//     { merchant_id }
//     Convenience: same as analyze-tick but no chunk cap. Use only with
//     <10 unanalyzed videos.
//
// All routes require x-admin-secret. Auto-tag rule (per project memory):
//   combined_confidence >= 0.5  → match_status='auto_tagged' (applied, reviewable)
//   0.3 <= combined < 0.5       → match_status='pending_review' (suggestion)
//   combined < 0.3              → no row inserted, video stays untagged

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { validateAdminSecret } = require('../middleware/auth');
const { analyzeVideo } = require('../services/videoAnalyzer');
const { findBestMatch } = require('../services/matchCatalog');

router.use('/admin/videos', validateAdminSecret);

const CONFIDENCE_AUTO = 0.5;
const CONFIDENCE_REVIEW = 0.3;
const ANALYSIS_GAP_MS = 1000; // small gap between videos to avoid rate limits

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Per-video analyze + auto-tag ───────────────────────────────────────────

async function analyzeAndTag(videoId) {
  const { data: video, error: vErr } = await supabase
    .from('videos')
    .select('id, merchant_id, title, thumbnail_url, source_url, analyzed_at')
    .eq('id', videoId)
    .single();
  if (vErr || !video) throw new Error(`video ${videoId} not found`);

  const { data: merchant, error: mErr } = await supabase
    .from('merchants')
    .select('id, source_url, shopify_domain, name')
    .eq('id', video.merchant_id)
    .single();
  if (mErr || !merchant) throw new Error(`merchant ${video.merchant_id} not found`);

  // 1) Vision + caption analysis
  let analysis;
  try {
    analysis = await analyzeVideo(video);
  } catch (err) {
    return { video_id: videoId, status: 'analyzer_error', error: err.message };
  }
  if (!analysis) {
    await supabase.from('videos').update({
      analyzed_at: new Date().toISOString(),
      analysis_payload: { error: 'analyzer returned null' },
    }).eq('id', videoId);
    return { video_id: videoId, status: 'no_analysis' };
  }

  // 2) Match against the merchant's PUBLIC catalog (source_url first, falls back to shopify_domain)
  const target = {
    title: analysis.title,
    color: analysis.color || null,
    category: analysis.category || null,
    description: analysis.description || null,
    sizes: analysis.sizes || [],
    price: analysis.price ?? null,
  };
  const matchResult = await findBestMatch(target, merchant);

  // Combined confidence: vision confidence × match score (both 0..1)
  const visionConfidence = analysis.confidence ?? 0;
  const matchScore = matchResult?.score ?? 0;
  const combined = Math.round(visionConfidence * matchScore * 100) / 100;

  // Always update analyzed_at + payload so we don't re-analyze
  const analysisPayload = {
    extracted: analysis,
    match: matchResult?.match || null,
    match_score: matchScore,
    combined_confidence: combined,
  };
  await supabase.from('videos').update({
    analyzed_at: new Date().toISOString(),
    analysis_payload: analysisPayload,
  }).eq('id', videoId);

  // 3) Decide tagging based on COMBINED confidence (not just match score)
  if (!matchResult || combined < CONFIDENCE_REVIEW) {
    return { video_id: videoId, status: 'skipped', combined_confidence: combined, vision_confidence: visionConfidence, match_score: matchScore };
  }

  const tagStatus = combined >= CONFIDENCE_AUTO ? 'auto_tagged' : 'pending_review';
  const m = matchResult.match;

  // Idempotent: skip if a tag for the same video+product already exists
  const { data: existing } = await supabase
    .from('video_product_tags')
    .select('id')
    .eq('video_id', videoId)
    .eq('shopify_product_id', m.product_id)
    .maybeSingle();

  if (existing) {
    return { video_id: videoId, status: 'already_tagged', combined_confidence: combined };
  }

  await supabase.from('video_product_tags').insert({
    video_id: videoId,
    merchant_id: video.merchant_id,
    shopify_product_id: m.product_id,
    shopify_variant_id: m.variant_id,
    product_name: m.title,
    product_handle: m.handle,
    price: m.price,
    image_url: m.image_url,
    match_score: combined,
    match_status: tagStatus,
    matched_at: new Date().toISOString(),
    match_reasoning: analysis.reasoning || null,
  });

  return {
    video_id: videoId,
    status: tagStatus,
    combined_confidence: combined,
    vision_confidence: visionConfidence,
    match_score: matchScore,
    matched_product: { title: m.title, handle: m.handle, product_id: m.product_id },
  };
}

router.post('/admin/videos/:id/analyze', async (req, res) => {
  try {
    const result = await analyzeAndTag(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Process up to chunk_size (default 5) unanalyzed videos. Caller loops
// until has_more is false. Each tick stays under 45s on a 5-chunk default.
router.post('/admin/videos/analyze-tick', async (req, res) => {
  const { merchant_id, chunk_size = 5 } = req.body || {};
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id')
    .eq('merchant_id', merchant_id)
    .is('analyzed_at', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(chunk_size, 10));
  if (error) return res.status(500).json({ error: error.message });

  const summary = { processed: 0, auto_tagged: 0, pending_review: 0, skipped: 0, errors: 0, results: [] };
  for (const v of videos) {
    try {
      const r = await analyzeAndTag(v.id);
      summary.results.push(r);
      summary.processed++;
      if (r.status === 'auto_tagged') summary.auto_tagged++;
      else if (r.status === 'pending_review') summary.pending_review++;
      else if (r.status === 'skipped' || r.status === 'no_analysis') summary.skipped++;
      else if (r.status === 'analyzer_error') summary.errors++;
    } catch (err) {
      summary.errors++;
      summary.results.push({ video_id: v.id, status: 'fatal_error', error: err.message });
    }
    await sleep(ANALYSIS_GAP_MS);
  }

  // Check if more remain
  const { count: remaining } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchant_id)
    .is('analyzed_at', null);

  res.json({ ...summary, has_more: (remaining ?? 0) > 0, remaining: remaining ?? 0 });
});

router.post('/admin/videos/batch-analyze', async (req, res) => {
  const { merchant_id } = req.body || {};
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id')
    .eq('merchant_id', merchant_id)
    .is('analyzed_at', null)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const summary = { auto_tagged: 0, pending_review: 0, skipped: 0, errors: 0, total: videos.length, results: [] };
  for (const v of videos) {
    try {
      const r = await analyzeAndTag(v.id);
      summary.results.push(r);
      if (r.status === 'auto_tagged') summary.auto_tagged++;
      else if (r.status === 'pending_review') summary.pending_review++;
      else if (r.status === 'skipped' || r.status === 'no_analysis') summary.skipped++;
      else if (r.status === 'analyzer_error') summary.errors++;
    } catch (err) {
      summary.errors++;
      summary.results.push({ video_id: v.id, status: 'fatal_error', error: err.message });
    }
    await sleep(ANALYSIS_GAP_MS);
  }
  res.json(summary);
});

// ─── Import-only: IG handle → import latest N videos (no analysis) ──────────
// Fast path; caller follows up with /admin/videos/analyze-tick to process.

router.post('/admin/videos/import-ig', async (req, res) => {
  const { merchant_id, ig_handle, limit = 20 } = req.body || {};
  if (!merchant_id || !ig_handle) {
    return res.status(400).json({ error: 'merchant_id and ig_handle required' });
  }
  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY not configured' });
  }

  const cleanHandle = String(ig_handle).replace(/^@/, '').trim();

  // 1) Preview from IG
  let posts;
  try {
    const previewRes = await fetch('https://instagram120.p.rapidapi.com/api/instagram/posts', {
      method: 'POST',
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'instagram120.p.rapidapi.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: cleanHandle, maxId: '' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!previewRes.ok) {
      return res.status(previewRes.status).json({ error: `IG preview returned ${previewRes.status}` });
    }
    const raw = await previewRes.json();
    posts = require('./videos').normalizeInstagramPosts
      ? require('./videos').normalizeInstagramPosts(raw)
      : null;
    // Fallback: inline shape detection if videos.js doesn't export the helper
    if (!posts) {
      let items = [];
      if (raw?.result?.edges) items = raw.result.edges.map(e => e.node || e);
      else if (raw?.data?.items) items = raw.data.items;
      else if (Array.isArray(raw?.items)) items = raw.items;
      posts = items
        .filter(i => i.is_video || i.media_type === 2 || i.video_url || (Array.isArray(i.video_versions) && i.video_versions.length))
        .map(i => ({
          id: String(i.id || i.pk || Math.random()),
          video_url: i.video_url || i.video_versions?.[0]?.url || null,
          thumbnail_url: i.thumbnail_url || i.display_url || i.image_versions2?.candidates?.[0]?.url || null,
          caption: (i.caption?.text || i.edge_media_to_caption?.edges?.[0]?.node?.text || '').slice(0, 200),
          post_url: i.shortcode ? `https://www.instagram.com/p/${i.shortcode}/` : null,
          duration: i.video_duration || i.duration || null,
          like_count: i.like_count || 0,
          play_count: i.play_count || 0,
        }))
        .filter(p => p.video_url || p.thumbnail_url);
    }
  } catch (err) {
    return res.status(500).json({ error: 'IG preview failed: ' + err.message });
  }

  const top = posts.slice(0, limit);
  if (!top.length) return res.json({ imported: 0, message: 'no videos found for handle' });

  // 2) Import — insert into videos table (skip duplicates by source_url)
  const inserted = [];
  for (const post of top) {
    const { data: existing } = await supabase
      .from('videos')
      .select('id')
      .eq('merchant_id', merchant_id)
      .eq('source_url', post.post_url || post.video_url)
      .maybeSingle();
    if (existing) continue;

    const { data, error } = await supabase
      .from('videos')
      .insert({
        merchant_id,
        title: post.caption || null,
        s3_key: null,                              // social videos use source_url instead
        s3_url: post.video_url || post.thumbnail_url,
        thumbnail_url: post.thumbnail_url,
        source: 'instagram',
        source_url: post.post_url || post.video_url,
        status: 'active',
      })
      .select('id')
      .single();
    if (!error && data) inserted.push(data.id);
  }

  res.json({
    handle: cleanHandle,
    fetched: top.length,
    imported: inserted.length,
    video_ids: inserted,
    next_step: `POST /admin/videos/analyze-tick { merchant_id: "${merchant_id}" } in a loop until has_more is false`,
  });
});

module.exports = router;
