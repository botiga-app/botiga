'use client';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// ─── Shop URL hero — surfaces the public link merchants share ───────────────
function ShopHero({ shopHandle }) {
  const MARKETPLACE = process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://botigamarketplace.vercel.app';
  const shopUrl = `${MARKETPLACE}/shop/${shopHandle}`;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(shopUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="mb-8">
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Your shop video page</p>
            <button
              onClick={copy}
              title="Click to copy"
              className="text-base font-mono font-semibold text-gray-900 hover:text-indigo-700 transition-colors text-left break-all"
            >
              {shopUrl} {copied ? '✓ copied' : '📋'}
            </button>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Share this on Instagram bio, TikTok, anywhere — every customer lands in your video feed.
            </p>
          </div>
          <a
            href={shopUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-gray-900 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            Preview as customer →
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Preview + Share buttons (top of videos page) ───────────────────────────
// Preview opens the public /preview/[merchantId] page in a new tab so the
// merchant sees their shoppable feed exactly as customers will. Share copies
// the same URL to the clipboard so they can send it to anyone.
function PreviewWithShareButtons({ merchantId }) {
  const [copied, setCopied] = useState(false);
  const previewUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/preview/${merchantId}`
    : `/preview/${merchantId}`;

  function share() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(previewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={previewUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors whitespace-nowrap"
        title="Open the customer-facing preview in a new tab"
      >
        <span>👁</span>
        Preview
      </a>
      <button
        onClick={share}
        className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl text-white transition-opacity whitespace-nowrap hover:opacity-90"
        style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)' }}
        title="Copy a public preview link you can share with customers"
      >
        <span>🔗</span>
        {copied ? 'Copied!' : 'Share'}
      </button>
    </div>
  );
}

// ─── One-click auto-import — uses merchant.ig_handle, no selection step ────
function OneClickAutoImport({ merchantId, onImported }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(null); // { phase, msg, progress }
  const [error, setError] = useState(null);
  const [hasIg, setHasIg] = useState(null); // null=unknown, true/false

  // Check on mount whether merchant has an IG handle
  useEffect(() => {
    if (!merchantId) return;
    (async () => {
      const r = await fetch(`${API}/api/merchants/${merchantId}`);
      if (!r.ok) return;
      const m = await r.json();
      setHasIg(!!m.ig_handle);
    })();
  }, [merchantId]);

  async function go() {
    setRunning(true);
    setError(null);
    setStatus({ phase: 'importing', msg: 'Pulling latest reels…', progress: 0 });

    try {
      const r = await fetch(`${API}/api/merchants/${merchantId}/videos/auto-import-latest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Import failed');

      const importedCount = data.imported || 0;
      if (importedCount === 0) {
        setStatus({ phase: 'done', msg: data.message || 'Nothing new to import.' });
        setRunning(false);
        return;
      }

      // Refetch the full videos list now so newly imported videos appear
      // in the grid even before tagging finishes.
      await refetchVideos();

      // Now poll auto-tag-tick until done
      setStatus({ phase: 'tagging', msg: `Imported ${importedCount} videos. Tagging…`, progress: 0 });
      let tagged = 0;
      while (true) {
        const tickRes = await fetch(`${API}/api/merchants/${merchantId}/videos/auto-tag-tick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunk_size: 5 }),
        });
        if (!tickRes.ok) break;
        const t = await tickRes.json();
        tagged += (t.auto_tagged || 0) + (t.pending_review || 0);
        setStatus({
          phase: 'tagging',
          msg: `Tagging videos: ${tagged}/${importedCount}`,
          progress: Math.round((tagged / importedCount) * 100),
        });
        if (!t.has_more) break;
      }

      setStatus({ phase: 'done', msg: `✨ ${importedCount} videos imported and tagged.` });
      // Final refetch so tag pills appear on the cards
      await refetchVideos();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function refetchVideos() {
    try {
      const r = await fetch(`${API}/api/merchants/${merchantId}/videos`);
      if (r.ok) {
        const fresh = await r.json();
        // Pass the FULL list (not a delta) — parent replaces, not prepends
        onImported({ replace: true, videos: fresh });
      }
    } catch (err) {
      console.warn('[refetchVideos]', err.message);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <div className="hidden md:flex items-center gap-2 text-xs">
          {running && <div className="w-3 h-3 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />}
          <span className={status.phase === 'done' ? 'text-emerald-600 font-medium' : 'text-gray-600'}>
            {status.msg}
          </span>
        </div>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={hasIg === true ? go : undefined}
        disabled={running || hasIg !== true}
        className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-pink-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
        title={
          hasIg === null
            ? 'Loading…'
            : hasIg === false
            ? 'Add your Instagram handle in Settings → Brand profile to enable this'
            : 'Auto-import latest 20 reels from your Instagram'
        }
      >
        <span>✨</span>
        {running ? 'Working…' : hasIg === false ? 'Auto-import (add IG in Settings)' : 'Auto-import latest reels'}
      </button>
    </div>
  );
}

// ─── Instagram importer ───────────────────────────────────────────────────────
function InstagramImporter({ merchantId, onImported }) {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [autotagging, setAutotagging] = useState(false);
  const [autotagProgress, setAutotagProgress] = useState({ tagged: 0, total: 0, remaining: 0 });

  async function fetchPosts() {
    const h = handle.replace('@', '').trim();
    if (!h) return;
    setLoading(true);
    setError(null);
    setPosts(null);
    setSelected(new Set());
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/videos/instagram-preview?handle=${encodeURIComponent(h)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch');
      setPosts(data.posts || []);
      if (!data.posts?.length) setError('No videos found for this handle.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Polls /auto-tag-tick until all imported videos are analyzed.
  // Progress UI updates inline; failures don't block — videos stay
  // un-tagged but importable so the merchant can manually tag them.
  async function runAutoTagLoop(totalImported) {
    setAutotagging(true);
    setAutotagProgress({ tagged: 0, total: totalImported, remaining: totalImported });
    let taggedSoFar = 0;
    try {
      while (true) {
        const res = await fetch(`${API}/api/merchants/${merchantId}/videos/auto-tag-tick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunk_size: 5 }),
        });
        if (!res.ok) break; // tick failed — stop quietly, videos remain importable
        const data = await res.json();
        taggedSoFar += (data.auto_tagged || 0) + (data.pending_review || 0);
        setAutotagProgress({ tagged: taggedSoFar, total: totalImported, remaining: data.remaining ?? 0 });
        if (!data.has_more) break;
      }
    } finally {
      setAutotagging(false);
    }
  }

  async function doImport() {
    const toImport = posts.filter(p => selected.has(p.id));
    if (!toImport.length) return;
    setImporting(true);
    try {
      const res = await fetch(`${API}/api/merchants/${merchantId}/videos/import-social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts: toImport, source: 'instagram' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      const importedVideos = data.videos || [];
      onImported(importedVideos);
      // Kick off auto-tagging in the background — keep the modal open with
      // a progress indicator so the merchant sees their videos getting tagged.
      // Doesn't block import success: if autotag fails, videos still appear.
      if (importedVideos.length > 0) {
        await runAutoTagLoop(importedVideos.length);
      }
      onImported([]); // trigger parent refetch so newly tagged products show
      setOpen(false);
      setPosts(null);
      setSelected(new Set());
      setHandle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-opacity"
      >
        <span>📸</span> Import from Instagram
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: '90dvh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">Import from Instagram</h3>
                <p className="text-xs text-gray-400 mt-0.5">Enter a public Instagram handle to import Reels & videos</p>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">×</button>
            </div>

            {/* Handle input */}
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                  <input
                    value={handle}
                    onChange={e => setHandle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchPosts()}
                    placeholder="username"
                    className="w-full border border-gray-200 rounded-xl pl-7 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                  />
                </div>
                <button
                  onClick={fetchPosts}
                  disabled={loading || !handle.trim()}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {loading ? '...' : 'Fetch'}
                </button>
              </div>
              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            </div>

            {/* Posts grid */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-8 h-8 border-2 border-pink-300 border-t-pink-600 rounded-full animate-spin" />
                  <p className="text-sm text-gray-400">Fetching videos from @{handle.replace('@', '')}...</p>
                </div>
              )}

              {posts && posts.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">{posts.length} videos found · {selected.size} selected</p>
                    <button
                      onClick={() => setSelected(selected.size === posts.length ? new Set() : new Set(posts.map(p => p.id)))}
                      className="text-xs text-pink-600 font-medium hover:underline"
                    >
                      {selected.size === posts.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {posts.map(post => {
                      const isSelected = selected.has(post.id);
                      return (
                        <button
                          key={post.id}
                          onClick={() => toggleSelect(post.id)}
                          className={`relative aspect-[9/16] rounded-xl overflow-hidden bg-gray-100 border-2 transition-all ${
                            isSelected ? 'border-pink-500 shadow-md shadow-pink-200' : 'border-transparent hover:border-gray-300'
                          }`}
                        >
                          {post.thumbnail_url && (
                            <img src={post.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          )}
                          <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-pink-500/20' : 'bg-black/10'}`} />
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-pink-500 rounded-full flex items-center justify-center">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                            </div>
                          )}
                          {post.play_count > 0 && (
                            <div className="absolute bottom-1 left-1 text-[9px] text-white bg-black/50 px-1.5 py-0.5 rounded-full">
                              ▶ {post.play_count > 1000 ? `${Math.round(post.play_count/1000)}k` : post.play_count}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {posts && posts.length === 0 && !loading && (
                <div className="text-center py-12 text-gray-400 text-sm">No videos found for this handle.</div>
              )}
            </div>

            {/* Footer */}
            {posts && posts.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-100">
                {autotagging && (
                  <div className="mb-3 p-3 bg-purple-50 border border-purple-100 rounded-xl text-sm text-purple-800">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium">✨ Tagging videos to your products…</span>
                      <span className="font-mono">
                        {autotagProgress.tagged}/{autotagProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 bg-purple-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all"
                        style={{
                          width: autotagProgress.total > 0
                            ? `${Math.round((autotagProgress.tagged / autotagProgress.total) * 100)}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setOpen(false)}
                    disabled={importing || autotagging}
                    className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl py-2.5 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doImport}
                    disabled={selected.size === 0 || importing || autotagging}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl py-2.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {importing && !autotagging
                      ? 'Importing…'
                      : autotagging
                      ? 'Auto-tagging…'
                      : `Import ${selected.size} video${selected.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Upload zone ─────────────────────────────────────────────────────────────
function UploadZone({ merchantId, onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  async function handleFiles(files) {
    const file = files[0];
    if (!file || !file.type.startsWith('video/')) {
      setError('Please select a video file (MP4, MOV, etc.)');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setError('Video must be under 500MB');
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      // 1. Get presigned URL
      const urlRes = await fetch(`${API}/api/merchants/${merchantId}/videos/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      });
      if (!urlRes.ok) throw new Error('Could not get upload URL');
      const { upload_url, s3_key, s3_url } = await urlRes.json();

      // 2. Upload to S3 with progress
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90));
        };
        xhr.onload = () => xhr.status < 300 ? resolve() : reject(new Error('S3 upload failed'));
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      setProgress(95);

      // 3. Get video metadata
      const duration = await getVideoDuration(file);

      // 4. Save record
      const saveRes = await fetch(`${API}/api/merchants/${merchantId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3_key, s3_url,
          title: file.name.replace(/\.[^.]+$/, ''),
          duration_seconds: Math.round(duration),
          source: 'upload',
        }),
      });
      if (!saveRes.ok) throw new Error('Could not save video');
      const video = await saveRes.json();
      setProgress(100);
      setTimeout(() => { setProgress(0); setUploading(false); onUploaded(video); }, 500);
    } catch (err) {
      setError(err.message);
      setUploading(false);
      setProgress(0);
    }
  }

  function getVideoDuration(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.onloadedmetadata = () => { resolve(video.duration); URL.revokeObjectURL(url); };
      video.onerror = () => resolve(0);
      video.src = url;
    });
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
        dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
      } ${uploading ? 'pointer-events-none' : ''}`}
    >
      <input ref={inputRef} type="file" accept="video/*" className="hidden"
        onChange={e => handleFiles(e.target.files)} />

      {uploading ? (
        <div className="space-y-3">
          <div className="text-2xl">📤</div>
          <p className="text-sm font-medium text-gray-700">Uploading... {progress}%</p>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-3xl">🎬</div>
          <p className="text-sm font-semibold text-gray-700">Drop a video here or click to upload</p>
          <p className="text-xs text-gray-400">MP4, MOV, WebM · Max 500MB</p>
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
    </div>
  );
}

// ─── Frame extractor ─────────────────────────────────────────────────────────
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

// ─── AI Tagger ─────────────────────────────────────────────────────────────
// Multi-product flow: AI detects 1+ products in the frame, returns each
// with title/description/tags/category/sizes/color pre-filled. Merchant
// reviews all in one screen, fills in PRICE (the only thing AI can't
// guess), edits anything wrong, clicks "Create All". Each product gets
// a Shopify draft + a video tag.
function AiTagger({ video, merchantId, onTagsUpdated, onClose }) {
  const [step, setStep] = useState('idle'); // idle | analysing | review | creating | done
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]); // editable array of detected products
  const [results, setResults] = useState([]);   // created products with admin URLs

  async function run() {
    setStep('analysing');
    setError(null);
    let frames = [];

    if (video.s3_url) {
      frames = await extractFrames(video.s3_url);
    }
    const body = frames.length
      ? { frames }
      : video.thumbnail_url
      ? { thumbnail_url: video.thumbnail_url }
      : null;

    if (!body) {
      setError('No video frames or thumbnail available to analyse.');
      setStep('idle');
      return;
    }

    try {
      const res = await fetch(`${API}/api/videos/${video.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');

      const detected = data.products || [];
      if (!detected.length) {
        setError("Couldn't identify a product in this video. Try uploading clearer frames.");
        setStep('idle');
        return;
      }

      // Add per-product editable fields the AI doesn't know
      setProducts(detected.map(p => ({
        title: p.title || '',
        description: p.description || '',
        tags: p.tags || [],
        category: p.category || '',
        color: p.suggested_color || '',
        sizes: p.suggested_sizes && p.suggested_sizes.length ? p.suggested_sizes : ['XS','S','M','L','XL'],
        price: p.price_hint != null ? String(p.price_hint) : '',
        confidence: p.confidence ?? null,
        skipped: false,
      })));
      setStep('review');
    } catch (err) {
      setError(err.message);
      setStep('idle');
    }
  }

  function patchProduct(idx, patch) {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function removeProduct(idx) {
    setProducts(prev => prev.filter((_, i) => i !== idx));
  }

  function toggleSize(idx, size) {
    const p = products[idx];
    const next = p.sizes.includes(size) ? p.sizes.filter(s => s !== size) : [...p.sizes, size];
    patchProduct(idx, { sizes: next });
  }

  async function createAll() {
    setStep('creating');
    setError(null);
    const created = [];
    for (const p of products) {
      if (p.skipped) continue;
      if (!p.title.trim() || !p.price.toString().trim()) continue;
      try {
        const res = await fetch(`${API}/api/videos/${video.id}/create-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: p.title.trim(),
            description: p.description,
            tags: p.tags,
            product_type: p.category,
            price: parseFloat(p.price),
            sizes: p.sizes,
            colors: p.color ? [p.color] : null,
            merchant_id: merchantId,
            image_url: video.thumbnail_url || null,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          created.push(data);
          if (data.tag) onTagsUpdated(video.id, t => [...(t || []), data.tag]);
        }
      } catch (err) {
        // continue with the rest; per-product errors surface in results
      }
    }
    setResults(created);
    setStep('done');
  }

  // Total products that have a price filled in — controls the Create button
  const readyCount = products.filter(p => p.title.trim() && p.price.toString().trim()).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 flex items-center gap-2">
              <span style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>✨</span>
              AI product create
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{video.title || 'Untitled video'}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Idle */}
          {step === 'idle' && !error && (
            <div className="text-center py-8">
              <div className="text-5xl mb-3">🎬</div>
              <p className="text-base font-semibold text-gray-900 mb-1">Detect products in this video</p>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed max-w-md mx-auto">
                AI will scan the frames, identify each product, and pre-fill everything except price + sizes.
                You'll review and create with one click.
              </p>
              <button
                onClick={run}
                className="text-white font-semibold text-sm px-8 py-3 rounded-xl hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)', boxShadow: '0 4px 14px rgba(247,37,133,.35)' }}
              >
                ✨ Analyse video
              </button>
            </div>
          )}

          {/* Analysing */}
          {step === 'analysing' && (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-800">Identifying products in your video…</p>
              <p className="text-xs text-gray-400 mt-1">5–10 seconds</p>
            </div>
          )}

          {/* Creating */}
          {step === 'creating' && (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-800">Creating {readyCount} Shopify draft{readyCount !== 1 ? 's' : ''}…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-xl p-4">
              {error}
              <button onClick={() => { setError(null); setStep('idle'); }} className="block mt-2 text-xs text-red-500 underline">Try again</button>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="space-y-3">
              <div className="text-center pt-4 pb-2">
                <div className="text-5xl mb-2">🎉</div>
                <p className="text-base font-bold text-gray-900">{results.length} product{results.length !== 1 ? 's' : ''} created</p>
                <p className="text-xs text-gray-500 mt-1">All saved as drafts on your Shopify store, tagged to this video.</p>
              </div>
              {results.map((r, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                  {r.product?.images?.[0]?.src ? (
                    <img src={r.product.images[0].src} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{r.product?.title}</div>
                    <div className="text-xs text-gray-500">${r.product?.variants?.[0]?.price || '0.00'} · draft</div>
                  </div>
                  {r.admin_url && (
                    <a href={r.admin_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex-shrink-0">
                      View ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Review (the meat) */}
          {step === 'review' && products.length > 0 && (
            <>
              <div className="rounded-xl p-3 text-xs font-medium" style={{ background: 'linear-gradient(135deg,#FFF8E1 0%,#FCE4EC 100%)', color: '#7B1FA2' }}>
                ✨ Found {products.length} product{products.length !== 1 ? 's' : ''}. We've filled in everything we could see — review and add a <strong>price</strong> for each before creating.
              </div>
              {products.map((p, idx) => (
                <ProductReviewCard
                  key={idx}
                  product={p}
                  onChange={patch => patchProduct(idx, patch)}
                  onRemove={() => removeProduct(idx)}
                  onToggleSize={s => toggleSize(idx, s)}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <button onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {readyCount} of {products.length} ready
              </span>
              <button
                onClick={createAll}
                disabled={readyCount === 0}
                className="text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity"
                style={{ background: 'linear-gradient(135deg,#FFC107 0%,#FF6B35 33%,#F72585 66%,#9C27B0 100%)', boxShadow: '0 4px 14px rgba(247,37,133,.32)' }}
              >
                Create {readyCount > 1 ? `${readyCount} products` : 'product'} →
              </button>
            </div>
          </div>
        )}
        {step === 'done' && (
          <div className="px-6 py-4 border-t border-gray-100">
            <button onClick={onClose} className="w-full bg-gray-900 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-gray-800 transition-colors">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const COMMON_SIZES = ['XS','S','M','L','XL','2X','One Size'];

// One detected product — editable card. Price is the only required input
// the merchant must add (AI can't guess it). Everything else is pre-filled.
function ProductReviewCard({ product: p, onChange, onRemove, onToggleSize }) {
  const conf = p.confidence != null ? Math.round(p.confidence * 100) : null;
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <input
            value={p.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Product title"
            className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-indigo-50/40 rounded px-1 -mx-1"
          />
          <div className="flex items-center gap-2 mt-1">
            {p.category && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                {p.category}
              </span>
            )}
            {conf != null && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-600">
                {conf}% match
              </span>
            )}
          </div>
        </div>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-600 text-sm w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center" title="Remove">×</button>
      </div>

      <textarea
        value={p.description}
        onChange={e => onChange({ description: e.target.value })}
        placeholder="Description"
        rows={2}
        className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 resize-none"
      />

      {/* Two questions the merchant has to answer: PRICE and SIZES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
            Price <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={p.price}
              onChange={e => onChange({ price: e.target.value })}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
            Color (optional)
          </label>
          <input
            type="text"
            value={p.color}
            onChange={e => onChange({ color: e.target.value })}
            placeholder="e.g. Beige"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Sizes — chips, click to toggle */}
      <div>
        <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1.5">
          Sizes available
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_SIZES.map(s => {
            const active = p.sizes.includes(s);
            return (
              <button
                key={s}
                onClick={() => onToggleSize(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-gray-900 text-white border border-gray-900'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags — read-only chips, no edit needed for v1 */}
      {p.tags && p.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {p.tags.map(t => (
            <span key={t} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Product tagger ───────────────────────────────────────────────────────────
function ProductTagger({ video, merchantId, shopifyDomain, onClose, onTagsUpdated }) {
  const [query, setQuery] = useState('');
  const [allProducts, setAllProducts] = useState([]);
  const [tags, setTags] = useState(video.video_product_tags || []);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const inputRef = useRef();

  useEffect(() => {
    if (!shopifyDomain) { setLoading(false); return; }
    fetch(`${API}/api/merchants/${merchantId}/shopify-products`)
      .then(r => r.ok ? r.json() : { products: [] })
      .then(data => { setAllProducts(data.products || []); setLoading(false); })
      .catch(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const q = query.trim().toLowerCase();
  const taggedIds = new Set(tags.map(t => t.shopify_product_id));

  const filtered = allProducts.filter(p =>
    !q || p.title.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
  );
  const tagged = filtered.filter(p => taggedIds.has(String(p.id)));
  const untagged = filtered.filter(p => !taggedIds.has(String(p.id)));

  async function toggleTag(product) {
    const pid = String(product.id);
    const existing = tags.find(t => t.shopify_product_id === pid);
    setPending(prev => ({ ...prev, [pid]: true }));
    if (existing) {
      await fetch(`${API}/api/videos/${video.id}/tags/${existing.id}`, { method: 'DELETE' });
      const updated = tags.filter(t => t.id !== existing.id);
      setTags(updated);
      onTagsUpdated(video.id, updated);
    } else {
      const res = await fetch(`${API}/api/videos/${video.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          shopify_product_id: pid,
          shopify_variant_id: product.variant_id || null,
          product_name: product.title,
          product_handle: product.handle,
          price: parseFloat(product.price || 0),
          compare_at_price: parseFloat(product.compare_at_price || 0) || null,
          image_url: product.image || null,
        }),
      });
      if (res.ok) {
        const tag = await res.json();
        const updated = [...tags, tag];
        setTags(updated);
        onTagsUpdated(video.id, updated);
      }
    }
    setPending(prev => ({ ...prev, [pid]: false }));
  }

  function ProductRow({ p, isTagged }) {
    const pid = String(p.id);
    const isSaving = !!pending[pid];
    const price = parseFloat(p.price || 0);
    const compareAt = parseFloat(p.compare_at_price || 0);
    const discount = compareAt > price ? Math.round((1 - price / compareAt) * 100) : 0;

    return (
      <button
        onClick={() => !isSaving && toggleTag(p)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 ${
          isTagged ? 'bg-indigo-50' : 'hover:bg-gray-50'
        }`}
      >
        {p.image
          ? <img src={p.image} className="w-11 h-11 rounded-xl object-cover flex-shrink-0 shadow-sm" alt="" />
          : <div className="w-11 h-11 rounded-xl bg-gray-100 flex-shrink-0 flex items-center justify-center text-base">📦</div>
        }
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isTagged ? 'text-indigo-900' : 'text-gray-900'}`}>{p.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {price > 0 ? (
              <>
                <span className="text-xs font-semibold text-gray-700">${price.toFixed(2)}</span>
                {discount > 0 && (
                  <>
                    <span className="text-xs text-gray-400 line-through">${compareAt.toFixed(2)}</span>
                    <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full">{discount}% off</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400">No price set</span>
            )}
          </div>
        </div>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
          isTagged
            ? 'bg-indigo-600 shadow-md shadow-indigo-200'
            : 'border-2 border-gray-200 bg-white'
        }`}>
          {isSaving
            ? <span className="text-[10px] text-gray-400 animate-pulse">•</span>
            : isTagged
            ? <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
            : null
          }
        </div>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '88dvh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-2 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 text-base">Tag Products</h3>
            <p className="text-xs text-gray-400 truncate max-w-[240px] mt-0.5">{video.title || 'Untitled'}</p>
          </div>
          <button
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-1.5 rounded-full transition-colors"
          >
            {tags.length > 0 ? `Done (${tags.length})` : 'Done'}
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 pb-3 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name..."
              className="w-full bg-gray-100 border-0 rounded-2xl pl-9 pr-9 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition-all"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            )}
          </div>
        </div>

        {/* Tagged chips strip */}
        {tags.length > 0 && !query && (
          <div className="flex-shrink-0 px-4 pb-3">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
              {tags.map(tag => (
                <div key={tag.id} className="flex items-center gap-1.5 bg-indigo-100 text-indigo-800 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap flex-shrink-0">
                  {tag.image_url && <img src={tag.image_url} className="w-4 h-4 rounded-full object-cover" alt="" />}
                  <span className="max-w-[100px] truncate">{tag.product_name}</span>
                  <button
                    onClick={() => toggleTag({ id: tag.shopify_product_id, ...tag })}
                    className="text-indigo-500 hover:text-indigo-700 ml-0.5 text-sm leading-none"
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-gray-100 flex-shrink-0" />

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center">
              <div className="text-2xl mb-2">⏳</div>
              <p className="text-sm text-gray-400">Loading products...</p>
            </div>
          ) : !shopifyDomain ? (
            <div className="m-4 p-4 bg-amber-50 rounded-2xl text-sm text-amber-700">
              Connect your Shopify store in Settings to tag products.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-2xl mb-2">🔍</div>
              <p className="text-sm text-gray-400">No products match "{query}"</p>
            </div>
          ) : (
            <>
              {tagged.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-4 pt-3 pb-1">Tagged</p>
                  {tagged.map(p => <ProductRow key={p.id} p={p} isTagged={true} />)}
                </>
              )}
              {tagged.length > 0 && untagged.length > 0 && (
                <div className="h-px bg-gray-100 mx-4 my-1" />
              )}
              {untagged.length > 0 && (
                <>
                  {tagged.length > 0 && <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-4 pt-2 pb-1">All Products</p>}
                  {untagged.map(p => <ProductRow key={p.id} p={p} isTagged={false} />)}
                </>
              )}
              <div className="h-4" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Video card ───────────────────────────────────────────────────────────────
// Tag pill with hover X — click X to remove the tag from this video.
// Click pill body to open the manual tagger so the merchant can replace it.
function RemovableTagPill({ tag, videoId, onRemoved }) {
  const [removing, setRemoving] = useState(false);
  async function remove(e) {
    e.stopPropagation();
    if (removing) return;
    setRemoving(true);
    try {
      await fetch(`${API}/api/videos/${videoId}/tags/${tag.id}`, { method: 'DELETE' });
      onRemoved();
    } catch (err) {
      console.warn('[remove tag]', err.message);
      setRemoving(false);
    }
  }
  // Show match score badge for AI-matched tags so the merchant knows this came from auto-tag
  const isAuto = tag.match_status === 'auto_tagged' || tag.match_status === 'pending_review';
  return (
    <span
      className={`group/pill inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full truncate max-w-[180px] transition-opacity ${
        removing ? 'opacity-40' : ''
      } ${
        tag.match_status === 'pending_review'
          ? 'bg-amber-50 text-amber-800 border border-amber-200'
          : 'bg-indigo-50 text-indigo-700'
      }`}
      title={
        isAuto
          ? `AI ${tag.match_status === 'pending_review' ? 'suggestion' : 'match'} — score ${tag.match_score ?? '?'}`
          : tag.product_name
      }
    >
      {isAuto && <span className="text-[10px]">{tag.match_status === 'pending_review' ? '⚠' : '✨'}</span>}
      <span className="truncate">{tag.product_name}</span>
      <button
        onClick={remove}
        className="ml-0.5 opacity-50 hover:opacity-100 hover:text-red-600 transition-all"
        aria-label="Remove tag"
      >
        ×
      </button>
    </span>
  );
}

// Clean video tile — no inline buttons. Whole tile is clickable; opens
// the VideoDetailDrawer where all merchant actions live.
function VideoCard({ video, onOpen }) {
  const tags = video.video_product_tags || [];
  const isActive = video.status === 'active';
  const productCount = tags.length;

  return (
    <button
      onClick={() => onOpen(video)}
      className="text-left bg-white rounded-2xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all overflow-hidden group focus:outline-none focus:ring-2 focus:ring-indigo-400"
    >
      <div className="relative bg-black aspect-[9/16] max-h-72 overflow-hidden">
        {video.source === 'instagram' || video.source === 'tiktok' ? (
          video.thumbnail_url
            ? <img src={video.thumbnail_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-2xl text-white/60">▶</div>
        ) : (
          <video
            src={video.s3_url}
            className="w-full h-full object-cover"
            muted playsInline
            onMouseEnter={e => e.target.play()}
            onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0; }}
          />
        )}

        {/* Subtle gradient for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" />

        {/* Hover hint */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
          <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium bg-black/70 backdrop-blur px-3 py-1.5 rounded-full transition-opacity">
            Open
          </span>
        </div>

        {/* Top badges */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${
            isActive ? 'bg-white/95 text-gray-900' : 'bg-black/60 text-white'
          }`}>
            {isActive ? 'Live' : 'Hidden'}
          </span>
          {(video.source === 'instagram' || video.source === 'tiktok') && (
            <span className="text-[10px] bg-black/60 text-white px-2 py-0.5 rounded">
              {video.source === 'instagram' ? 'IG' : 'TT'}
            </span>
          )}
        </div>

        {/* Bottom stats */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-end justify-between text-white text-[11px]">
          <div className="flex gap-3">
            <span>{video.views_count || 0} views</span>
            <span>{video.likes_count || 0} likes</span>
          </div>
          {productCount > 0 && (
            <span className="bg-white/95 text-gray-900 px-2 py-0.5 rounded text-[10px] font-semibold">
              {productCount} tagged
            </span>
          )}
        </div>
      </div>

      {/* Card body — minimal */}
      <div className="p-3.5 space-y-2">
        <p className="text-sm font-medium text-gray-900 line-clamp-1">
          {video.title || <span className="text-gray-400 italic">Untitled</span>}
        </p>
        {tags.length > 0 ? (
          <div className="flex gap-1 flex-wrap">
            {tags.slice(0, 2).map(tag => (
              <span
                key={tag.id}
                className={`text-[11px] px-2 py-0.5 rounded truncate max-w-[120px] ${
                  tag.match_status === 'pending_review'
                    ? 'bg-amber-50 text-amber-800'
                    : tag.match_status === 'auto_tagged'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {tag.product_name}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="text-[11px] text-gray-400">+{tags.length - 2}</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No products tagged yet</p>
        )}
      </div>
    </button>
  );
}

// ─── Detail drawer — opens when a video tile is clicked ────────────────────
function VideoDetailDrawer({ video, merchantId, shopifyDomain, onClose, onTagsUpdated, onDelete, onToggleStatus }) {
  const [aiTaggerOpen, setAiTaggerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(video.title || '');
  const [titleSaving, setTitleSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [muted, setMuted] = useState(true);

  // ESC closes
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function saveTitle() {
    if (titleDraft === video.title) return;
    setTitleSaving(true);
    await fetch(`${API}/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleDraft }),
    });
    setTitleSaving(false);
  }

  const tags = video.video_product_tags || [];
  const isActive = video.status === 'active';

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm animate-[fadein_.15s_ease]"
      onClick={onClose}
    >
      <style>{`@keyframes fadein { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <div
        className="bg-white w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col sm:flex-row"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: video player on loop */}
        <div className="bg-black flex-shrink-0 w-full sm:w-[360px] md:w-[420px] flex items-center justify-center relative">
          {video.s3_url ? (
            <video
              key={video.id}
              src={video.s3_url}
              autoPlay
              loop
              muted={muted}
              playsInline
              className="w-full h-full object-contain"
              style={{ maxHeight: '100vh' }}
            />
          ) : video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt="" className="w-full h-full object-contain" />
          ) : (
            <div className="text-white/40 text-sm">No preview</div>
          )}

          {/* Mute toggle */}
          {video.s3_url && (
            <button
              onClick={() => setMuted(m => !m)}
              className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur text-white flex items-center justify-center text-sm transition-colors"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          )}

          {/* Stats overlay */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white text-xs">
            <div className="flex gap-4">
              <span>{video.views_count || 0} views</span>
              <span>{video.likes_count || 0} likes</span>
              <span>{video.add_to_cart_count || 0} carts</span>
            </div>
            {(video.source === 'instagram' || video.source === 'tiktok') && (
              <span className="bg-white/20 backdrop-blur px-2 py-0.5 rounded">
                {video.source === 'instagram' ? 'IG' : 'TT'}
              </span>
            )}
          </div>
        </div>

        {/* Right: actions panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <textarea
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                placeholder="Untitled — click to add a caption"
                rows={1}
                className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-indigo-50/40 rounded px-1 -mx-1 resize-none leading-snug"
                style={{ minHeight: '1.5em', height: 'auto' }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              />
              <p className="text-xs text-gray-500 mt-0.5">
                {titleSaving ? 'Saving…' : isActive ? 'Live on storefront · click caption to edit' : 'Hidden from storefront · click caption to edit'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 text-xl flex-shrink-0"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* Tagged products */}
            <Section title="Tagged products" count={tags.length}>
              {tags.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-2">No products tagged. Add one below.</p>
              ) : (
                <div className="space-y-2">
                  {tags.map(tag => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      videoId={video.id}
                      merchantId={merchantId}
                      shopifyDomain={shopifyDomain}
                      onRemoved={() => onTagsUpdated(video.id, tags.filter(t => t.id !== tag.id))}
                      onUpdated={updated => onTagsUpdated(video.id, tags.map(t => t.id === updated.id ? updated : t))}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* Add product — search with collection / tag filters */}
            <Section title="Add product">
              <ProductPicker
                video={video}
                merchantId={merchantId}
                existingTagIds={new Set(tags.map(t => t.shopify_product_id))}
                onTagAdded={newTag => onTagsUpdated(video.id, [...tags, newTag])}
              />
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500">Or generate a new product from this video</span>
                <button
                  onClick={() => setAiTaggerOpen(true)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  ✨ AI Create →
                </button>
              </div>
            </Section>

            {/* Settings */}
            <Section title="Video settings">
              <div className="space-y-3">
                <button
                  onClick={() => onToggleStatus(video.id, isActive ? 'inactive' : 'active')}
                  className="w-full flex items-center justify-between text-sm py-2.5 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-900 font-medium">
                    {isActive ? 'Hide from storefront' : 'Show on storefront'}
                  </span>
                  <span className="text-xs text-gray-500">{isActive ? 'Currently live' : 'Currently hidden'}</span>
                </button>
                {merchantId && (
                  <a
                    href={`/preview/${merchantId}?btgv=${video.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-between text-sm py-2.5 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-gray-900 font-medium">Preview this video</span>
                    <span className="text-xs text-gray-500">Customer view ↗</span>
                  </a>
                )}

                {confirmDelete ? (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await onDelete(video.id);
                        onClose();
                      }}
                      className="flex-1 text-sm font-semibold bg-red-600 text-white rounded-lg py-2.5 hover:bg-red-700"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 text-sm font-medium border border-gray-200 rounded-lg py-2.5 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg py-2.5 transition-colors"
                  >
                    Delete video
                  </button>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>

      {/* AI Tagger as nested modal — sits on top of drawer */}
      {aiTaggerOpen && (
        <AiTagger
          video={video}
          merchantId={merchantId}
          onTagsUpdated={onTagsUpdated}
          onClose={() => setAiTaggerOpen(false)}
        />
      )}
    </div>
  );
}

// Section wrapper used inside the drawer
function Section({ title, count, children }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2.5 flex items-center gap-2">
        {title}
        {typeof count === 'number' && (
          <span className="text-gray-400 font-normal">{count}</span>
        )}
      </h3>
      {children}
    </div>
  );
}

// Single tagged-product row — shown in drawer
function TagRow({ tag, videoId, merchantId, shopifyDomain, onRemoved, onUpdated }) {
  const [busy, setBusy] = useState(null); // null | 'accepting' | 'removing' | 'rules'
  const [showRules, setShowRules] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false); // green flash after accept
  const [actionError, setActionError] = useState(null);

  async function remove() {
    if (busy) return;
    setBusy('removing');
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/videos/${videoId}/tags/${tag.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
      onRemoved();
    } catch (err) {
      setActionError(err.message || 'Failed to remove');
      setBusy(null);
    }
  }

  async function accept() {
    if (busy) return;
    setBusy('accepting');
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/videos/${videoId}/tags/${tag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_status: 'auto_tagged' }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${r.status}`);
      }
      const updated = await r.json();
      // Hold a green-flash state briefly so the merchant SEES the change
      setJustAccepted(true);
      setTimeout(() => {
        setJustAccepted(false);
        onUpdated(updated); // hands the new tag up — row morphs from amber to white
      }, 900);
    } catch (err) {
      setActionError(err.message || 'Failed to accept');
    } finally {
      setBusy(null);
    }
  }

  const isPending = tag.match_status === 'pending_review';

  return (
    <div className={`rounded-lg border transition-all ${
      busy === 'removing' ? 'opacity-40' : ''
    } ${
      justAccepted
        ? 'bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100'
        : isPending
        ? 'bg-amber-50/40 border-amber-200'
        : 'bg-white border-gray-200'
    }`}>
      <div className="flex items-start gap-3 p-2.5">
        {tag.image_url ? (
          <img src={tag.image_url} alt="" className="w-12 h-12 rounded-md object-cover bg-gray-100 flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-md bg-gray-100 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-900 truncate">{tag.product_name}</span>
            {tag.match_status === 'auto_tagged' && (
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold flex-shrink-0">AI</span>
            )}
            {isPending && (
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold flex-shrink-0">Review</span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {tag.price != null && <span className="font-medium">${tag.price}</span>}
            {tag.compare_at_price != null && tag.compare_at_price > (tag.price ?? 0) && (
              <span className="text-gray-400 line-through">${tag.compare_at_price}</span>
            )}
            {tag.match_score != null && (
              <span className="text-gray-500">· {Math.round(tag.match_score * 100)}% match</span>
            )}
            {tag.product_handle && (
              <span className="text-gray-400">· {tag.product_handle}</span>
            )}
          </div>
          {/* Action chips: Shopify link + storefront link. Only show when we know
              where they live (shopifyDomain for admin link, product_handle for storefront). */}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {shopifyDomain && tag.shopify_product_id && (
              <a
                href={`https://${shopifyDomain}/admin/products/${tag.shopify_product_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-medium px-2 py-0.5 rounded bg-gray-900 text-white hover:bg-gray-800 transition-colors"
                title="Open in Shopify admin"
              >
                Edit in Shopify ↗
              </a>
            )}
            {tag.product_handle && shopifyDomain && (
              <a
                href={`https://${shopifyDomain.replace('.myshopify.com', '')}.myshopify.com/products/${tag.product_handle}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-medium px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                title="Open product on storefront"
              >
                View on store ↗
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Rules expand toggle — visible when not pending (no clutter on review row) */}
          {!isPending && tag.product_handle && merchantId && (
            <button
              onClick={() => setShowRules(s => !s)}
              className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                showRules
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title="Negotiation rule for this product"
            >
              {showRules ? '▾ Rules' : 'Rules'}
            </button>
          )}

          <button
            onClick={remove}
            disabled={!!busy}
            className="text-gray-400 hover:text-red-600 text-sm w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center transition-colors"
            aria-label="Remove tag"
          >
            ×
          </button>
        </div>
      </div>

      {/* Pending review action row — Accept / Reject */}
      {isPending && !justAccepted && (
        <div className="px-2.5 pb-2.5 flex gap-2">
          <button
            onClick={accept}
            disabled={!!busy}
            className="flex-1 text-xs font-semibold py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
          >
            {busy === 'accepting' ? 'Accepting…' : '✓ Accept tag'}
          </button>
          <button
            onClick={remove}
            disabled={!!busy}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}

      {/* Brief success flash — appears for ~900ms before the row morphs to confirmed state */}
      {justAccepted && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <span className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">✓</span>
            Tag accepted — saved to this video
          </div>
        </div>
      )}

      {/* Action error — visible when accept / remove fails so the merchant
          can see what went wrong instead of the click silently doing nothing. */}
      {actionError && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
            <span className="font-semibold">Couldn't save:</span>
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 font-bold">×</button>
          </div>
        </div>
      )}

      {/* Rules drawer — per-product max discount override */}
      {showRules && tag.product_handle && merchantId && (
        <ProductRuleEditor
          merchantId={merchantId}
          productHandle={tag.product_handle}
          productName={tag.product_name}
        />
      )}
    </div>
  );
}

// Per-product negotiation rule editor — appears when "Rules" is expanded on a tag row
function ProductRuleEditor({ merchantId, productHandle, productName }) {
  const [rule, setRule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/merchants/${merchantId}/products/${productHandle}/rule`);
        if (cancelled) return;
        if (r.ok) {
          const data = await r.json();
          setRule(data);
          setMaxDiscount(data?.max_discount_pct != null ? String(data.max_discount_pct) : '');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId, productHandle]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const num = maxDiscount === '' ? null : parseFloat(maxDiscount);
      const r = await fetch(`${API}/api/merchants/${merchantId}/products/${productHandle}/rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_discount_pct: num }),
      });
      if (r.ok) {
        const data = await r.json();
        setRule(data);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1600);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50/40 rounded-b-lg">
      <p className="text-[11px] text-gray-500 mb-2">
        Override the default max discount for <strong>{productName}</strong>.
        Leave blank to use store default.
      </p>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 flex-shrink-0">Max discount</label>
          <div className="relative flex-1 max-w-[140px]">
            <input
              type="number"
              min="0"
              max="80"
              step="1"
              value={maxDiscount}
              onChange={e => setMaxDiscount(e.target.value)}
              placeholder="e.g. 25"
              className="w-full border border-gray-200 rounded-md pl-2 pr-6 py-1 text-xs focus:outline-none focus:border-indigo-500"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs font-medium px-3 py-1 rounded-md bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedFlash && <span className="text-xs text-emerald-600 font-medium">✓</span>}
        </div>
      )}
    </div>
  );
}

// Product picker with name / collection / tag filters
function ProductPicker({ video, merchantId, existingTagIds, onTagAdded }) {
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'collection' | 'tag'
  const [filterValue, setFilterValue] = useState('');
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  // Surface fetch failures so empty dropdowns aren't ambiguous (real-empty vs broken-fetch).
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`${API}/api/merchants/${merchantId}/shopify-products`),
          fetch(`${API}/api/merchants/${merchantId}/shopify-collections`),
        ]);
        if (cancelled) return;

        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData.error === 'no_shopify') {
            setFetchError('Connect your Shopify store first to load products.');
          } else {
            setProducts(pData.products || []);
            const tagSet = new Set();
            (pData.products || []).forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
            setAllTags([...tagSet].sort());
          }
        } else {
          const body = await pRes.json().catch(() => ({}));
          setFetchError(body.error || `Couldn't load products (HTTP ${pRes.status})`);
        }

        if (cRes.ok) {
          const cData = await cRes.json();
          setCollections(cData.collections || []);
        }
      } catch (err) {
        if (!cancelled) setFetchError(err.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [merchantId]);

  const filtered = useMemo(() => {
    let list = products;
    if (filterMode === 'collection' && filterValue) {
      list = list.filter(p => (p.collections || []).includes(filterValue));
    } else if (filterMode === 'tag' && filterValue) {
      list = list.filter(p => (p.tags || []).includes(filterValue));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(p => (p.title || '').toLowerCase().includes(q));
    }
    return list.slice(0, 30);
  }, [products, filterMode, filterValue, query]);

  async function addProduct(p) {
    setAdding(p.id);
    try {
      // shopify-products endpoint returns flattened fields: { image (url string),
      // price (string), variant_id, ... } — not the raw Shopify product shape.
      const r = await fetch(`${API}/api/videos/${video.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          shopify_product_id: String(p.id),
          shopify_variant_id: p.variant_id || null,
          product_name: p.title,
          product_handle: p.handle,
          price: p.price ? parseFloat(p.price) : null,
          compare_at_price: p.compare_at_price ? parseFloat(p.compare_at_price) : null,
          image_url: p.image || null,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        onTagAdded(data);
        setQuery('');
      }
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Search row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search products by name…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
        <select
          value={filterMode}
          onChange={e => { setFilterMode(e.target.value); setFilterValue(''); }}
          className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="all">All ({products.length})</option>
          <option value="collection">By collection ({collections.length})</option>
          <option value="tag">By tag ({allTags.length})</option>
        </select>
      </div>

      {/* Surface fetch errors so empty dropdowns aren't mysterious */}
      {fetchError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
          <strong>Couldn't load:</strong> {fetchError}
        </div>
      )}

      {/* Filter value selector */}
      {filterMode === 'collection' && (
        collections.length === 0 ? (
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
            No collections defined in your Shopify store yet. Add one in <a className="underline" target="_blank" rel="noreferrer" href="https://admin.shopify.com">Shopify admin → Products → Collections</a>.
          </div>
        ) : (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">Pick a collection… ({collections.length})</option>
            {collections.map(c => (
              <option key={c.id || c.handle} value={c.handle}>
                {c.title || c.handle}{c.products_count ? ` (${c.products_count})` : ''}
              </option>
            ))}
          </select>
        )
      )}
      {filterMode === 'tag' && (
        allTags.length === 0 ? (
          <div className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5">
            No product tags found. Add tags to products in Shopify (Products → pick one → Tags).
          </div>
        ) : (
          <select
            value={filterValue}
            onChange={e => setFilterValue(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="">Pick a tag… ({allTags.length})</option>
            {allTags.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )
      )}

      {/* Results */}
      {loading ? (
        <div className="text-xs text-gray-400 py-3">Loading products…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-gray-400 py-3">
          {products.length === 0
            ? 'No Shopify products loaded yet. If you just installed, wait a moment and reopen.'
            : 'No matching products. Try a different filter or clear the search.'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
          {filtered.map(p => {
            const already = existingTagIds.has(String(p.id));
            return (
              <button
                key={p.id}
                onClick={() => !already && addProduct(p)}
                disabled={already || adding === p.id}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {p.image ? (
                  <img src={p.image} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center text-base">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 truncate">{p.title}</div>
                  <div className="text-xs text-gray-500">
                    {p.price && <span>${p.price}</span>}
                    {p.product_type && <span> · {p.product_type}</span>}
                  </div>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {already ? 'Tagged' : adding === p.id ? '…' : 'Add'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Widget editor (create / edit a named story or carousel) ─────────────────
function WidgetEditor({ widget, defaultType, videos, apiKey, merchantId, onSave, onClose, createWidget }) {
  const isNew = !widget;
  const [name, setName] = useState(widget?.name || '');
  const [type, setType] = useState(widget?.type || defaultType || 'stories');
  const [selectedIds, setSelectedIds] = useState(
    (widget?.video_widget_items || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(i => i.video_id)
  );
  const [saving, setSaving] = useState(false);
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  function toggleVideo(id) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function onDragStart(i) { dragItem.current = i; }
  function onDragEnter(i) { dragOver.current = i; }
  function onDragEnd() {
    if (dragItem.current === null || dragOver.current === null) return;
    const next = [...selectedIds];
    const [moved] = next.splice(dragItem.current, 1);
    next.splice(dragOver.current, 0, moved);
    setSelectedIds(next);
    dragItem.current = null;
    dragOver.current = null;
  }

  function moveVideo(i, dir) {
    const next = [...selectedIds];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSelectedIds(next);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    let widgetId = widget?.id;
    if (isNew) {
      const data = await createWidget(name.trim(), type);
      widgetId = data.id;
      await fetch(`${API}/api/video-widgets/${widgetId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: selectedIds }),
      });
      onSave({ ...data, video_widget_items: selectedIds.map((vid, i) => ({ video_id: vid, sort_order: i })) });
    } else {
      await Promise.all([
        fetch(`${API}/api/video-widgets/${widgetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), type }),
        }),
        fetch(`${API}/api/video-widgets/${widgetId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_ids: selectedIds }),
        }),
      ]);
      onSave({ ...widget, name: name.trim(), type, video_widget_items: selectedIds.map((vid, i) => ({ video_id: vid, sort_order: i })) });
    }
    setSaving(false);
    onClose();
  }

  const selectedVideos = selectedIds.map(id => videos.find(v => v.id === id)).filter(Boolean);
  const unselected = videos.filter(v => !selectedIds.includes(v.id));

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90dvh' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">{isNew ? 'Create Widget' : 'Edit Widget'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Pick videos and set their display order</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Name + type */}
          <div className="px-6 pt-5 pb-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Widget Name</label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Summer Collection, Best Sellers..."
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">Display Type</label>
              <div className="flex gap-2">
                {[['stories', '⭕ Stories', 'Circular bubbles'], ['carousel', '▦ Carousel', 'Horizontal scroll cards'], ['feed', '▤ Feed', 'Full-screen button']].map(([val, label, sub]) => (
                  <button key={val} onClick={() => setType(val)}
                    className={`flex-1 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${type === val ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}>
                    <p className={`text-xs font-semibold ${type === val ? 'text-indigo-700' : 'text-gray-700'}`}>{label}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Selected videos — drag to reorder (desktop) or up/down arrows (mobile) */}
          {selectedVideos.length > 0 && (
            <div className="px-6 pb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                In this widget ({selectedVideos.length}) · drag or use arrows to reorder
              </p>
              <div className="flex gap-2 flex-wrap">
                {selectedVideos.map((v, i) => (
                  <div
                    key={v.id}
                    draggable
                    onDragStart={() => onDragStart(i)}
                    onDragEnter={() => onDragEnter(i)}
                    onDragEnd={onDragEnd}
                    onDragOver={e => e.preventDefault()}
                    className="relative w-20 flex-shrink-0 cursor-grab active:cursor-grabbing group"
                  >
                    <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-black">
                      <video src={v.s3_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors" />
                      <div className="absolute top-1 left-1 w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                        {i + 1}
                      </div>
                      <button
                        onClick={() => toggleVideo(v.id)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-500 transition-colors"
                      >×</button>
                    </div>
                    <p className="text-[10px] text-gray-500 truncate mt-1">{v.title || 'Untitled'}</p>
                    {/* Up/down arrows for mobile reorder */}
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => moveVideo(i, -1)}
                        disabled={i === 0}
                        className="flex-1 text-[10px] bg-gray-100 hover:bg-gray-200 disabled:opacity-30 rounded py-0.5 text-center transition-colors"
                      >↑</button>
                      <button
                        onClick={() => moveVideo(i, 1)}
                        disabled={i === selectedVideos.length - 1}
                        className="flex-1 text-[10px] bg-gray-100 hover:bg-gray-200 disabled:opacity-30 rounded py-0.5 text-center transition-colors"
                      >↓</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="h-px bg-gray-100 mx-6" />

          {/* All videos picker */}
          <div className="px-6 pt-4 pb-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {unselected.length > 0 ? `Add Videos (${unselected.length} available)` : 'All videos selected'}
            </p>
            {videos.length === 0 ? (
              <p className="text-sm text-gray-400">No videos uploaded yet. Upload videos in the Library tab first.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {unselected.map(v => (
                  <button
                    key={v.id}
                    onClick={() => toggleVideo(v.id)}
                    className="relative w-20 flex-shrink-0 group text-left"
                  >
                    <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-black border-2 border-transparent group-hover:border-indigo-400 transition-all">
                      <video src={v.s3_url} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" muted playsInline preload="metadata" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm">+</div>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500 truncate mt-1">{v.title || 'Untitled'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl py-2.5 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="flex-1 bg-indigo-600 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving...' : isNew ? `Create Widget` : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Widget row (table) ───────────────────────────────────────────────────────
function WidgetRow({ widget, apiKey, videos, onEdit, onDelete, onToggleActive }) {
  const [copied, setCopied] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const items = (widget.video_widget_items || []).sort((a, b) => a.sort_order - b.sort_order);
  const previewVideos = items.slice(0, 3).map(i => videos.find(v => v.id === i.video_id)).filter(Boolean);
  const typeLabel = { stories: 'Stories', carousel: 'Carousel', feed: 'Feed' }[widget.type] || widget.type;
  const typeBg = { stories: 'bg-purple-100 text-purple-700', carousel: 'bg-blue-100 text-blue-700', feed: 'bg-emerald-100 text-emerald-700' }[widget.type] || 'bg-gray-100 text-gray-600';
  const isActive = widget.is_active !== false;

  const embedSnippet = `<script src="https://botiga-api-two.vercel.app/video.js" data-key="${apiKey}"></script>`;

  function copy() {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-4">
        {/* Preview thumbnails */}
        <div className="flex gap-1 flex-shrink-0">
          {previewVideos.length > 0 ? previewVideos.map((v, i) => (
            <div key={v.id} className="relative w-10 aspect-[9/16] rounded-lg overflow-hidden bg-black">
              <video src={v.s3_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            </div>
          )) : <div className="w-10 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs">–</div>}
        </div>

        {/* Name + type */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{widget.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBg}`}>{typeLabel}</span>
            <span className="text-xs text-gray-400">{items.length} video{items.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Visibility toggle */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onToggleActive(widget.id, !isActive)}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${isActive ? 'bg-indigo-600' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-600' : 'text-gray-400'}`}>{isActive ? 'Visible' : 'Hidden'}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 flex-shrink-0">
          <button onClick={() => setShowEmbed(p => !p)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg transition-colors">Embed</button>
          <button onClick={onEdit} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors font-semibold">✏️ Edit Videos</button>
          <button onClick={onDelete} className="text-xs bg-red-50 hover:bg-red-100 text-red-500 px-2.5 py-1.5 rounded-lg transition-colors">✕</button>
        </div>
      </div>

      {/* Embed code expandable */}
      {showEmbed && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-2">Add this once to your Shopify theme — all active story collections will appear automatically:</p>
          <div className="bg-gray-900 rounded-xl p-3 flex items-start gap-2">
            <code className="text-[11px] text-emerald-400 flex-1 break-all leading-relaxed">{embedSnippet}</code>
            <button onClick={copy} className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${copied ? 'bg-emerald-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}>
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const WIDGET_TYPES = [
  { type: 'stories', icon: '⭕', label: 'Story Carousel', desc: 'Instagram-style circles. Tap to watch.' },
  { type: 'carousel', icon: '▦', label: 'Video Carousel', desc: 'Horizontal scroll of video cards.' },
  { type: 'feed', icon: '▤', label: 'Floating Feed', desc: 'Full-screen video feed button.' },
];

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VideosPage() {
  const [videos, setVideos] = useState([]);
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState(null);
  const [openVideoId, setOpenVideoId] = useState(null);
  const [shopifyDomain, setShopifyDomain] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [shopHandle, setShopHandle] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
  // Background auto-tag continuation. If onboarding was abandoned mid-tagging
  // (or the merchant landed here with un-analyzed videos for any reason), we
  // quietly finish the job in 5-video chunks and refresh the grid as it goes.
  const [bgTagRemaining, setBgTagRemaining] = useState(0);
  const bgTagFiredRef = useRef(false);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);
      const [videosRes, merchantRes, widgetsRes] = await Promise.all([
        fetch(`${API}/api/merchants/${user.id}/videos`),
        fetch(`${API}/api/merchants/${user.id}`),
        fetch(`${API}/api/merchants/${user.id}/video-widgets`),
      ]);
      let initialVideos = [];
      if (videosRes.ok) {
        initialVideos = await videosRes.json();
        setVideos(initialVideos);
      }
      if (widgetsRes.ok) setWidgets(await widgetsRes.json());
      if (merchantRes.ok) {
        const m = await merchantRes.json();
        setShopifyDomain(m.shopify_domain || null);
        setApiKey(m.api_key || null);
        setShopHandle(m.shop_handle || null);
      }
      setLoading(false);

      // Kick off background tagging if there are unanalyzed videos.
      const untagged = initialVideos.filter(v => !v.analyzed_at).length;
      if (untagged > 0 && !bgTagFiredRef.current) {
        bgTagFiredRef.current = true;
        setBgTagRemaining(untagged);
        runBackgroundTagging(user.id);
      }
    }

    async function runBackgroundTagging(uid) {
      let safety = 30;
      while (safety-- > 0) {
        try {
          const res = await fetch(`${API}/api/merchants/${uid}/videos/auto-tag-tick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunk_size: 5 }),
          });
          if (!res.ok) break;
          const t = await res.json();
          // Refresh the grid after each chunk so freshly-tagged videos light up
          const vRes = await fetch(`${API}/api/merchants/${uid}/videos`);
          if (vRes.ok) {
            const fresh = await vRes.json();
            setVideos(fresh);
          }
          setBgTagRemaining(t.remaining ?? 0);
          if (!t.has_more) break;
        } catch {
          break;
        }
      }
      setBgTagRemaining(0);
    }

    load();
  }, []);

  function handleUploaded(video) {
    setVideos(prev => [{ ...video, video_product_tags: [] }, ...prev]);
  }

  async function handleDelete(videoId) {
    const res = await fetch(`${API}/api/videos/${videoId}`, { method: 'DELETE' });
    if (res.ok) setVideos(prev => prev.filter(v => v.id !== videoId));
  }

  async function handleToggleStatus(videoId, status) {
    await fetch(`${API}/api/videos/${videoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, status } : v));
  }

  function handleTagsUpdated(videoId, tags) {
    setVideos(prev => prev.map(v => v.id === videoId ? { ...v, video_product_tags: tags } : v));
  }

  async function handleDeleteWidget(widgetId) {
    if (!confirm('Delete this widget?')) return;
    await fetch(`${API}/api/video-widgets/${widgetId}`, { method: 'DELETE' });
    setWidgets(prev => prev.filter(w => w.id !== widgetId));
  }

  async function handleToggleActive(widgetId, isActive) {
    await fetch(`${API}/api/video-widgets/${widgetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive }),
    });
    setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, is_active: isActive } : w));
  }

  function handleWidgetSaved(saved) {
    setWidgets(prev => {
      const exists = prev.find(w => w.id === saved.id);
      return exists ? prev.map(w => w.id === saved.id ? saved : w) : [saved, ...prev];
    });
  }

  async function createWidget(name, type) {
    const res = await fetch(`${API}/api/merchants/${merchantId}/video-widgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type }),
    });
    return res.json();
  }

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-10">

      {/* Background auto-tag continuation indicator. Only visible while
          unanalyzed videos remain — quietly finishes onboarding's tagging job. */}
      {bgTagRemaining > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-pink-50 border border-indigo-100 rounded-xl text-sm">
          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-indigo-900">
            Auto-tagging <strong>{bgTagRemaining}</strong> video{bgTagRemaining === 1 ? '' : 's'} in the background — they'll appear tagged in a moment.
          </span>
        </div>
      )}

      {/* ── Create Widget ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Create Widget</h2>
        <p className="text-sm text-gray-500 mb-4">Choose a widget type to showcase your shoppable videos.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {WIDGET_TYPES.map(({ type, icon, label, desc }) => (
            <button
              key={type}
              onClick={() => setEditingWidget({ _new: true, _type: type })}
              className="group bg-white border border-gray-200 hover:border-indigo-400 hover:shadow-md rounded-2xl p-5 text-left transition-all"
            >
              <div className="text-2xl mb-3">{icon}</div>
              <p className="font-semibold text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">{label}</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{desc}</p>
              <div className="mt-4 text-xs font-semibold text-indigo-600 group-hover:underline">Create →</div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Manage Widgets ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Manage Widgets</h2>
            <p className="text-sm text-gray-500">Toggle visibility to show or hide on your store.</p>
          </div>
        </div>

        {widgets.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center">
            <p className="text-sm text-gray-500">No widgets yet. Create one above to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {widgets.map(widget => (
              <WidgetRow
                key={widget.id}
                widget={widget}
                apiKey={apiKey}
                videos={videos}
                onEdit={() => setEditingWidget(widget)}
                onDelete={() => handleDeleteWidget(widget.id)}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Shop URL hero — the link merchants share ────────────────────── */}
      {shopHandle && <ShopHero shopHandle={shopHandle} />}

      {/* ── Video Library ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
          <h2 className="text-lg font-bold text-gray-900">Video Library</h2>
          <div className="flex gap-2 flex-wrap">
            {merchantId && (
              <PreviewWithShareButtons merchantId={merchantId} />
            )}
            {merchantId && (
              <OneClickAutoImport
                merchantId={merchantId}
                onImported={payload => {
                  // Two call shapes: legacy { array of new videos } from manual modal,
                  // or new { replace: true, videos: [...] } from auto-import full refetch.
                  if (payload && payload.replace && Array.isArray(payload.videos)) {
                    setVideos(payload.videos);
                  } else if (Array.isArray(payload) && payload.length > 0) {
                    setVideos(prev => [...payload.map(v => ({ ...v, video_product_tags: [] })), ...prev]);
                  }
                }}
              />
            )}
            {merchantId && (
              <InstagramImporter
                merchantId={merchantId}
                onImported={payload => {
                  // Two call shapes: legacy { array of new videos } from manual modal,
                  // or new { replace: true, videos: [...] } from auto-import full refetch.
                  if (payload && payload.replace && Array.isArray(payload.videos)) {
                    setVideos(payload.videos);
                  } else if (Array.isArray(payload) && payload.length > 0) {
                    setVideos(prev => [...payload.map(v => ({ ...v, video_product_tags: [] })), ...prev]);
                  }
                }}
              />
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4">One-click auto-import from your saved Instagram, or pick specific reels manually.</p>

        {merchantId && (
          <div className="mb-6">
            <UploadZone merchantId={merchantId} onUploaded={handleUploaded} />
          </div>
        )}

        {videos.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No videos yet. Upload your first one above.</p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">{videos.length} video{videos.length !== 1 ? 's' : ''}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {videos.map(video => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onOpen={v => setOpenVideoId(v.id)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Video detail drawer — opens on tile click */}
      {openVideoId && (() => {
        const v = videos.find(x => x.id === openVideoId);
        if (!v) return null;
        return (
          <VideoDetailDrawer
            video={v}
            merchantId={merchantId}
            shopifyDomain={shopifyDomain}
            onClose={() => setOpenVideoId(null)}
            onTagsUpdated={handleTagsUpdated}
            onDelete={handleDelete}
            onToggleStatus={handleToggleStatus}
          />
        );
      })()}

      {/* Widget editor modal */}
      {editingWidget && (
        <WidgetEditor
          widget={editingWidget._new ? null : editingWidget}
          defaultType={editingWidget._type}
          videos={videos}
          apiKey={apiKey}
          merchantId={merchantId}
          onSave={handleWidgetSaved}
          onClose={() => setEditingWidget(null)}
          createWidget={createWidget}
        />
      )}
    </div>
  );
}
