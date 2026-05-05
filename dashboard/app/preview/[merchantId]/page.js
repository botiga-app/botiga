'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://api.botiga.ai';

// Persistent per-browser id so the API can dedupe / attribute events.
function sessionId() {
  if (typeof window === 'undefined') return null;
  let id = localStorage.getItem('_btgv_sid');
  if (!id) {
    id = (crypto?.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    localStorage.setItem('_btgv_sid', id);
  }
  return id;
}

// Full-screen heart particle burst. Each call spawns a stagger of 6-10 hearts
// that float up from the bottom-third of the viewport with random drift,
// rotation, and fade. Fires for both the user's own click (instant) and for
// other users' likes (via Supabase Realtime UPDATE on videos.likes_count).
const HEART_GLYPHS = ['❤️', '🧡', '💕', '💗', '💖', '💓', '💝', '🌟'];
function spawnHearts(burstSize) {
  if (typeof document === 'undefined') return;
  const count = burstSize || (6 + Math.floor(Math.random() * 5));
  for (let i = 0; i < count; i++) {
    const delay = i * 70;
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = '_btgv_heart';
      el.textContent = HEART_GLYPHS[Math.floor(Math.random() * HEART_GLYPHS.length)];
      const size = 22 + Math.random() * 44;
      // Spawn from a "thumb-up" zone — bottom-right cluster, drifting up + slightly left
      const startX = window.innerWidth - 80 - Math.random() * 60;
      const startY = window.innerHeight - 140 - Math.random() * 80;
      const dx = -40 - Math.random() * 100;
      const dy = -(window.innerHeight * (0.55 + Math.random() * 0.35));
      const dur = (1.6 + Math.random() * 1.2).toFixed(2);
      const rot = ((Math.random() - 0.5) * 30).toFixed(1);
      const rot2 = ((Math.random() - 0.5) * 60).toFixed(1);
      el.style.cssText =
        `position:fixed;left:${startX}px;top:${startY}px;font-size:${size}px;` +
        `pointer-events:none;z-index:9999;will-change:transform,opacity;` +
        `--dx:${dx}px;--dy:${dy}px;--dur:${dur}s;--rot:${rot}deg;--rot2:${rot2}deg;` +
        `animation:_btgv_heart_float var(--dur) cubic-bezier(.22,.61,.36,1) forwards;` +
        `filter:drop-shadow(0 4px 12px rgba(247,37,133,.35));`;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }, delay);
  }
}

