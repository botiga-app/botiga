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

function EditPanel({ video, merchantId, allProducts, onChange, onDelete, onAdvance }) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(video.title || '');
  const [search, setSearch] = useState('');
  const [productCategory, setProductCategory] = useState('all');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCreateBusy, setAiCreateBusy] = useState(false);

  // Reset when active video changes
  useEffect(() => { setCaption(video.title || ''); setEditingCaption(false); setSearch(''); }, [video.id]);

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

  async function addProduct(p) {
    const body = {
      shopify_product_id: String(p.id),
      product_name: p.title,
      price: p.variants?.[0]?.price || 0,
      compare_at_price: p.variants?.[0]?.compare_at_price || 0,
      handle: p.handle,
      image_url: p.images?.[0]?.src || p.image?.src || '',
      shopify_variant_id: p.variants?.[0]?.id || null,
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

  async function runAiTag() {
    setAiBusy(true);
    try {
      await fetch(`${API}/api/videos/${video.id}/analyze`, { method: 'POST' });
      // Refresh by re-fetching video
      const r = await fetch(`${API}/api/videos/${video.id}`);
      if (r.ok) {
        const fresh = await r.json();
        onChange && onChange(fresh);
      }
    } finally { setAiBusy(false); }
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

  // Product search filter
  const filtered = (allProducts || []).filter(p => {
    if (productCategory !== 'all' && (p.product_type || '').toLowerCase() !== productCategory) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.title || '').toLowerCase().includes(q) || (p.product_type || '').toLowerCase().includes(q);
  }).slice(0, 60);

  // Distinct product types for the filter pills
  const allTypes = Array.from(new Set((allProducts || []).map(p => (p.product_type || '').trim()).filter(Boolean))).slice(0, 8);

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
            {tags.map(t => (
              <div key={t.id} className="flex items-center gap-2.5 bg-gray-50 rounded-lg p-2">
                {t.image_url && (
                  <img src={t.image_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{t.product_name}</p>
                  <p className="text-[10px] text-gray-500">{fmt$(t.price)}</p>
                </div>
                <button onClick={() => removeTag(t.id)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add product */}
      <div className="px-5 py-3 border-b border-gray-100 flex-1 overflow-hidden flex flex-col">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Add product</div>
        <div className="flex gap-2 mb-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products by name…"
            className="flex-1 text-xs border border-gray-200 rounded-md px-2.5 py-2 outline-none focus:border-indigo-400"
          />
          <select
            value={productCategory}
            onChange={e => setProductCategory(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-2"
          >
            <option value="all">All ({(allProducts || []).length})</option>
            {allTypes.map(t => <option key={t} value={t.toLowerCase()}>{t}</option>)}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.map(p => {
            const tagged = taggedIds.has(String(p.id));
            return (
              <div key={p.id} className={`flex items-center gap-2.5 rounded-lg p-2 border ${tagged ? 'border-gray-100 bg-gray-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                {(p.images?.[0]?.src || p.image?.src) && (
                  <img src={p.images?.[0]?.src || p.image?.src} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{p.title}</p>
                  <p className="text-[10px] text-gray-500">
                    {fmt$(p.variants?.[0]?.price)}{p.product_type ? ` · ${p.product_type}` : ''}
                  </p>
                </div>
                <button
                  disabled={tagged}
                  onClick={() => addProduct(p)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${tagged ? 'text-gray-400' : 'text-indigo-600 hover:bg-indigo-50'}`}>
                  {tagged ? 'Tagged' : 'Add'}
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && search && (
            <div className="text-xs text-gray-400 text-center py-3">
              No products match "{search}".
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

      {/* Bottom actions */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
        <button
          onClick={runAiTag}
          disabled={aiBusy}
          className="w-full text-xs px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          {aiBusy ? 'Analyzing…' : '🤖 AI auto-tag from video'}
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
  const [allProducts, setAllProducts] = useState([]);
  const supabase = createClient();
  const scrollRef = useRef(null);

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
        if (list.length) setActiveVideo(list[0]);
      }
      if (mRes.ok) {
        const m = await mRes.json();
        const dom = m.shopify_domain || m.source_url || null;
        setShopifyDomain(dom);
        if (dom) {
          // Pull product catalog for the Add Product search
          try {
            const url = m.source_url ? m.source_url.replace(/\/+$/, '') : `https://${m.shopify_domain}`;
            const cRes = await fetch(`${url}/products.json?limit=250`);
            if (cRes.ok) {
              const data = await cRes.json();
              setAllProducts(data.products || []);
            }
          } catch (_) {}
        }
      }
      setLoading(false);
    })();
  }, []);

  const handleIntersect = useCallback((v) => setActiveVideo(v), []);

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
            allProducts={allProducts}
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
