'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabase';
import AiTagger from '../../../../components/video-edit/AiTagger';
import ProductPicker from '../../../../components/video-edit/ProductPicker';
import TagRow from '../../../../components/video-edit/TagRow';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Vertical-scroll merchant editor. Same edit power as the grid page —
// every component is shared from /dashboard/components/video-edit/ so
// "AI auto-tag", "Add product", and the Shopify edit links behave
// identically in both surfaces.

function fmt$(n) { if (n == null) return '—'; return '$' + Number(n).toFixed(2); }

function VideoSlide({ video, isActive, muted, onIntersect }) {
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
    } else {
      videoRef.current.pause();
    }
  }, [isActive, muted]);

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

function EditPanel({ video, merchantId, shopifyDomain, onChange, onDelete, onOpenAiTagger }) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(video.title || '');
  const [autoMatching, setAutoMatching] = useState(false);
  const [autoMatchSummary, setAutoMatchSummary] = useState(null);

  // Reset when active video changes
  useEffect(() => {
    setCaption(video.title || '');
    setEditingCaption(false);
    setAutoMatchSummary(null);
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

  async function doDelete() {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    await fetch(`${API}/api/videos/${video.id}`, { method: 'DELETE' });
    onDelete && onDelete(video.id);
  }

  // AI auto-match — runs analyzeAndTag() on this video. Adds tags
  // with match_status='auto_tagged' (≥0.5) or 'pending_review' (0.3-0.5)
  // which then render via TagRow with the Accept/Reject buttons. Different
  // from AI Create (which generates NEW Shopify draft products).
  async function runAiAutoMatch() {
    setAutoMatching(true);
    setAutoMatchSummary(null);
    try {
      const r = await fetch(`${API}/api/videos/${video.id}/auto-tag`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        setAutoMatchSummary({ error: d.error || `Server returned ${r.status}` });
        return;
      }
      setAutoMatchSummary({
        status: d.status,
        match_score: d.match_score,
        message: d.status === 'auto_tagged'
          ? `✓ Auto-tagged (${Math.round((d.match_score || 0) * 100)}% match)`
          : d.status === 'pending_review'
          ? `⚠ Pending review — confirm below (${Math.round((d.match_score || 0) * 100)}% match)`
          : d.status === 'skipped'
          ? `No strong match in your catalog. Try AI Create instead.`
          : d.status === 'no_analysis'
          ? `Couldn't analyze video. Make sure thumbnails are loaded.`
          : `Done.`,
      });
      // Re-fetch video to pull in any new/updated tags
      const fresh = await fetch(`${API}/api/videos/${video.id}`);
      if (fresh.ok) {
        const v = await fresh.json();
        onChange && onChange(v);
      }
    } catch (err) {
      setAutoMatchSummary({ error: err.message });
    } finally {
      setAutoMatching(false);
    }
  }

  function onTagRemoved(tagId) {
    const nextTags = (video.video_product_tags || []).filter(t => t.id !== tagId);
    onChange && onChange({ ...video, video_product_tags: nextTags });
  }

  function onTagUpdated(updated) {
    const nextTags = (video.video_product_tags || []).map(t => t.id === updated.id ? updated : t);
    onChange && onChange({ ...video, video_product_tags: nextTags });
  }

  const taggedIds = new Set(tags.map(t => String(t.shopify_product_id)));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Caption */}
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

      {/* Tagged products — same TagRow used by the grid view, so REVIEW
          status surfaces with ✓ Accept / Reject buttons identically. */}
      <div className="px-5 py-3 border-b border-gray-100">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
          Tagged products <span className="text-gray-700">{tags.length}</span>
        </div>
        {autoMatchSummary && (
          <div className={`text-[11px] rounded-md px-2.5 py-1.5 mb-2 ${autoMatchSummary.error ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-indigo-50 text-indigo-800 border border-indigo-100'}`}>
            {autoMatchSummary.error ? `Error: ${autoMatchSummary.error}` : autoMatchSummary.message}
          </div>
        )}
        {tags.length === 0 ? (
          <p className="text-xs text-gray-400">No products tagged. Run AI auto-match below or add one manually.</p>
        ) : (
          <div className="space-y-2">
            {tags.map(t => (
              <TagRow
                key={t.id}
                tag={t}
                videoId={video.id}
                merchantId={merchantId}
                shopifyDomain={shopifyDomain}
                onRemoved={() => onTagRemoved(t.id)}
                onUpdated={(updated) => onTagUpdated(updated)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add product — uses the shared ProductPicker, identical to grid view */}
      <div className="px-5 py-3 border-b border-gray-100 flex-1 overflow-hidden flex flex-col">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Add product</div>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          <ProductPicker
            video={video}
            merchantId={merchantId}
            shopifyDomain={shopifyDomain}
            existingTagIds={taggedIds}
            onTagAdded={(newTag) => {
              const nextTags = [...(video.video_product_tags || []), newTag];
              onChange && onChange({ ...video, video_product_tags: nextTags });
            }}
          />
        </div>
      </div>

      {/* Bottom actions — AI auto-match and AI Create are DIFFERENT.
          Auto-match: finds existing catalog products that match the video.
          Create:     generates new Shopify draft products from the video. */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
        <button
          onClick={runAiAutoMatch}
          disabled={autoMatching}
          className="w-full text-xs px-3 py-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 font-semibold">
          {autoMatching ? '🔍 Matching against catalog…' : '🔍 AI auto-match this video'}
        </button>
        <button
          onClick={onOpenAiTagger}
          className="w-full text-xs px-3 py-2 rounded-md text-white font-semibold"
          style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)' }}>
          ✨ AI Create new product
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
  const [aiTaggerOpen, setAiTaggerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const supabase = createClient();
  const scrollRef = useRef(null);

  function getDeepLinkId() {
    if (typeof window === 'undefined') return null;
    return new URL(window.location.href).searchParams.get('v');
  }
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
        list.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          const aHas = !!a.s3_url, bHas = !!b.s3_url;
          if (aHas !== bHas) return aHas ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setVideos(list);
        if (list.length) {
          const deepId = getDeepLinkId();
          const target = deepId ? list.find(v => String(v.id) === deepId) : null;
          setActiveVideo(target || list[0]);
        }
      }
      if (mRes.ok) {
        const m = await mRes.json();
        setShopifyDomain(m.shopify_domain || null);
      }
      setLoading(false);
    })();
  }, []);

  const handleIntersect = useCallback((v) => {
    setActiveVideo(v);
    syncUrlForVideo(v);
  }, []);

  // Scroll to deep-linked video on first load
  useEffect(() => {
    if (!videos.length || !activeVideo || !scrollRef.current) return;
    const idx = videos.findIndex(v => v.id === activeVideo.id);
    if (idx <= 0) return;
    const slide = scrollRef.current.children[idx];
    if (slide) slide.scrollIntoView({ behavior: 'auto', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length]);

  // Browser back/forward syncs ?v=
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

  // After AiTagger creates products, append them to the active video's tags
  const handleTagsUpdated = useCallback((videoId, tagsOrFn) => {
    setVideos(prev => prev.map(v => {
      if (v.id !== videoId) return v;
      const current = v.video_product_tags || [];
      const next = typeof tagsOrFn === 'function' ? tagsOrFn(current) : tagsOrFn;
      return { ...v, video_product_tags: next };
    }));
    setActiveVideo(prev => {
      if (!prev || prev.id !== videoId) return prev;
      const current = prev.video_product_tags || [];
      const next = typeof tagsOrFn === 'function' ? tagsOrFn(current) : tagsOrFn;
      return { ...prev, video_product_tags: next };
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

        <div className="absolute bottom-4 right-4 text-[11px] text-white/60 bg-black/40 px-3 py-1.5 rounded-full pointer-events-none">
          ↕ Scroll · {videos.findIndex(v => activeVideo && v.id === activeVideo.id) + 1} of {videos.length}
        </div>
      </div>

      {/* Right: edit panel */}
      <div className="w-[400px] flex-shrink-0 bg-white border-l border-gray-100 shadow-lg">
        {activeVideo ? (
          <EditPanel
            key={activeVideo.id}
            video={activeVideo}
            merchantId={merchantId}
            shopifyDomain={shopifyDomain}
            onChange={updateVideo}
            onDelete={removeVideo}
            onOpenAiTagger={() => setAiTaggerOpen(true)}
          />
        ) : (
          <div className="p-5 text-sm text-gray-400">Select a video</div>
        )}
      </div>

      {/* Shared AiTagger modal — same component the grid page uses */}
      {aiTaggerOpen && activeVideo && (
        <AiTagger
          video={activeVideo}
          merchantId={merchantId}
          onTagsUpdated={handleTagsUpdated}
          onClose={() => setAiTaggerOpen(false)}
        />
      )}
    </div>
  );
}
