const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { validateApiKey } = require('../middleware/auth');
const { widgetCors, dashboardCors } = require('../middleware/cors');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;

// ─── Dashboard: get presigned upload URL ────────────────────────────────────
router.post('/merchants/:merchantId/videos/upload-url', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { filename, content_type } = req.body;

  if (!filename || !content_type) {
    return res.status(400).json({ error: 'filename and content_type required' });
  }

  if (!content_type.startsWith('video/')) {
    return res.status(400).json({ error: 'Only video files allowed' });
  }

  const ext = filename.split('.').pop().toLowerCase();
  const s3Key = `videos/${merchantId}/${uuidv4()}.${ext}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: content_type,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
    const s3Url = `https://${BUCKET}.s3.amazonaws.com/${s3Key}`;

    res.json({ upload_url: uploadUrl, s3_key: s3Key, s3_url: s3Url });
  } catch (err) {
    console.error('[videos] presign error:', err.message);
    res.status(500).json({ error: 'Could not generate upload URL' });
  }
});

// ─── Dashboard: create video record after S3 upload ─────────────────────────
router.post('/merchants/:merchantId/videos', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { title, s3_key, s3_url, thumbnail_url, duration_seconds, width, height, source, source_url } = req.body;

  if (!s3_key || !s3_url) return res.status(400).json({ error: 's3_key and s3_url required' });

  const { data: video, error } = await supabase.from('videos').insert({
    merchant_id: merchantId,
    title: title || null,
    s3_key,
    s3_url,
    thumbnail_url: thumbnail_url || null,
    duration_seconds: duration_seconds || null,
    width: width || null,
    height: height || null,
    source: source || 'upload',
    source_url: source_url || null,
    status: 'active',
    sort_order: 0,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(video);
});

// ─── Dashboard: list videos for merchant ────────────────────────────────────
router.get('/merchants/:merchantId/videos', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;

  const { data: videos, error } = await supabase
    .from('videos')
    .select(`*, video_product_tags(*)`)
    .eq('merchant_id', merchantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(videos || []);
});

// ─── Dashboard: update video (title, status, sort_order) ────────────────────
router.put('/videos/:id', dashboardCors, async (req, res) => {
  const { title, status, sort_order } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (status !== undefined) updates.status = status;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('videos').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ─── Dashboard: delete video ────────────────────────────────────────────────
router.delete('/videos/:id', dashboardCors, async (req, res) => {
  const { data: video } = await supabase.from('videos').select('s3_key').eq('id', req.params.id).single();

  if (video?.s3_key) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: video.s3_key }));
    } catch (e) {
      console.warn('[videos] S3 delete failed:', e.message);
    }
  }

  const { error } = await supabase.from('videos').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ─── Dashboard: add product tag to video ────────────────────────────────────
