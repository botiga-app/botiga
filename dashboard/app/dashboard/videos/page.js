'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '../../../lib/supabase';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

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

// ─── Product tagger ───────────────────────────────────────────────────────────
function ProductTagger({ video, merchantId, shopifyDomain, onClose, onTagsUpdated }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [tags, setTags] = useState(video.video_product_tags || []);
  const [searching, setSearching] = useState(false);

  async function search(q) {
    if (!q.trim() || !shopifyDomain) return;
    setSearching(true);
    try {
      // Search Shopify products via our API proxy
      const res = await fetch(`${API}/api/merchants/${merchantId}/shopify-products?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    } catch {}
    setSearching(false);
  }

  useEffect(() => {
    const t = setTimeout(() => search(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  async function addTag(product) {
    const res = await fetch(`${API}/api/videos/${video.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant_id: merchantId,
        shopify_product_id: String(product.id),
        product_name: product.title,
        product_handle: product.handle,
        price: parseFloat(product.variants?.[0]?.price || 0),
        compare_at_price: parseFloat(product.variants?.[0]?.compare_at_price || 0) || null,
        image_url: product.image?.src || null,
      }),
    });
    if (res.ok) {
      const tag = await res.json();
      const updated = [...tags, tag];
      setTags(updated);
      onTagsUpdated(video.id, updated);
    }
  }

  async function removeTag(tagId) {
    await fetch(`${API}/api/videos/${video.id}/tags/${tagId}`, { method: 'DELETE' });
    const updated = tags.filter(t => t.id !== tagId);
    setTags(updated);
    onTagsUpdated(video.id, updated);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Tag Products</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{video.title || 'Untitled video'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tagged products */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tagged ({tags.length})</p>
              {tags.map(tag => (
                <div key={tag.id} className="flex items-center gap-3 bg-indigo-50 rounded-xl px-3 py-2">
                  {tag.image_url && <img src={tag.image_url} className="w-8 h-8 rounded-lg object-cover" alt="" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tag.product_name}</p>
                    {tag.price && <p className="text-xs text-gray-500">${tag.price}</p>}
                  </div>
                  <button onClick={() => removeTag(tag.id)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Search */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Search Products</p>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by product name or SKU..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {searching && <p className="text-xs text-gray-400 text-center">Searching...</p>}

          {results.length > 0 && (
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {results.map(p => {
                const alreadyTagged = tags.some(t => t.shopify_product_id === String(p.id));
                return (
                  <button key={p.id} disabled={alreadyTagged}
                    onClick={() => addTag(p)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                      alreadyTagged ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'
                    }`}
                  >
                    {p.image?.src && <img src={p.image.src} className="w-8 h-8 rounded-lg object-cover" alt="" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                      <p className="text-xs text-gray-400">${p.variants?.[0]?.price}</p>
                    </div>
                    {alreadyTagged
                      ? <span className="text-xs text-indigo-500">Tagged</span>
                      : <span className="text-xs text-gray-400">+ Tag</span>
                    }
                  </button>
                );
              })}
            </div>
          )}

          {!shopifyDomain && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
              Connect your Shopify store in Settings to search products.
            </p>
          )}
        </div>

        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full bg-indigo-600 text-white text-sm font-medium rounded-xl py-2.5 hover:bg-indigo-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Video card ───────────────────────────────────────────────────────────────
function VideoCard({ video, merchantId, shopifyDomain, onDelete, onTagsUpdated, onToggleStatus }) {
  const [taggerOpen, setTaggerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(video.title || '');

  async function saveTitle() {
    setEditing(false);
    if (title === video.title) return;
    await fetch(`${API}/api/videos/${video.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  const tags = video.video_product_tags || [];
  const isActive = video.status === 'active';

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden group">
        {/* Video preview */}
        <div className="relative bg-black aspect-[9/16] max-h-64 overflow-hidden">
          <video
            src={video.s3_url}
            className="w-full h-full object-cover"
            muted playsInline
            onMouseEnter={e => e.target.play()}
            onMouseLeave={e => { e.target.pause(); e.target.currentTime = 0; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Status badge */}
          <div className="absolute top-2 left-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isActive ? 'bg-emerald-500 text-white' : 'bg-gray-500 text-white'
            }`}>
              {isActive ? 'Active' : 'Hidden'}
            </span>
          </div>

          {/* Stats */}
          <div className="absolute bottom-2 left-3 flex gap-3 text-white text-xs">
            <span>👁 {video.views_count || 0}</span>
            <span>❤️ {video.likes_count || 0}</span>
          </div>

          {/* Tag count */}
          <div className="absolute bottom-2 right-3">
            <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">
              {tags.length} product{tags.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Card body */}
        <div className="p-4 space-y-3">
          {/* Title */}
          {editing ? (
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => e.key === 'Enter' && saveTitle()}
              className="w-full text-sm font-medium border-b border-indigo-400 outline-none pb-0.5"
            />
          ) : (
            <p
              className="text-sm font-medium text-gray-900 truncate cursor-text"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {title || <span className="text-gray-400 italic">Untitled — click to name</span>}
            </p>
          )}

          {/* Tagged products preview */}
          {tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {tags.slice(0, 3).map(tag => (
                <span key={tag.id} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                  {tag.product_name}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-xs bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">+{tags.length - 3}</span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setTaggerOpen(true)}
              className="flex-1 text-xs font-medium bg-indigo-600 text-white rounded-lg py-2 hover:bg-indigo-700 transition-colors"
            >
              🏷 Tag Products
            </button>
            <button
              onClick={() => onToggleStatus(video.id, isActive ? 'inactive' : 'active')}
              className="text-xs font-medium bg-gray-100 text-gray-600 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors"
              title={isActive ? 'Hide video' : 'Show video'}
            >
              {isActive ? '👁' : '🚫'}
            </button>
            <button
              onClick={() => onDelete(video.id)}
              className="text-xs font-medium bg-red-50 text-red-500 rounded-lg px-3 py-2 hover:bg-red-100 transition-colors"
              title="Delete video"
            >
              🗑
            </button>
          </div>
        </div>
      </div>

      {taggerOpen && (
        <ProductTagger
          video={video}
          merchantId={merchantId}
          shopifyDomain={shopifyDomain}
          onClose={() => setTaggerOpen(false)}
          onTagsUpdated={onTagsUpdated}
        />
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VideosPage() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState(null);
  const [shopifyDomain, setShopifyDomain] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMerchantId(user.id);

      const [videosRes, merchantRes] = await Promise.all([
        fetch(`${API}/api/merchants/${user.id}/videos`),
        fetch(`${API}/api/merchants/${user.id}`),
      ]);

      if (videosRes.ok) setVideos(await videosRes.json());
      if (merchantRes.ok) {
        const m = await merchantRes.json();
        setShopifyDomain(m.shopify_domain || null);
        setApiKey(m.api_key || null);
      }
      setLoading(false);
    }
    load();
  }, []);

  function handleUploaded(video) {
    setVideos(prev => [{ ...video, video_product_tags: [] }, ...prev]);
  }

  async function handleDelete(videoId) {
    if (!confirm('Delete this video? This cannot be undone.')) return;
    await fetch(`${API}/api/videos/${videoId}`, { method: 'DELETE' });
    setVideos(prev => prev.filter(v => v.id !== videoId));
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

  const embedSnippet = apiKey
    ? `<script src="https://botiga-api-two.vercel.app/video.js" data-key="${apiKey}" data-mode="stories"></script>`
    : null;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-900">Shoppable Videos</h2>
        <p className="text-sm text-gray-500 mt-0.5">Upload videos, tag products, embed on your store. Customers watch, negotiate, and checkout without leaving.</p>
      </div>

      {/* Upload zone */}
      {merchantId && (
        <div className="mb-8">
          <UploadZone merchantId={merchantId} onUploaded={handleUploaded} />
        </div>
      )}

      {/* Embed snippet */}
      {embedSnippet && (
        <div className="mb-8 bg-gray-900 rounded-2xl p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Embed on your store</p>
          <code className="text-xs text-emerald-400 break-all">{embedSnippet}</code>
          <p className="text-xs text-gray-500 mt-2">Change <code className="text-gray-300">data-mode</code> to <code className="text-gray-300">stories</code>, <code className="text-gray-300">carousel</code>, or <code className="text-gray-300">feed</code></p>
        </div>
      )}

      {/* Video grid */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading videos...</div>
      ) : videos.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No videos yet. Upload your first one above.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{videos.length} video{videos.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-gray-400">Hover to preview · Click title to rename</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {videos.map(video => (
              <VideoCard
                key={video.id}
                video={video}
                merchantId={merchantId}
                shopifyDomain={shopifyDomain}
                onDelete={handleDelete}
                onToggleStatus={handleToggleStatus}
                onTagsUpdated={handleTagsUpdated}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
