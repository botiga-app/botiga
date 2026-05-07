'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Vertical-scroll merchant editor. One video per viewport. Right panel
// always edits the currently visible slide. Mirrors the customer-facing
// storefront feed UX so merchants see exactly what shoppers see, with
// edit affordances overlaid behind dashboard auth.
//
// Reuses the existing edit endpoints — no new backend needed:
//   PUT    /videos/:id              update title/status/etc.
//   POST   /videos/:id/tags         add product tag
//   DELETE /videos/:id/tags/:tagId  remove product tag
//   DELETE /videos/:id              delete the video
//   POST   /videos/:id/analyze      AI-tag analysis
//   POST   /videos/:id/create-product  AI-create a product

function fmt$(n) { if (n == null) return '—'; return '$' + Number(n).toFixed(2); }

// Pull N frames out of a video URL via canvas — fed to /analyze for
// AI auto-tag. Same approach as the existing AiTagger in /dashboard/videos.
async function extractFrames(videoSrc, count = 4) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    video.onerror = () => resolve([]);
    video.onloadedmetadata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const frames = [];
      const times = Array.from({ length: count }, (_, i) => (video.duration / (count + 1)) * (i + 1));
      let idx = 0;
      function next() {
        if (idx >= times.length) { resolve(frames); return; }
        video.currentTime = times[idx];
      }
      video.onseeked = () => {
        try { ctx.drawImage(video, 0, 0, 512, 512); frames.push(canvas.toDataURL('image/jpeg', 0.75)); } catch (_) {}
        idx++; next();
      };
      next();
    };
    video.src = videoSrc;
  });
}

function VideoSlide({ video, isActive, muted, onIntersect, onPlay }) {
  const videoRef = useRef(null);
  const slideRef = useRef(null);

  useEffect(() => {
    if (!slideRef.current) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && e.intersectionRatio > 0.6) onIntersect(video);
      });
    }, { threshold: [0.6] });
    obs.observe(slideRef.current);
    return () => obs.disconnect();
  }, [video, onIntersect]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      videoRef.current.muted = muted;
      videoRef.current.play().catch(() => {});
      onPlay && onPlay(video);
    } else {
      videoRef.current.pause();
    }
  }, [isActive, muted, video, onPlay]);

  const hasVideo = !!video.s3_url;
  return (
    <div
      ref={slideRef}
      className="snap-start h-full w-full flex items-center justify-center bg-black relative"
      style={{ scrollSnapAlign: 'start' }}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          src={video.s3_url}
          poster={video.thumbnail_url || undefined}
          loop
          playsInline
          muted={muted}
          preload={isActive ? 'auto' : 'metadata'}
          className="h-full max-h-full object-contain"
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        />
      ) : video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt={video.title || ''}
          className="h-full max-h-full object-contain"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="text-white/40 text-sm">No preview available</div>
      )}

      {/* Status pill bottom-left over the video */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 pointer-events-none">
        {video.status === 'active' ? (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500 text-white shadow">
            ✓ Live on storefront
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-500 text-white shadow">
            ◌ Hidden
          </span>
        )}
        {(video.video_product_tags || video.tags || []).length > 0 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">
            🏷️ {(video.video_product_tags || video.tags || []).length} tagged
          </span>
        )}
      </div>
    </div>
  );
}

