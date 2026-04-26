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

// ─── Instagram: preview posts by handle ──────────────────────────────────────
router.get('/merchants/:merchantId/videos/instagram-preview', dashboardCors, async (req, res) => {
  const { handle } = req.query;
  if (!handle) return res.status(400).json({ error: 'handle required' });

  const cleanHandle = handle.replace(/^@/, '').trim();
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) return res.status(500).json({ error: 'RAPIDAPI_KEY not configured' });

  try {
    const response = await fetch(
      'https://instagram120.p.rapidapi.com/api/instagram/posts',
      {
        method: 'POST',
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': 'instagram120.p.rapidapi.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: cleanHandle, maxId: '' }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!response.ok) return res.status(response.status).json({ error: `Instagram API returned ${response.status}` });

    const raw = await response.json();

    // Normalize the response — handle multiple common response shapes
    const posts = normalizeInstagramPosts(raw);
    res.json({ posts, handle: cleanHandle });
  } catch (err) {
    console.error('[instagram-preview]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function normalizeInstagramPosts(raw) {
  let items = [];

  // Shape 1: { result: { edges: [...] } }  — instagram120 API
  if (raw?.result?.edges) items = raw.result.edges.map(e => e.node || e);
  // Shape 2: { data: { items: [...] } }
  else if (raw?.data?.items) items = raw.data.items;
  // Shape 3: { items: [...] }
  else if (Array.isArray(raw?.items)) items = raw.items;
  // Shape 4: { data: { user: { edge_owner_to_timeline_media: { edges: [...] } } } }
  else if (raw?.data?.user?.edge_owner_to_timeline_media?.edges) {
    items = raw.data.user.edge_owner_to_timeline_media.edges.map(e => e.node);
  }
  // Shape 5: direct array
  else if (Array.isArray(raw)) items = raw;
  // Shape 6: { posts: [...] }
  else if (Array.isArray(raw?.posts)) items = raw.posts;

  return items
    .filter(item => {
      return item.is_video ||
        item.media_type === 2 ||
        item.video_url ||
        (Array.isArray(item.video_versions) && item.video_versions.length > 0);
    })
    .map(item => {
      const videoUrl = item.video_url
        || item.video_versions?.[0]?.url
        || item.videos?.standard_resolution?.url
        || null;

      const thumbUrl = item.thumbnail_url
        || item.display_url
        || item.thumbnail_src
        || item.image_versions2?.candidates?.[0]?.url
        || item.cover_frame_url
        || null;

      const caption = item.caption?.text
        || item.edge_media_to_caption?.edges?.[0]?.node?.text
        || item.accessibility_caption
        || '';

      const postUrl = item.shortcode
        ? `https://www.instagram.com/p/${item.shortcode}/`
        : item.permalink || item.link || null;

      return {
        id: String(item.id || item.pk || Math.random()),
        video_url: videoUrl,
        thumbnail_url: thumbUrl,
        caption: caption.slice(0, 200),
        post_url: postUrl,
        duration: item.video_duration || item.duration || null,
        like_count: item.like_count || item.edge_liked_by?.count || 0,
        play_count: item.play_count || item.view_count || 0,
      };
    })
    .filter(p => p.video_url || p.thumbnail_url); // must have at least a thumbnail
}

// ─── Instagram: import selected posts ────────────────────────────────────────
router.post('/merchants/:merchantId/videos/import-social', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;
  const { posts, source = 'instagram' } = req.body;

  if (!Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({ error: 'posts array required' });
  }

  const toInsert = posts.map(post => ({
    merchant_id: merchantId,
    title: post.caption ? post.caption.slice(0, 80) : null,
    s3_key: null,
    s3_url: post.video_url || post.thumbnail_url,
    thumbnail_url: post.thumbnail_url || null,
    source,
    source_url: post.post_url || null,
    status: 'active',
    sort_order: 0,
  }));

  const { data, error } = await supabase
    .from('videos')
    .insert(toInsert)
    .select('*, video_product_tags(*)');

  if (error) return res.status(400).json({ error: error.message });
  res.json({ imported: data.length, videos: data });
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

// ─── Widget: live stats for a single video (polling) ────────────────────────
router.get('/widget/videos/:id/stats', widgetCors, async (req, res) => {
  const { data, error } = await supabase
    .from('videos')
    .select('views_count, likes_count, shares_count')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Not found' });

  // Count comments separately — comments_count column added by migration 017
  const { count } = await supabase
    .from('video_comments')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', req.params.id)
    .is('parent_id', null);

  res.json({ ...data, comments_count: count || 0 });
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

  // Increment counter on video row — read current value then write new value
  const counterMap = {
    view: 'views_count',
    like: 'likes_count',
    share: 'shares_count',
    add_to_cart: 'add_to_cart_count',
    negotiate: 'negotiate_count',
  };
  const col = counterMap[event_type];
  if (col) {
    const { data: current } = await supabase
      .from('videos')
      .select(col)
      .eq('id', req.params.id)
      .single();
    if (current) {
      await supabase
        .from('videos')
        .update({ [col]: (current[col] || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
    }
  }

  res.json({ ok: true });
});

// ─── Comments: get comments for a video (public) ────────────────────────────
router.get('/widget/videos/:videoId/comments', widgetCors, async (req, res) => {
  const { videoId } = req.params;
  const { data, error } = await supabase
    .from('video_comments')
    .select('id, author_name, body, is_merchant_reply, parent_id, created_at')
    .eq('video_id', videoId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  // Fetch replies for these top-level comments
  const ids = (data || []).map(c => c.id);
  let replies = [];
  if (ids.length) {
    const { data: rData } = await supabase
      .from('video_comments')
      .select('id, author_name, body, is_merchant_reply, parent_id, created_at')
      .in('parent_id', ids)
      .order('created_at', { ascending: true });
    replies = rData || [];
  }

  const comments = (data || []).map(c => ({
    ...c,
    replies: replies.filter(r => r.parent_id === c.id),
  }));

  res.json({ comments });
});

// ─── Comments: post a comment (public — customers) ───────────────────────────
router.post('/widget/videos/:videoId/comments', widgetCors, async (req, res) => {
  const { videoId } = req.params;
  const { author_name, author_email, body } = req.body;
  if (!author_name || !body) return res.status(400).json({ error: 'author_name and body required' });
  if (body.length > 1000) return res.status(400).json({ error: 'Comment too long' });

  const { data, error } = await supabase.from('video_comments').insert({
    video_id: videoId,
    author_name: author_name.trim().slice(0, 80),
    author_email: author_email ? author_email.trim() : null,
    body: body.trim(),
    is_merchant_reply: false,
  }).select('id, author_name, body, is_merchant_reply, parent_id, created_at').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ comment: { ...data, replies: [] } });
});

// ─── Comments: merchant replies (dashboard auth) ─────────────────────────────
router.post('/merchants/:merchantId/videos/:videoId/comments/:commentId/reply', dashboardCors, async (req, res) => {
  const { videoId, commentId } = req.params;
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });

  // Verify the parent comment belongs to this video
  const { data: parent, error: parentErr } = await supabase
    .from('video_comments')
    .select('id')
    .eq('id', commentId)
    .eq('video_id', videoId)
    .single();
  if (parentErr || !parent) return res.status(404).json({ error: 'Comment not found' });

  const { data, error } = await supabase.from('video_comments').insert({
    video_id: videoId,
    author_name: 'Shop',
    body: body.trim(),
    parent_id: commentId,
    is_merchant_reply: true,
  }).select('id, author_name, body, is_merchant_reply, parent_id, created_at').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ comment: data });
});

// ─── Comments: list all comments for a merchant's videos (dashboard) ─────────
router.get('/merchants/:merchantId/comments', dashboardCors, async (req, res) => {
  const { merchantId } = req.params;

  // Get all video IDs for this merchant
  const { data: videos, error: vErr } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url')
    .eq('merchant_id', merchantId);
  if (vErr) return res.status(500).json({ error: vErr.message });

  const videoIds = (videos || []).map(v => v.id);
  if (!videoIds.length) return res.json({ comments: [] });

  const { data: comments, error } = await supabase
    .from('video_comments')
    .select('id, video_id, author_name, author_email, body, is_merchant_reply, parent_id, created_at')
    .in('video_id', videoIds)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  const videoMap = Object.fromEntries((videos || []).map(v => [v.id, v]));
  res.json({
    comments: (comments || []).map(c => ({ ...c, video: videoMap[c.video_id] || null })),
  });
});

// ─── AI: analyse video frames with Groq Vision ───────────────────────────────
router.post('/videos/:id/analyze', async (req, res) => {
  const { frames, thumbnail_url } = req.body;

  const images = [];
  if (Array.isArray(frames) && frames.length) {
    frames.slice(0, 4).forEach(f => {
      const url = f.startsWith('data:') ? f : `data:image/jpeg;base64,${f}`;
      images.push({ type: 'image_url', image_url: { url } });
    });
  } else if (thumbnail_url) {
    images.push({ type: 'image_url', image_url: { url: thumbnail_url } });
  }

  if (!images.length) return res.status(400).json({ error: 'No images provided' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  const prompt = `Analyze these frames from a product video for a Shopify store. Respond ONLY with valid JSON, no markdown:
{
  "title": "compelling product title under 60 chars",
  "description": "2-3 sentence benefit-focused product description",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "category": "e.g. Women's Fashion"
}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.2-11b-vision-preview',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images] }],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    const data = await groqRes.json();
    if (!groqRes.ok) return res.status(500).json({ error: data.error?.message || 'Groq error' });

    const text = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Could not parse AI response', raw: text });

    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[analyze]', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// ─── AI: create Shopify product draft from AI analysis ───────────────────────
router.post('/videos/:id/create-product', async (req, res) => {
  const { title, description, tags, merchant_id, image_url } = req.body;
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id required' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('shopify_domain, shopify_access_token')
    .eq('id', merchant_id)
    .single();

  if (!merchant?.shopify_access_token) {
    return res.status(400).json({ error: 'Shopify not connected — install the app to enable this.' });
  }

  const productPayload = {
    product: {
      title,
      body_html: `<p>${description}</p>`,
      tags: Array.isArray(tags) ? tags.join(', ') : (tags || ''),
      status: 'draft',
      ...(image_url ? { images: [{ src: image_url }] } : {}),
    },
  };

  const shopifyRes = await fetch(
    `https://${merchant.shopify_domain}/admin/api/2024-01/products.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': merchant.shopify_access_token },
      body: JSON.stringify(productPayload),
    }
  );

  if (!shopifyRes.ok) {
    const err = await shopifyRes.json().catch(() => ({}));
    return res.status(400).json({ error: 'Shopify product creation failed', details: err });
  }

  const { product } = await shopifyRes.json();
  const variant = product.variants?.[0];

  const { data: tag, error: tagErr } = await supabase.from('video_product_tags').insert({
    video_id: req.params.id,
    merchant_id,
    shopify_product_id: String(product.id),
    shopify_variant_id: variant ? String(variant.id) : null,
    product_name: product.title,
    product_handle: product.handle,
    price: parseFloat(variant?.price || 0),
    image_url: product.images?.[0]?.src || null,
  }).select().single();

  if (tagErr) return res.status(500).json({ error: tagErr.message });
  res.json({ product, tag });
});

// ─── Widget: concierge chat ──────────────────────────────────────────────────
router.post('/widget/chat', widgetCors, async (req, res) => {
  const { k: apiKey, message, history, catalog, personality } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });
  if (!message) return res.status(400).json({ error: 'Missing message' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, name')
    .eq('api_key', apiKey)
    .single();
  if (!merchant) return res.status(401).json({ error: 'Invalid API key' });

  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) return res.status(500).json({ error: 'Chat not configured' });

  const storeName = merchant.name || 'this store';

  // Build catalog context string
  let catalogText = '';
  if (Array.isArray(catalog) && catalog.length) {
    catalogText = '\n\nStore products:\n' + catalog.map(p => {
      const price = parseFloat(p.price || 0).toFixed(2);
      const was = parseFloat(p.compare_at_price || 0);
      const disc = was > parseFloat(p.price || 0) ? ` (was $${was.toFixed(2)}, ${Math.round((1 - parseFloat(p.price) / was) * 100)}% off)` : '';
      return `- ${p.name}: $${price}${disc} [ID:${p.id}]`;
    }).join('\n');
  }

  // Personality tone instructions
  const toneMap = {
    salesy:   'You are an enthusiastic, persuasive shopping assistant. Sell confidently — highlight why each product is special, what makes it stand out, and why the customer will love it. Create gentle urgency. 1–3 sentences max.',
    friendly: 'You are a warm, helpful shopping assistant. Be conversational and supportive. 1–3 sentences max.',
    expert:   'You are a knowledgeable product expert. Give precise, confident recommendations with brief reasoning. 1–3 sentences max.',
    playful:  'You are a fun, upbeat shopping assistant. Use light humor and enthusiasm. 1–3 sentences max.',
  };
  const toneInstruction = toneMap[personality] || toneMap.salesy;

  // Gift-query detection — ask 1 targeted clarifying question before showing products
  const isGiftQuery = /gift|present|birthday|anniversary|christmas|holiday|surprise|for (my|a|the|him|her|them)/i.test(message);
  const hasConversationHistory = Array.isArray(history) && history.length > 0;
  const alreadyAskedClarifier = hasConversationHistory && history.some(m => /who.*for|budget|occasion|age|interest|style/i.test(m.content || ''));

  const giftInstruction = (isGiftQuery && !alreadyAskedClarifier)
    ? `\n\nThe customer is looking for a gift. Ask ONE short, friendly clarifying question to help narrow it down — like who it's for, their rough budget, or the occasion. Do NOT show products yet. Keep it warm and conversational.`
    : '';

  const systemPrompt = `You are a shopping assistant for ${storeName}. ${toneInstruction}${catalogText}

${giftInstruction}

IMPORTANT: Always respond with valid JSON in this exact format:
{"reply": "your message", "product_ids": []}

When recommending specific products from the catalog, include their IDs:
{"reply": "These are perfect for you — here's why...", "product_ids": ["id1", "id2"]}

Rules:
- Use the exact ID strings shown after [ID:] in the catalog. Never invent product IDs.
- When recommending products, briefly say WHY each is a great pick (1 sentence).
- For gift queries without enough info, ask ONE clarifying question and return empty product_ids.
- If a customer gives gift context (who/budget/occasion), recommend 2–4 matching products with enthusiasm.
- Never be pushy. Be genuinely helpful.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: 'user', content: message },
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqApiKey}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages, max_tokens: 300, temperature: 0.6 }),
    });
    if (!groqRes.ok) {
      const errBody = await groqRes.text().catch(() => '');
      throw new Error('groq ' + groqRes.status + ': ' + errBody.slice(0, 200));
    }
    const data = await groqRes.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    let reply = raw;
    let product_ids = [];
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        reply = parsed.reply || raw;
        product_ids = Array.isArray(parsed.product_ids) ? parsed.product_ids : [];
      }
    } catch (_) { /* plain text fallback */ }

    res.json({ reply, product_ids });
  } catch (err) {
    console.error('[chat]', err.message);
    res.json({ reply: "I'm having trouble right now. Please try again!", product_ids: [] });
  }
});

// ─── Widget: order tracking ──────────────────────────────────────────────────
router.post('/widget/order', widgetCors, async (req, res) => {
  const { k: apiKey, order_number, email } = req.body;
  if (!apiKey || !order_number || !email) return res.status(400).json({ error: 'Missing fields' });

  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, shopify_domain, shopify_access_token')
    .eq('api_key', apiKey)
    .single();
  if (!merchant) return res.status(401).json({ error: 'Invalid API key' });
  if (!merchant.shopify_access_token) return res.status(400).json({ error: 'Store not connected' });

  const orderName = order_number.startsWith('#') ? order_number : '#' + order_number;
  try {
    const shopifyRes = await fetch(
      `https://${merchant.shopify_domain}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&email=${encodeURIComponent(email)}&status=any&limit=1`,
      { headers: { 'X-Shopify-Access-Token': merchant.shopify_access_token, 'Content-Type': 'application/json' } }
    );
    if (!shopifyRes.ok) throw new Error('shopify ' + shopifyRes.status);
    const data = await shopifyRes.json();
    const order = (data.orders || [])[0];
    if (!order) return res.json({ error: 'Order not found' });

    const fulfillment = (order.fulfillments || [])[0];
    res.json({
      order: {
        order_number: order.order_number,
        fulfillment_status: order.fulfillment_status || 'unfulfilled',
        financial_status: order.financial_status,
        total_price: order.total_price,
        line_items: order.line_items || [],
        tracking_url: fulfillment ? (fulfillment.tracking_url || null) : null,
        tracking_number: fulfillment ? (fulfillment.tracking_number || null) : null,
        created_at: order.created_at,
      }
    });
  } catch (err) {
    console.error('[order-track]', err.message);
    res.status(500).json({ error: 'Could not fetch order' });
  }
});

// ─── Widget: public config (Supabase Realtime credentials for browser WS) ────
router.get('/widget/config', widgetCors, async (req, res) => {
  const { k: apiKey } = req.query;
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });
  const { data: merchant } = await supabase.from('merchants').select('id').eq('api_key', apiKey).single();
  if (!merchant) return res.status(401).json({ error: 'Invalid API key' });
  const { data: settings } = await supabase
    .from('merchant_settings')
    .select('bot_name, bot_greeting, bot_avatar_url, bot_personality')
    .eq('merchant_id', merchant.id)
    .single();
  res.json({
    supabase_url: process.env.SUPABASE_URL,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY || '',
    bot_name: settings?.bot_name || null,
    bot_subtitle: null,
    bot_greeting: settings?.bot_greeting || null,
    bot_avatar_url: settings?.bot_avatar_url || null,
    bot_personality: settings?.bot_personality || 'salesy',
  });
});

module.exports = router;
