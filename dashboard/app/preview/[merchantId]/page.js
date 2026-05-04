'use client';
import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Public, shareable preview at /preview/[merchantId]
// Renders the vertical TikTok-style shoppable feed exactly as customers see it.
// Custom React (not the storefront widget) so we control the layout cleanly.
export default function PreviewPage({ params }) {
  const { merchantId } = params;
  const [merchant, setMerchant] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Honor ?btgv=VIDEO_ID deep link by scrolling to that video on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mRes = await fetch(`${API}/api/merchants/${merchantId}`);
        if (!mRes.ok) throw new Error('Merchant not found');
        const m = await mRes.json();
        if (cancelled) return;
        setMerchant(m);

        if (!m.api_key) throw new Error('This merchant has no API key yet.');
        const vRes = await fetch(`${API}/api/widget/videos?k=${m.api_key}`);
        if (!vRes.ok) throw new Error('Failed to load videos');
        const vids = await vRes.json();
        if (cancelled) return;
        setVideos(vids || []);

        // Deep-link to specific video if ?btgv=ID is in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const targetId = urlParams.get('btgv');
        if (targetId) {
          const idx = (vids || []).findIndex(v => v.id === targetId);
          if (idx >= 0) {
            setActiveIdx(idx);
            // Scroll after first paint
            setTimeout(() => {
              document.getElementById(`feed-slide-${targetId}`)?.scrollIntoView({ behavior: 'auto' });
            }, 100);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId]);

  function copyShareLink() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(window.location.origin + `/preview/${merchantId}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-3xl mb-3">😕</div>
          <p className="text-gray-700 font-medium">Couldn't load preview</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Top bar (preview chrome — not on real storefront) */}
      <div className="bg-white/95 backdrop-blur border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {merchant?.logo_url && (
              <img src={merchant.logo_url} alt="" className="w-7 h-7 rounded object-cover bg-white border border-gray-100 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{merchant?.name || 'Preview'}</div>
              <div className="text-[11px] text-gray-500 truncate">Customer view · Botiga shoppable feed</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={copyShareLink}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full text-white"
              style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)' }}
              title="Copy a public link to share"
            >
              {copied ? '✓ Copied' : '🔗 Share'}
            </button>
            <a
              href="/dashboard/videos"
              className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-gray-900 hover:bg-gray-800 text-white transition-colors"
            >
              ← Dashboard
            </a>
          </div>
        </div>
      </div>

      {/* Feed — vertical scroll snap */}
      <div className="max-w-md mx-auto bg-black">
        {loading ? (
          <div className="h-screen flex items-center justify-center text-gray-400 text-sm">Loading feed…</div>
        ) : videos.length === 0 ? (
          <div className="h-screen flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
            <span className="text-3xl">🎬</span>
            <p>No videos yet</p>
            <a href="/dashboard/videos" className="text-xs text-indigo-300 underline">Add some →</a>
          </div>
        ) : (
          <div
            className="h-[100dvh] overflow-y-scroll snap-y snap-mandatory"
            style={{ scrollbarWidth: 'none' }}
          >
            <style>{`
              .feed-scroll::-webkit-scrollbar { display: none }
            `}</style>
            {videos.map((v, idx) => (
              <FeedSlide
                key={v.id}
                video={v}
                isActive={idx === activeIdx}
                onActive={() => setActiveIdx(idx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// One full-screen video slide in the feed
function FeedSlide({ video, isActive, onActive }) {
  const videoRef = useRef(null);
  const slideRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false);

  // Auto-pause when out of view, autoplay when scrolled into view
  useEffect(() => {
    if (!slideRef.current || !videoRef.current) return;
    const el = videoRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          el.play().catch(() => {});
          onActive();
        } else {
          el.pause();
        }
      },
      { threshold: [0.5] }
    );
    observer.observe(slideRef.current);
    return () => observer.disconnect();
  }, [onActive]);

  const tags = video.video_product_tags || [];
  const firstTag = tags[0];

  return (
    <div
      ref={slideRef}
      id={`feed-slide-${video.id}`}
      className="snap-start h-[100dvh] w-full relative bg-black flex items-center justify-center overflow-hidden"
    >
      {/* Media — video if s3_url present, else thumbnail image */}
      {video.s3_url ? (
        <video
          ref={videoRef}
          src={video.s3_url}
          loop
          muted={muted}
          playsInline
          className="w-full h-full object-cover"
        />
      ) : video.thumbnail_url ? (
        <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="text-white/40 text-sm">No preview</div>
      )}

      {/* Gradient overlays for legibility */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

      {/* Right-side action rail (like + share + mute) */}
      <div className="absolute right-3 bottom-32 flex flex-col items-center gap-4 z-10">
        <button
          onClick={() => setLiked(l => !l)}
          className="w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-2xl text-white hover:scale-110 transition-transform"
          aria-label="Like"
        >
          {liked ? '❤️' : '🤍'}
        </button>
        <button
          onClick={() => navigator.share ? navigator.share({ url: window.location.href }) : navigator.clipboard.writeText(window.location.href)}
          className="w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-xl text-white hover:scale-110 transition-transform"
          aria-label="Share"
        >
          ↗
        </button>
        {video.s3_url && (
          <button
            onClick={() => setMuted(m => !m)}
            className="w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-lg text-white hover:scale-110 transition-transform"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
      </div>

      {/* Bottom — caption + product card with action buttons */}
      <div className="absolute inset-x-3 bottom-3 z-10">
        {video.title && (
          <p className="text-white text-sm leading-snug mb-3 line-clamp-2 drop-shadow-md max-w-[80%]">
            {video.title}
          </p>
        )}

        {firstTag ? (
          <div className="bg-white/95 backdrop-blur rounded-xl p-2.5 flex items-center gap-3 shadow-lg">
            {firstTag.image_url ? (
              <img src={firstTag.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{firstTag.product_name}</div>
              <div className="text-xs text-gray-600">
                {firstTag.price != null && <span className="font-medium">${firstTag.price}</span>}
                {firstTag.compare_at_price && firstTag.compare_at_price > firstTag.price && (
                  <span className="ml-2 text-gray-400 line-through">${firstTag.compare_at_price}</span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <ActionBtn label="🛒" subtle title="Add to cart" />
              <ActionBtn label="⚡" buy title="Buy now" />
              <ActionBtn label="🤝" negotiate title="Negotiate" />
            </div>
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur border border-white/15 rounded-xl px-3 py-2 text-white/70 text-xs">
            No products tagged yet
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, title, subtle, buy, negotiate }) {
  let style = {};
  if (subtle) {
    style = {
      background: 'rgba(255,255,255,.85)',
      color: '#111',
      border: '1px solid rgba(0,0,0,.08)',
    };
  } else if (buy) {
    style = {
      background: 'linear-gradient(135deg,#FF6B35 0%,#F72585 100%)',
      color: '#fff',
      boxShadow: '0 4px 14px rgba(247,37,133,.32)',
    };
  } else if (negotiate) {
    style = {
      background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)',
      color: '#fff',
      boxShadow: '0 4px 14px rgba(247,37,133,.36)',
    };
  }
  return (
    <button
      title={title}
      style={style}
      className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-semibold hover:scale-105 transition-transform"
    >
      {label}
    </button>
  );
}
