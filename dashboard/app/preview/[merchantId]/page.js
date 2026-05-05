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
        const next = payload.new?.likes_count;
        if (next == null) return;
        if (prev != null && next > prev) {
          // Cap the burst so a flood of likes doesn't lock the browser
          const diff = Math.min(next - prev, 6);
          for (let i = 0; i < diff; i++) {
            setTimeout(() => spawnHearts(8), i * 140);
          }
        }
        prev = next;
        // Mirror count back into local state so the displayed counter stays fresh
        setVideos(vs => vs.map(v => v.id === activeVideo.id ? { ...v, likes_count: next } : v));
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
      {/* Floating chrome — preview-only, not on real storefront. Lifted off the
          feed so each slide gets the full viewport. Top-left = store badge,
          top-right = share + back to dashboard. */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 bg-black/40 backdrop-blur-md rounded-full pl-1.5 pr-3 py-1.5 border border-white/10">
        {merchant?.logo_url ? (
          <img src={merchant.logo_url} alt="" className="w-7 h-7 rounded-full object-cover bg-white flex-shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-white/20 flex-shrink-0" />
        )}
        <div className="text-xs font-semibold text-white truncate max-w-[40vw]">
          {merchant?.name || 'Preview'}
        </div>
      </div>

      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <button
          onClick={copyShareLink}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-full text-white shadow-lg"
          style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)' }}
          title="Copy a public link to share"
        >
          {copied ? '✓ Copied' : '🔗 Share'}
        </button>
        <a
          href="/dashboard/videos"
          className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/70 text-white transition-colors"
        >
          ← Dashboard
        </a>
      </div>

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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One full-screen video slide in the feed
function FeedSlide({ video, isActive, onActive, apiKey }) {
  const videoRef = useRef(null);
  const slideRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState(false);
  const [popping, setPopping] = useState(false); // drives the heart-button bounce on click

  async function handleLike() {
    // Optimistic pop — hearts spawn instantly so the user gets feedback
    // even before the network round-trip lands.
    spawnHearts();
    setLiked(true);
    setPopping(true);
    setTimeout(() => setPopping(false), 500);
    if (!apiKey) return;
    try {
      await fetch(`${API}/api/widget/videos/${video.id}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: apiKey, event_type: 'like', session_id: sessionId() }),
      });
    } catch {
      // Best-effort — don't reverse the optimistic UI on transient network errors
    }
  }

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

  // On desktop / landscape (sm:+) we render a TikTok-on-desktop layout:
  // a phone-shaped video panel centered with side rail + caption stacked
  // OUTSIDE the video to its right. On mobile we keep the classic full-
  // screen overlay style (controls on top of video). The breakpoint is
  // viewport-driven via Tailwind's sm: utility.
  return (
    <div
      ref={slideRef}
      id={`feed-slide-${video.id}`}
      className="snap-start h-[100dvh] w-full relative bg-black flex items-center justify-center overflow-hidden"
    >
      {/* Wrapper that pairs the video panel + the desktop side rail.
          On mobile only the video panel renders; the side rail is hidden. */}
      <div className="relative h-full flex items-center gap-4">
        {/* Phone-shaped video panel. On wide viewports it stays at native
            9:16 ratio (no horizontal stretch); on mobile it fills the
            entire screen. max-h-[100dvh] keeps it within viewport always. */}
        <div className="relative h-full sm:h-[min(100dvh,90vh)] w-screen sm:w-auto sm:aspect-[9/16] sm:max-h-[min(100dvh,90vh)] bg-black sm:rounded-2xl overflow-hidden shadow-2xl">
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
            <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">No preview</div>
          )}

          {/* Gradient overlays for legibility */}
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

          {/* Mobile-only overlay: action rail */}
          <div className="sm:hidden absolute right-3 bottom-32 flex flex-col items-center gap-4 z-10">
            <ActionRail
              liked={liked}
              popping={popping}
              muted={muted}
              hasVideo={!!video.s3_url}
              onLike={handleLike}
              onShare={() => navigator.share ? navigator.share({ url: window.location.href }) : navigator.clipboard.writeText(window.location.href)}
              onToggleMute={() => setMuted(m => !m)}
            />
          </div>

          {/* Mobile-only overlay: caption + product card */}
          <div className="sm:hidden absolute inset-x-3 bottom-3 z-10">
            <CaptionBlock video={video} firstTag={firstTag} />
          </div>
        </div>

        {/* Desktop-only side panel: action rail + caption + product card,
            stacked vertically OUTSIDE the video so nothing overlays the
            footage. Hidden below sm. */}
        <div className="hidden sm:flex flex-col items-stretch gap-4 w-[min(22rem,30vw)] max-h-[min(100dvh,90vh)]">
          <div className="flex items-center gap-3 self-end">
            <ActionRail
              liked={liked}
              popping={popping}
              muted={muted}
              hasVideo={!!video.s3_url}
              onLike={handleLike}
              onShare={() => navigator.share ? navigator.share({ url: window.location.href }) : navigator.clipboard.writeText(window.location.href)}
              onToggleMute={() => setMuted(m => !m)}
              horizontal
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <CaptionBlock video={video} firstTag={firstTag} desktop />
          </div>
        </div>
      </div>
    </div>
  );
}

// Action rail — vertical column on mobile, horizontal row on desktop.
function ActionRail({ liked, popping, muted, hasVideo, onLike, onShare, onToggleMute, horizontal }) {
  const layout = horizontal ? 'flex-row gap-3' : 'flex-col gap-4';
  const btn = 'w-11 h-11 rounded-full bg-black/40 backdrop-blur flex items-center justify-center text-white transition-transform';
  return (
    <div className={`flex ${layout}`}>
      <button
        onClick={onLike}
        className={`${btn} text-2xl ${popping ? 'scale-125' : 'hover:scale-110'}`}
        style={popping ? { animation: '_btgv_heart_btn_pop 500ms cubic-bezier(.34,1.56,.64,1)' } : undefined}
        aria-label="Like"
      >
        {liked ? '❤️' : '🤍'}
      </button>
      <button onClick={onShare} className={`${btn} text-xl hover:scale-110`} aria-label="Share">
        ↗
      </button>
      {hasVideo && (
        <button onClick={onToggleMute} className={`${btn} text-lg hover:scale-110`} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      )}
    </div>
  );
}

// Caption + product card. Mobile renders at the bottom-overlay; desktop
// renders in the side panel with a slightly different background treatment.
function CaptionBlock({ video, firstTag, desktop }) {
  const captionCls = desktop
    ? 'text-white/90 text-sm leading-snug mb-3 line-clamp-3'
    : 'text-white text-sm leading-snug mb-3 line-clamp-2 drop-shadow-md max-w-[80%]';
  const cardCls = desktop
    ? 'bg-white/[.06] backdrop-blur border border-white/10 rounded-xl p-3 flex items-center gap-3'
    : 'bg-white/95 backdrop-blur rounded-xl p-2.5 flex items-center gap-3 shadow-lg';
  const titleCls = desktop ? 'text-sm font-semibold text-white truncate' : 'text-sm font-semibold text-gray-900 truncate';
  const priceCls = desktop ? 'text-xs text-white/70' : 'text-xs text-gray-600';
  const strikeCls = desktop ? 'ml-2 text-white/40 line-through' : 'ml-2 text-gray-400 line-through';
  const emptyCls = desktop
    ? 'bg-white/[.04] border border-white/10 rounded-xl px-3 py-2 text-white/60 text-xs'
    : 'bg-white/10 backdrop-blur border border-white/15 rounded-xl px-3 py-2 text-white/70 text-xs';

  return (
    <>
      {video.title && <p className={captionCls}>{video.title}</p>}
      {firstTag ? (
        <div className={cardCls}>
          {firstTag.image_url ? (
            <img src={firstTag.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gray-100 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className={titleCls}>{firstTag.product_name}</div>
            <div className={priceCls}>
              {firstTag.price != null && <span className="font-medium">${firstTag.price}</span>}
              {firstTag.compare_at_price && firstTag.compare_at_price > firstTag.price && (
                <span className={strikeCls}>${firstTag.compare_at_price}</span>
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
        <div className={emptyCls}>No products tagged yet</div>
      )}
    </>
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