function EditPanel({ video, merchantId, shopifyDomain, products, collections, allTags, onChange, onDelete }) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(video.title || '');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');           // 'all' | 'collection' | 'tag'
  const [filterValue, setFilterValue] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStep, setAiStep] = useState('idle');                  // 'idle' | 'extracting' | 'analysing' | 'review'
  const [aiResults, setAiResults] = useState([]);
  const [aiError, setAiError] = useState(null);
  const [aiCreateBusy, setAiCreateBusy] = useState(false);

  // Reset when active video changes
  useEffect(() => {
    setCaption(video.title || '');
    setEditingCaption(false);
    setSearch('');
    setFilterMode('all');
    setFilterValue('');
    setAiStep('idle');
    setAiResults([]);
    setAiError(null);
  }, [video.id]);

  const tags = video.video_product_tags || video.tags || [];

  async function saveCaption() {
    const next = caption.trim();
    setEditingCaption(false);
    if (next === (video.title || '')) return;
    await fetch(`${API}/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    onChange && onChange({ ...video, title: next });
  }

  async function toggleStatus() {
    const next = video.status === 'active' ? 'hidden' : 'active';
    await fetch(`${API}/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    onChange && onChange({ ...video, status: next });
  }

  async function removeTag(tagId) {
    await fetch(`${API}/api/videos/${video.id}/tags/${tagId}`, { method: 'DELETE' });
    const nextTags = (video.video_product_tags || []).filter(t => t.id !== tagId);
    onChange && onChange({ ...video, video_product_tags: nextTags });
  }

  // Add product — uses the flat shape from /merchants/:id/shopify-products,
  // matching what the existing ProductTagger sends.
  async function addProduct(p) {
    const body = {
      merchant_id: merchantId,
      shopify_product_id: String(p.id),
      shopify_variant_id: p.variant_id || null,
      product_name: p.title,
      product_handle: p.handle,
      price: p.price ? parseFloat(p.price) : null,
      compare_at_price: p.compare_at_price ? parseFloat(p.compare_at_price) : null,
      image_url: p.image || null,
    };
    const res = await fetch(`${API}/api/videos/${video.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const created = await res.json();
      const nextTags = [...(video.video_product_tags || []), created];
      onChange && onChange({ ...video, video_product_tags: nextTags });
      setSearch('');
    }
  }

  // AI auto-tag — extract 4 frames from the video, POST to /analyze with
  // them in the body, get back detected products with confidence scores.
  // Then auto-create video tags for high-confidence detections (≥0.5) so
  // the merchant doesn't have to click through review for every video.
  async function runAiTag() {
    setAiBusy(true); setAiError(null); setAiStep('extracting'); setAiResults([]);
    try {
      let frames = [];
      if (video.s3_url) frames = await extractFrames(video.s3_url);
      const body = frames.length
        ? { frames }
        : video.thumbnail_url ? { thumbnail_url: video.thumbnail_url } : null;
      if (!body) {
        setAiError('No video or thumbnail to analyze.');
        setAiStep('idle');
        return;
      }
      setAiStep('analysing');
      const res = await fetch(`${API}/api/videos/${video.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      const detected = data.products || [];
      if (!detected.length) {
        setAiError("Couldn't identify a product in this video.");
        setAiStep('idle');
        return;
      }
      // Show all results with confidence + a single Apply button
      setAiResults(detected.map(p => ({
        title: p.title || '',
        category: p.category || '',
        color: p.suggested_color || '',
        confidence: p.confidence ?? null,
        suggested_match_id: p.matched_shopify_product_id || null,
      })));
      setAiStep('review');
    } catch (err) {
      setAiError(err.message);
      setAiStep('idle');
    } finally {
      setAiBusy(false);
    }
  }

  async function runAiCreate() {
    if (!confirm('AI Create — generate a new Shopify product from this video?')) return;
    setAiCreateBusy(true);
    try {
      const res = await fetch(`${API}/api/videos/${video.id}/create-product`, { method: 'POST' });
      if (res.ok) {
        const fresh = await res.json();
        onChange && onChange(fresh);
      }
    } finally { setAiCreateBusy(false); }
  }

  async function doDelete() {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    await fetch(`${API}/api/videos/${video.id}`, { method: 'DELETE' });
    onDelete && onDelete(video.id);
  }

  // ── Filtered product list ──────────────────────────────────────────────
  // Wildcard search: case-insensitive substring across title, product_type,
  // tags, vendor. Filter mode narrows by collection or tag.
  const filtered = (() => {
    let list = products || [];
    if (filterMode === 'collection' && filterValue) {
      list = list.filter(p => (p.collections || []).includes(filterValue));
    } else if (filterMode === 'tag' && filterValue) {
      list = list.filter(p => (p.tags || []).includes(filterValue));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => {
        if ((p.title || '').toLowerCase().includes(q)) return true;
        if ((p.product_type || '').toLowerCase().includes(q)) return true;
        if ((p.vendor || '').toLowerCase().includes(q)) return true;
        if ((p.tags || []).some(t => String(t).toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return list.slice(0, 80);
  })();

  const taggedIds = new Set(tags.map(t => String(t.shopify_product_id)));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100">
        {editingCaption ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              rows={2}
              value={caption}
              maxLength={250}
              onChange={e => setCaption(e.target.value)}
              className="text-sm border border-gray-200 rounded-md p-2 outline-none resize-none focus:border-indigo-400"
            />
            <div className="flex gap-2">
              <button onClick={saveCaption} className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white">Save</button>
              <button onClick={() => { setEditingCaption(false); setCaption(video.title || ''); }} className="text-xs px-3 py-1.5 rounded-md text-gray-500">Cancel</button>
            </div>
          </div>
        ) : (
          <div onClick={() => setEditingCaption(true)} className="cursor-pointer group">
            <p className="text-base font-semibold text-gray-900 leading-snug">
              {video.title?.trim() || <span className="text-gray-400 italic">No caption — tap to add</span>}
            </p>
            <p className="text-[11px] text-gray-400 mt-1 group-hover:text-indigo-500">
              {video.status === 'active' ? 'Live on storefront' : 'Hidden'} · click to edit caption
            </p>
          </div>
        )}
      </div>

      {/* Tagged products */}
      <div className="px-5 py-3 border-b border-gray-100">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
          Tagged products <span className="text-gray-700">{tags.length}</span>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-gray-400">No products tagged. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {tags.map(t => {
              // Confidence comes from AI auto-tag flow, stored on the tag row
              const confPct = t.confidence != null ? Math.round(t.confidence * 100) : null;
              const editUrl = shopifyDomain && t.shopify_product_id
                ? `https://${shopifyDomain}/admin/products/${t.shopify_product_id}`
                : null;
              return (
                <div key={t.id} className="flex items-center gap-2.5 bg-gray-50 rounded-lg p-2">
                  {t.image_url && (
                    <img src={t.image_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{t.product_name}</p>
                    <div className="text-[10px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span>{fmt$(t.price)}</span>
                      {confPct != null && (
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${confPct >= 70 ? 'bg-emerald-100 text-emerald-700' : confPct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {confPct}% AI
                        </span>
                      )}
                    </div>
                  </div>
                  {editUrl && (
                    <a
                      href={editUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Edit product on Shopify"
                      className="text-gray-400 hover:text-indigo-600 text-[11px]">
                      ↗
                    </a>
                  )}
                  <button onClick={() => removeTag(t.id)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add product */}
      <div className="px-5 py-3 border-b border-gray-100 flex-1 overflow-hidden flex flex-col">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Add product</div>

        {/* Search + filter mode */}
        <div className="flex gap-2 mb-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, tag, or type…"
            className="flex-1 text-xs border border-gray-200 rounded-md px-2.5 py-2 outline-none focus:border-indigo-400"
          />
          <select
            value={filterMode}
            onChange={e => { setFilterMode(e.target.value); setFilterValue(''); }}
            className="text-xs border border-gray-200 rounded-md px-2 py-2"
          >
            <option value="all">All ({(products || []).length})</option>
            <option value="collection">By collection ({(collections || []).length})</option>
            <option value="tag">By tag ({(allTags || []).length})</option>
          </select>
        </div>

        {/* Filter value picker — collection or tag dropdown */}
        {filterMode === 'collection' && (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-2 mb-2 w-full">
            <option value="">Pick a collection… ({(collections || []).length})</option>
            {(collections || []).map(c => (
              <option key={c.id || c.handle} value={c.handle}>
                {c.title || c.handle}{c.products_count ? ` (${c.products_count})` : ''}
              </option>
            ))}
          </select>
        )}
        {filterMode === 'tag' && (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-2 mb-2 w-full">
            <option value="">Pick a tag… ({(allTags || []).length})</option>
            {(allTags || []).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.map(p => {
            const tagged = taggedIds.has(String(p.id));
            const editUrl = shopifyDomain && p.id ? `https://${shopifyDomain}/admin/products/${p.id}` : null;
            return (
              <div key={p.id} className={`flex items-center gap-2.5 rounded-lg p-2 border ${tagged ? 'border-gray-100 bg-gray-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                {p.image && (
                  <img src={p.image} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{p.title}</p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {p.price ? `$${parseFloat(p.price).toFixed(2)}` : ''}
                    {p.product_type ? ` · ${p.product_type}` : ''}
                  </p>
                </div>
                {editUrl && (
                  <a href={editUrl} target="_blank" rel="noopener noreferrer" title="Edit on Shopify" className="text-gray-300 hover:text-indigo-600 text-[11px] mr-1">↗</a>
                )}
                <button
                  disabled={tagged}
                  onClick={() => addProduct(p)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${tagged ? 'text-gray-400' : 'text-indigo-600 hover:bg-indigo-50'}`}>
                  {tagged ? 'Tagged' : 'Add'}
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-3">
              {search || filterValue ? 'No products match.' : 'No products loaded yet.'}
            </div>
          )}
        </div>

        <button
          onClick={runAiCreate}
          disabled={aiCreateBusy}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold py-2 mt-2 disabled:opacity-50">
          {aiCreateBusy ? 'AI generating…' : '✨ AI Create new product from this video →'}
        </button>
      </div>

      {/* AI auto-tag results panel */}
      {(aiResults.length > 0 || aiError) && (
        <div className="px-5 py-3 border-b border-gray-100 bg-indigo-50/40">
          <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider mb-2">
            AI detected {aiResults.length || 0}
          </div>
          {aiError && <p className="text-xs text-red-600 mb-2">{aiError}</p>}
          {aiResults.map((r, i) => {
            const confPct = r.confidence != null ? Math.round(r.confidence * 100) : null;
            return (
              <div key={i} className="text-xs text-gray-800 py-1 flex items-center gap-2">
                <span className="flex-1 truncate">{r.title || '(no title)'}{r.color ? ` · ${r.color}` : ''}</span>
                {confPct != null && (
                  <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${confPct >= 70 ? 'bg-emerald-100 text-emerald-700' : confPct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {confPct}%
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-gray-500 mt-2">
            Detections shown above. Use the search to find + tag matching products from your catalog.
          </p>
        </div>
      )}

      {/* Bottom actions */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
        <button
          onClick={runAiTag}
          disabled={aiBusy}
          className="w-full text-xs px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          {aiStep === 'extracting' ? '📷 Extracting frames…' :
            aiStep === 'analysing' ? '🤖 Analysing video…' :
            '🤖 AI auto-tag from video'}
        </button>
        <button
          onClick={toggleStatus}
          className="w-full text-xs px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50">
          {video.status === 'active' ? '◌ Hide from storefront' : '✓ Show on storefront'}
        </button>
        <button
          onClick={doDelete}
          className="w-full text-xs px-3 py-2 rounded-md text-red-600 hover:bg-red-50 font-semibold">
          Delete video
        </button>
      </div>
    </div>
  );
}

export default function VideoPreviewPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState(null);
  const [shopifyDomain, setShopifyDomain] = useState(null);
  const [videos, setVideos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [allProductTags, setAllProductTags] = useState([]);
  const [copied, setCopied] = useState(false);
  const supabase = createClient();
  const scrollRef = useRef(null);

  // Read ?v=<id> from URL — used to jump straight to a specific
  // video when the merchant follows a deep link or hits Back/Forward.
  function getDeepLinkId() {
    if (typeof window === 'undefined') return null;
    return new URL(window.location.href).searchParams.get('v');
  }

  // Push the active video into the URL (replaceState so back-button
  // navigates videos in scroll order without polluting history).
  function syncUrlForVideo(v) {
    if (!v || typeof window === 'undefined') return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('v') === String(v.id)) return;
      u.searchParams.set('v', v.id);
      window.history.replaceState(null, '', u.toString());
    } catch (_) {}
  }

  function copyDeepLink(v) {
    if (!v || typeof window === 'undefined') return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('v', v.id);
      navigator.clipboard.writeText(u.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {}
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setMerchantId(user.id);

      const [vRes, mRes] = await Promise.all([
        fetch(`${API}/api/merchants/${user.id}/videos`),
        fetch(`${API}/api/merchants/${user.id}`),
      ]);
      if (vRes.ok) {
        const list = await vRes.json();
        // Sort: active first, then videos with s3_url, then by created
        list.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          const aHas = !!a.s3_url, bHas = !!b.s3_url;
          if (aHas !== bHas) return aHas ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setVideos(list);
        if (list.length) {
          // Honor deep-link ?v=<id> if present and matches a real video
          const deepId = getDeepLinkId();
          const target = deepId ? list.find(v => String(v.id) === deepId) : null;
          setActiveVideo(target || list[0]);
        }
      }
      if (mRes.ok) {
        const m = await mRes.json();
        // shopify_domain is the *.myshopify.com host — used for Edit-on-Shopify
        // links since /admin/products/:id is keyed off that host.
        setShopifyDomain(m.shopify_domain || null);
      }

      // Load Shopify products + collections via the merchant-authed API,
      // not public /products.json. This gives us tags + collection
      // membership per product, which the filter dropdowns need.
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`${API}/api/merchants/${user.id}/shopify-products`),
          fetch(`${API}/api/merchants/${user.id}/shopify-collections`),
        ]);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (!pData.error) {
            setProducts(pData.products || []);
            const tagSet = new Set();
            (pData.products || []).forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
            setAllProductTags([...tagSet].sort());
          }
        }
        if (cRes.ok) {
          const cData = await cRes.json();
          setCollections(cData.collections || []);
        }
      } catch (_) {}

      setLoading(false);
    })();
  }, []);

  const handleIntersect = useCallback((v) => {
    setActiveVideo(v);
    syncUrlForVideo(v);
  }, []);

  // After videos load, if a deep-link ?v=<id> matches one further down
  // the list, scroll to it (the snap container otherwise opens at top).
  useEffect(() => {
    if (!videos.length || !activeVideo || !scrollRef.current) return;
    const idx = videos.findIndex(v => v.id === activeVideo.id);
    if (idx <= 0) return;                    // top → already there
    const slide = scrollRef.current.children[idx];
    if (slide) slide.scrollIntoView({ behavior: 'auto', block: 'start' });
    // Run once on first load with deep-link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length]);

  // Browser back/forward → re-sync active slide to ?v=<id>
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onPop() {
      const id = getDeepLinkId();
      if (!id || !videos.length || !scrollRef.current) return;
      const idx = videos.findIndex(v => String(v.id) === id);
      if (idx < 0) return;
      const slide = scrollRef.current.children[idx];
      if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [videos]);

  const updateVideo = useCallback((updated) => {
    setVideos(prev => prev.map(v => v.id === updated.id ? { ...v, ...updated } : v));
    setActiveVideo(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev);
  }, []);

  const removeVideo = useCallback((id) => {
    setVideos(prev => {
      const next = prev.filter(v => v.id !== id);
      if (next.length) setActiveVideo(next[0]);
      return next;
    });
  }, []);

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading videos…</div>;
  }
  if (!videos.length) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-2">No videos yet</h2>
        <p className="text-sm text-gray-500 mb-4">Import or upload videos first, then come back to scroll-edit.</p>
        <button onClick={() => router.push('/dashboard/videos')} className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white">
          Go to Video bot →
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-50 flex" style={{ paddingLeft: 240 }}>
      {/* Left: vertical scroll feed (snap) */}
      <div className="flex-1 relative">
        <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
          <button onClick={() => router.push('/dashboard/videos')} className="text-xs px-3 py-1.5 rounded-md bg-white shadow border border-gray-200 hover:bg-gray-50">
            ← Back to library
          </button>
          <button onClick={() => setMuted(m => !m)} className="text-xs px-3 py-1.5 rounded-md bg-white shadow border border-gray-200">
            {muted ? '🔇 Muted' : '🔊 Sound on'}
          </button>
          <button
            onClick={() => copyDeepLink(activeVideo)}
            disabled={!activeVideo}
            className="text-xs px-3 py-1.5 rounded-md bg-white shadow border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            title="Copy a deep link to this exact video">
            {copied ? '✓ Copied' : '🔗 Copy link'}
          </button>
        </div>

        <div
          ref={scrollRef}
          className="h-full overflow-y-scroll snap-y snap-mandatory bg-black"
          style={{ scrollSnapType: 'y mandatory' }}>
          {videos.map(v => (
            <div key={v.id} className="h-full w-full">
              <VideoSlide
                video={v}
                isActive={activeVideo && activeVideo.id === v.id}
                muted={muted}
                onIntersect={handleIntersect}
              />
            </div>
          ))}
        </div>

        {/* Hint at bottom */}
        <div className="absolute bottom-4 right-4 text-[11px] text-white/60 bg-black/40 px-3 py-1.5 rounded-full pointer-events-none">
          ↕ Scroll to navigate · {videos.findIndex(v => activeVideo && v.id === activeVideo.id) + 1} of {videos.length}
        </div>
      </div>

      {/* Right: edit panel for the active slide */}
      <div className="w-[400px] flex-shrink-0 bg-white border-l border-gray-100 shadow-lg">
        {activeVideo ? (
          <EditPanel
            key={activeVideo.id}
            video={activeVideo}
            merchantId={merchantId}
            shopifyDomain={shopifyDomain}
            products={products}
            collections={collections}
            allTags={allProductTags}
            onChange={updateVideo}
            onDelete={removeVideo}
          />
        ) : (
          <div className="p-5 text-sm text-gray-400">Select a video</div>
        )}
      </div>
    </div>
  );
}