// Public, shareable preview at /preview/[merchantId]
// Renders the vertical TikTok-style shoppable feed exactly as customers see it.
// Custom React (not the storefront widget) so we control the layout cleanly.
export default function PreviewPage({ params }) {
  const { merchantId } = params;
  const [merchant, setMerchant] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  // Cross-user like animation. We subscribe to UPDATE on videos.likes_count
  // for the *active* video and pop hearts whenever the count climbs (which
  // means another viewer just liked). The user's own click also pops hearts
  // optimistically below — we suppress the realtime echo for our own writes
  // by tracking `prev` per video and only firing when count *grows*.
  const activeVideo = videos[activeIdx];
  useEffect(() => {
    if (!activeVideo?.id) return;
    const supa = createClient();
    let prev = activeVideo.likes_count ?? null;
    const channel = supa.channel(`btgv_preview_${activeVideo.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'videos',
        filter: `id=eq.${activeVideo.id}`,
      }, payload => {
        const row = payload.new || {};
        const nextLikes = row.likes_count;
        const nextViews = row.views_count;
        if (nextLikes != null && prev != null && nextLikes > prev) {
          // Cap the burst so a flood of likes doesn't lock the browser
          const diff = Math.min(nextLikes - prev, 6);
          for (let i = 0; i < diff; i++) {
            setTimeout(() => spawnHearts(8), i * 140);
          }
        }
        if (nextLikes != null) prev = nextLikes;
        // Mirror counts back into local state so the displayed counters stay fresh
        setVideos(vs => vs.map(v => {
          if (v.id !== activeVideo.id) return v;
          const patch = {};
          if (nextLikes != null) patch.likes_count = nextLikes;
          if (nextViews != null) patch.views_count = nextViews;
          return { ...v, ...patch };
        }));
      })
      .subscribe();
    return () => { supa.removeChannel(channel); };
  }, [activeVideo?.id]);

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
    <div className="h-[100dvh] w-screen bg-black overflow-hidden relative">
      {/* Keyframes for heart particles + button bounce. Scoped at the page
          root so spawnHearts() can append to document.body and still pick
          them up. */}
      <style jsx global>{`
        @keyframes _btgv_heart_float {
          0%   { transform: translate(0,0) rotate(var(--rot)); opacity: 0; }
          15%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot2)); opacity: 0; }
        }
        @keyframes _btgv_heart_btn_pop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.4); }
          70%  { transform: scale(0.92); }
          100% { transform: scale(1.1); }
        }
      `}</style>
      {/* Customer-view: no chrome. The preview must look exactly like what
          shoppers will see on the storefront. Merchants can still copy the
          shareable URL straight from their browser address bar. */}

      {/* Feed — full-screen vertical scroll snap. No max-width container; each
          slide spans the full viewport height + width. */}
      {loading ? (
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">Loading feed…</div>
      ) : videos.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
          <span className="text-3xl">🎬</span>
          <p>No videos yet</p>
          <a href="/dashboard/videos" className="text-xs text-indigo-300 underline">Add some →</a>
        </div>
      ) : (
        <div
          className="feed-scroll h-full overflow-y-scroll snap-y snap-mandatory"
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
              apiKey={merchant?.api_key}
              shopifyDomain={merchant?.shopify_domain}
              onLikeBumped={count => {
                // Mirror the new count locally so the UI stays in sync
                // before the realtime echo arrives.
                setVideos(vs => vs.map(x => x.id === v.id ? { ...x, likes_count: count } : x));
              }}
              onViewBumped={count => {
                setVideos(vs => vs.map(x => x.id === v.id ? { ...x, views_count: count } : x));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One full-screen video slide in the feed. Mobile-style overlay layout
// at every viewport (phone-frame max-width on wide screens). Controls
// overlay the video like the storefront widget — no separate desktop pane.
function FeedSlide({ video, isActive, onActive, apiKey, shopifyDomain, onLikeBumped, onViewBumped }) {
  const videoRef = useRef(null);
  const slideRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false);
  const [popping, setPopping] = useState(false);
  // Local counts: persisted state from the API + optimistic bumps. Realtime
  // updates from PreviewPage flow back via onLikeBumped/onViewBumped, so
  // these values stay synced across cross-user activity too.
  const [likesCount, setLikesCount] = useState(video.likes_count || 0);
  const [viewsCount, setViewsCount] = useState(video.views_count || 0);
  // Track that we've fired a view event for this slide so scroll-up-and-
  // back-down doesn't double-count.
  const viewFiredRef = useRef(false);

  // Keep local counts in sync when the parent pushes new values
  useEffect(() => { setLikesCount(video.likes_count || 0); }, [video.likes_count]);
  useEffect(() => { setViewsCount(video.views_count || 0); }, [video.views_count]);

  async function trackEvent(type) {
    if (!apiKey) return null;
    try {
      const res = await fetch(`${API}/api/widget/videos/${video.id}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: apiKey, event_type: type, session_id: sessionId() }),
      });
      return res.ok;
    } catch {
      return null;
    }
  }

  async function handleLike() {
    // Optimistic UI: hearts pop instantly, count bumps now, network later.
    // We don't reverse on failure — best-effort is fine for likes.
    spawnHearts();
    setLiked(true);
    setPopping(true);
    setTimeout(() => setPopping(false), 500);
    setLikesCount(c => {
      const next = c + 1;
      onLikeBumped?.(next);
      return next;
    });
    trackEvent('like');
  }

  // Build a storefront URL with negotiate / cart intents. The merchant's
  // n.js script on the storefront will pick up the query params and trigger
  // the right flow (e.g. ?btg_neg=1 auto-opens the negotiate chat).
  function storefrontUrl(intent) {
    if (!shopifyDomain) return null;
    const tag = (video.video_product_tags || [])[0];
    if (!tag?.product_handle) return null;
    const params = new URLSearchParams();
    if (tag.shopify_variant_id) params.set('variant', tag.shopify_variant_id);
    if (intent === 'negotiate') params.set('btg_neg', '1');
    if (intent === 'buy') params.set('btg_buy', '1');
    const qs = params.toString();
    return `https://${shopifyDomain}/products/${tag.product_handle}${qs ? '?' + qs : ''}`;
  }

  function openProduct(intent) {
    const url = storefrontUrl(intent);
    if (!url) return;
    trackEvent(intent === 'negotiate' ? 'negotiate' : 'add_to_cart');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Auto-pause when out of view, autoplay when scrolled into view + fire a
  // view event the first time this slide is more than 50% visible.
  useEffect(() => {
    if (!slideRef.current || !videoRef.current) return;
    const el = videoRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          el.play().catch(() => {});
          onActive();
          if (!viewFiredRef.current) {
            viewFiredRef.current = true;
            setViewsCount(c => {
              const next = c + 1;
              onViewBumped?.(next);
              return next;
            });
            trackEvent('view');
          }
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
      {/* Phone-frame container — fills the screen on mobile, capped at a
          phone-shaped panel on wide viewports so the video isn't cropped
          edge-to-edge on a 16:9 laptop. Controls overlay the video at all
          sizes — same layout phone & desktop. */}
      <div className="relative h-full w-full sm:w-auto sm:max-w-[min(440px,calc(100dvh*9/16))] sm:aspect-[9/16] bg-black overflow-hidden sm:rounded-2xl shadow-2xl">
        {video.s3_url ? (
          <video
            ref={videoRef}
            src={video.s3_url}
            loop
            muted={muted}
            playsInline
            className="w-full h-full object-cover"
            onClick={() => setMuted(m => !m)}
          />
        ) : video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">No preview</div>
        )}

        {/* Gradient overlays for legibility */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

        {/* Views pill — top-left, like Reels */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 px-2 py-1 rounded-full bg-black/40 backdrop-blur text-white text-[11px] font-semibold">
          <span>👁</span>
          <span>{formatCount(viewsCount)}</span>
        </div>

        {/* Right action rail (like + count, share, mute) */}
        <div className="absolute right-3 bottom-32 flex flex-col items-center gap-3 z-10">
          <div className="flex flex-col items-center">
            <button
              onClick={handleLike}
              className={`w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-2xl text-white transition-transform ${
                popping ? 'scale-125' : 'hover:scale-110'
              }`}
              style={popping ? { animation: '_btgv_heart_btn_pop 500ms cubic-bezier(.34,1.56,.64,1)' } : undefined}
              aria-label="Like"
            >
              {liked ? '❤️' : '🤍'}
            </button>
            <span className="text-white text-[11px] font-semibold mt-1 drop-shadow">{formatCount(likesCount)}</span>
          </div>
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

        {/* Caption + product card with action buttons */}
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
                <ActionBtn label="🛒" subtle title="Add to cart" onClick={() => openProduct('cart')} />
                <ActionBtn label="⚡" buy title="Buy now" onClick={() => openProduct('buy')} />
                <ActionBtn label="🤝" negotiate title="Negotiate" onClick={() => openProduct('negotiate')} />
              </div>
            </div>
          ) : (
            <div className="bg-white/10 backdrop-blur border border-white/15 rounded-xl px-3 py-2 text-white/70 text-xs">
              No products tagged yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact count formatter — 1.2k, 4.5m, etc. matches Reels-style
function formatCount(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}

function ActionBtn({ label, title, subtle, buy, negotiate, onClick }) {
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
      onClick={onClick}
      disabled={!onClick}
      title={title}
      style={style}
      className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-semibold hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