router.post('/videos/:id/tags', dashboardCors, async (req, res) => {
  const { merchant_id, shopify_product_id, shopify_variant_id, product_name, product_handle, price, compare_at_price, image_url } = req.body;
  if (!shopify_product_id || !product_name) return res.status(400).json({ error: 'shopify_product_id and product_name required' });

  const { data, error } = await supabase.from('video_product_tags').insert({
    video_id: req.params.id,
    merchant_id,
    shopify_product_id,
    shopify_variant_id: shopify_variant_id || null,
    product_name,
    product_handle: product_handle || null,
    price: price || null,
    compare_at_price: compare_at_price || null,
    image_url: image_url || null,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ─── Dashboard: remove product tag ──────────────────────────────────────────
router.delete('/videos/:id/tags/:tagId', dashboardCors, async (req, res) => {
  const { error } = await supabase.from('video_product_tags').delete()
    .eq('id', req.params.tagId).eq('video_id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ─── Dashboard: list video widgets ───────────────────────────────────────────
router.get('/merchants/:merchantId/video-widgets', dashboardCors, async (req, res) => {
  const { data, error } = await supabase
    .from('video_widgets')
    .select(`id, name, type, created_at,
             video_widget_items(id, sort_order, video_id,
               videos(id, title, s3_url, thumbnail_url, status))`)
    .eq('merchant_id', req.params.merchantId)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// ─── Dashboard: create video widget ──────────────────────────────────────────
router.post('/merchants/:merchantId/video-widgets', dashboardCors, async (req, res) => {
  const { name, type = 'stories' } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { data, error } = await supabase
    .from('video_widgets')
    .insert({ merchant_id: req.params.merchantId, name, type })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ─── Dashboard: update widget (name/type/is_active) ──────────────────────────
router.put('/video-widgets/:id', dashboardCors, async (req, res) => {
  const { name, type, is_active } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (type !== undefined) updates.type = type;
  if (is_active !== undefined) updates.is_active = is_active;
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('video_widgets').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ─── Dashboard: delete widget ─────────────────────────────────────────────────
router.delete('/video-widgets/:id', dashboardCors, async (req, res) => {
  await supabase.from('video_widgets').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Dashboard: set widget items (replace all, preserving order) ──────────────
router.put('/video-widgets/:id/items', dashboardCors, async (req, res) => {
  const { video_ids } = req.body; // ordered array of video UUIDs
  if (!Array.isArray(video_ids)) return res.status(400).json({ error: 'video_ids array required' });

  // Delete existing items, then insert new ordered set
  await supabase.from('video_widget_items').delete().eq('widget_id', req.params.id);

  if (video_ids.length > 0) {
    const items = video_ids.map((video_id, i) => ({
      widget_id: req.params.id,
      video_id,
      sort_order: i,
    }));
    const { error } = await supabase.from('video_widget_items').insert(items);
    if (error) return res.status(400).json({ error: error.message });
  }

  res.json({ ok: true, count: video_ids.length });
});

// ─── Widget: public collections list (one entry per named widget) ────────────
router.get('/widget/collections', widgetCors, async (req, res) => {
  try {
    const { k: apiKey } = req.query;
    if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

    const { data: merchant } = await supabase.from('merchants').select('id').eq('api_key', apiKey).single();
    if (!merchant) return res.status(401).json({ error: 'Invalid API key' });

    // Get all active widgets
    const { data: widgets } = await supabase
      .from('video_widgets')
      .select('id, name, type')
      .eq('merchant_id', merchant.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (!widgets || widgets.length === 0) return res.json([]);

    // Get items for all widgets
    const widgetIds = widgets.map(w => w.id);
    const { data: items } = await supabase
      .from('video_widget_items')
      .select('widget_id, sort_order, video_id')
      .in('widget_id', widgetIds)
      .order('sort_order', { ascending: true });

    const itemsByWidget = {};
    (items || []).forEach(item => {
      if (!itemsByWidget[item.widget_id]) itemsByWidget[item.widget_id] = [];
      itemsByWidget[item.widget_id].push(item);
    });

    // Get thumbnails for first video of each widget
    const firstVideoIds = widgets.map(w => (itemsByWidget[w.id] || [])[0]?.video_id).filter(Boolean);
    const thumbMap = {};
    if (firstVideoIds.length > 0) {
      const { data: thumbVids } = await supabase
        .from('videos').select('id, s3_url, thumbnail_url').in('id', firstVideoIds);
      (thumbVids || []).forEach(v => { thumbMap[v.id] = v; });
    }

    const collections = widgets.map(w => {
      const wItems = itemsByWidget[w.id] || [];
      const firstId = wItems[0]?.video_id;
      const thumb = firstId ? thumbMap[firstId] : null;
      return {
        id: w.id,
        name: w.name,
        type: w.type,
        video_count: wItems.length,
        thumbnail_url: thumb?.thumbnail_url || thumb?.s3_url || null,
      };
    }).filter(c => c.video_count > 0);

    res.json(collections);
  } catch (err) {
    console.error('[widget/collections] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

// ─── Widget: public video feed (called by botiga-video.js) ───────────────────
// Supports ?w=WIDGET_ID to fetch a specific named collection, or all active videos
router.get('/widget/videos', widgetCors, async (req, res) => {
  try {
    const { k: apiKey, w: widgetId } = req.query;
    if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

    const { data: merchant } = await supabase.from('merchants').select('id').eq('api_key', apiKey).single();
    if (!merchant) return res.status(401).json({ error: 'Invalid API key' });

    const videoSelect = `id, title, s3_url, thumbnail_url, duration_seconds, width, height,
      status, views_count, likes_count, shares_count,
      video_product_tags(id, shopify_product_id, shopify_variant_id, product_name,
                         product_handle, price, compare_at_price, image_url)`;

    if (widgetId) {
      // Step 1: get ordered video IDs for this widget
      const { data: items, error: itemsErr } = await supabase
        .from('video_widget_items')
        .select('sort_order, video_id')
        .eq('widget_id', widgetId)
        .order('sort_order', { ascending: true });

      if (!itemsErr && items && items.length > 0) {
        const videoIds = items.map(i => i.video_id);

        // Step 2: fetch those videos in one query
        const { data: vids } = await supabase
          .from('videos')
          .select(videoSelect)
          .in('id', videoIds)
          .eq('status', 'active');

        // Re-sort to match widget order
        const byId = {};
        (vids || []).forEach(v => { byId[v.id] = v; });
        const ordered = videoIds.map(id => byId[id]).filter(Boolean);
        return res.json(ordered);
      }
      // If widget has no items or error, fall through to all-videos fallback
    }

    // Fallback: all active videos for merchant
    const { data: videos } = await supabase
      .from('videos')
      .select(videoSelect)
      .eq('merchant_id', merchant.id)
      .eq('status', 'active')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    res.json(videos || []);
  } catch (err) {
    console.error('[widget/videos] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// ─── Widget: track event ─────────────────────────────────────────────────────
router.post('/widget/videos/:id/event', widgetCors, async (req, res) => {
  const { k: apiKey, event_type, session_id, product_id } = req.body;
  if (!apiKey || !event_type) return res.status(400).json({ error: 'k and event_type required' });

  const { data: merchant } = await supabase.from('merchants').select('id').eq('api_key', apiKey).single();
  if (!merchant) return res.status(401).json({ error: 'Invalid API key' });

  // Insert event
  await supabase.from('video_events').insert({
    video_id: req.params.id,
    merchant_id: merchant.id,
    session_id: session_id || null,
    event_type,
    product_id: product_id || null,
  });

  // Increment counter on video row for fast reads
  const counterMap = {
    view: 'views_count',
    like: 'likes_count',
    share: 'shares_count',
    add_to_cart: 'add_to_cart_count',
    negotiate: 'negotiate_count',
  };
  const col = counterMap[event_type];
  if (col) {
    await supabase.rpc('increment_video_counter', { video_id: req.params.id, col_name: col })
      .catch(() => {}); // non-critical
  }

  res.json({ ok: true });
});

module.exports = router;
