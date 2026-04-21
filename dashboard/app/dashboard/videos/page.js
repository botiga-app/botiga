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
function VideoCard({ video, merchantId, shopifyDomain, onDelete, onTagsUpdated, onToggleStatus }) {
  const [taggerOpen, setTaggerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(video.title || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
            {confirmDelete ? (
              <>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete(video.id);
                    setDeleting(false);
                    setConfirmDelete(false);
                  }}
                  className="text-xs font-semibold bg-red-500 text-white rounded-lg px-3 py-2 hover:bg-red-600 transition-colors"
                  disabled={deleting}
                >
                  {deleting ? '...' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs font-medium bg-gray-100 text-gray-600 rounded-lg px-2 py-2 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs font-medium bg-red-50 text-red-500 rounded-lg px-3 py-2 hover:bg-red-100 transition-colors"
                title="Delete video"
              >
                🗑
              </button>
            )}
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

          {/* Selected videos — drag to reorder */}
          {selectedVideos.length > 0 && (
            <div className="px-6 pb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Selected · drag to reorder ({selectedVideos.length})
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
          <button onClick={onEdit} className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg transition-colors font-medium">Edit</button>
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
  const [shopifyDomain, setShopifyDomain] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
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
      if (videosRes.ok) setVideos(await videosRes.json());
      if (widgetsRes.ok) setWidgets(await widgetsRes.json());
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

      {/* ── Video Library ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Video Library</h2>
        <p className="text-sm text-gray-500 mb-4">Upload videos and tag products to make them shoppable.</p>

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
      </section>

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
