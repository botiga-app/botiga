// Per-video auto-tag pipeline:
//  1. Vision + caption analysis (videoAnalyzer)
//  2. Match against merchant's PUBLIC catalog (matchCatalog reads source_url)
//  3. Apply confidence threshold and either insert a video_product_tags row
//     or skip (per project memory: video auto-tag thresholds policy).
//
// Used by:
//  - api/routes/admin-video-tagging.js (admin endpoints)
//  - api/routes/videos.js (fired in background after merchant UI imports IG)

const supabase = require('../lib/supabase');
const { analyzeVideo } = require('./videoAnalyzer');
const { findBestMatch } = require('./matchCatalog');

const CONFIDENCE_AUTO = 0.5;
const CONFIDENCE_REVIEW = 0.3;

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

  const target = {
    title: analysis.title,
    color: analysis.color || null,
    category: analysis.category || null,
    description: analysis.description || null,
    sizes: analysis.sizes || [],
    price: analysis.price ?? null,
  };
  const matchResult = await findBestMatch(target, merchant);

  const visionConfidence = analysis.confidence ?? 0;
  const matchScore = matchResult?.score ?? 0;
  const combined = Math.round(visionConfidence * matchScore * 100) / 100;

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

  if (!matchResult || combined < CONFIDENCE_REVIEW) {
    return { video_id: videoId, status: 'skipped', combined_confidence: combined, vision_confidence: visionConfidence, match_score: matchScore };
  }

  const tagStatus = combined >= CONFIDENCE_AUTO ? 'auto_tagged' : 'pending_review';
  const m = matchResult.match;

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

module.exports = { analyzeAndTag, CONFIDENCE_AUTO, CONFIDENCE_REVIEW };
