'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabase';
import VideoEditPanel from '../../../../components/video-edit/VideoEditPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Vertical-scroll merchant editor. The right-side panel is the EXACT
// same VideoEditPanel the grid drawer (/dashboard/videos) renders —
// only the left-side feed differs (snap-scroll vs single video player).
// One source of truth, no UI drift.

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
      className="snap-start h-full w-full flex items-center justify-center bg-black relative py-6"
      style={{ scrollSnapAlign: 'start' }}
    >
      {/* Cap the video to ~80% of viewport height so it has breathing room
          top/bottom — full-height portrait video felt overwhelming and clipped
          at the seams. The wrapper preserves aspect ratio via object-contain. */}
      {hasVideo ? (
        <video
          ref={videoRef}
          src={video.s3_url}
          poster={video.thumbnail_url || undefined}
          loop
          playsInline
          muted={muted}
          preload={isActive ? 'auto' : 'metadata'}
          className="max-h-[88%] max-w-full object-contain rounded-lg"
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
          className="max-h-[88%] max-w-full object-contain rounded-lg"
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


export default function VideoPreviewPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState(null);
  const [shopifyDomain, setShopifyDomain] = useState(null);
  const [videos, setVideos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
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

      {/* Right: shared VideoEditPanel — same component the grid drawer uses */}
      <div className="w-[440px] flex-shrink-0 bg-white border-l border-gray-100 shadow-lg flex flex-col">
        {activeVideo ? (
          <VideoEditPanel
            key={activeVideo.id}
            video={activeVideo}
            merchantId={merchantId}
            shopifyDomain={shopifyDomain}
            onTagsUpdated={async (videoId, tagsOrFn) => {
              // Match the panel's API exactly: it calls with (videoId, nextTagsArray).
              // Resolve callback form too (from AiTagger).
              const target = videos.find(v => v.id === videoId);
              const nextTags = typeof tagsOrFn === 'function'
                ? tagsOrFn(target?.video_product_tags || [])
                : tagsOrFn;
              updateVideo({ id: videoId, video_product_tags: nextTags });
            }}
            onDelete={async (videoId) => {
              await fetch(`${API}/api/videos/${videoId}`, { method: 'DELETE' });
              removeVideo(videoId);
            }}
            onToggleStatus={async (videoId, nextStatus) => {
              // VideoDetailDrawer uses 'active' / 'inactive'; the API accepts both
              // 'active' and 'hidden'. Normalize to API expectation.
              const apiStatus = nextStatus === 'inactive' ? 'hidden' : nextStatus;
              await fetch(`${API}/api/videos/${videoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: apiStatus }),
              });
              updateVideo({ id: videoId, status: apiStatus });
            }}
            showCloseButton={false}
          />
        ) : (
          <div className="p-5 text-sm text-gray-400">Select a video</div>
        )}
      </div>
    </div>
  );
}
