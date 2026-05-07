'use client';
import { useState } from 'react';
import { extractFrames } from './extractFrames';
import ProductReviewCard from './ProductReviewCard';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://botiga-api-two.vercel.app';

// AI auto-tag flow — full review screen + Create All button.
// Shared between the grid page (/dashboard/videos) and the vertical
// scroll editor (/dashboard/videos/preview) so the experience is
// identical in both surfaces.
//
// Flow: idle → analysing → review (editable product cards with
// confidence + price + sizes) → creating → done.
//
// Props:
//   video         — { id, s3_url, thumbnail_url, title }
//   merchantId    — UUID
//   onTagsUpdated — (videoId, tagsOrFn) => void called after each draft is created
//   onClose       — () => void to dismiss the modal
export default function AiTagger({ video, merchantId, onTagsUpdated, onClose }) {
  const [step, setStep] = useState('idle');     // idle | analysing | review | creating | done
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]); // editable detected products
  const [results, setResults] = useState([]);   // created products with admin URLs

  async function run() {
    setStep('analysing');
    setError(null);
    let frames = [];
    if (video.s3_url) frames = await extractFrames(video.s3_url);
    const body = frames.length
      ? { frames }
      : video.thumbnail_url ? { thumbnail_url: video.thumbnail_url } : null;
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
          if (data.tag) onTagsUpdated && onTagsUpdated(video.id, t => [...(t || []), data.tag]);
        }
      } catch (err) { /* per-product errors surface in results */ }
    }
    setResults(created);
    setStep('done');
  }

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

          {step === 'analysing' && (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-800">Identifying products in your video…</p>
              <p className="text-xs text-gray-400 mt-1">5–10 seconds</p>
            </div>
          )}

          {step === 'creating' && (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-gray-800">Creating {readyCount} Shopify draft{readyCount !== 1 ? 's' : ''}…</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-xl p-4">
              {error}
              <button onClick={() => { setError(null); setStep('idle'); }} className="block mt-2 text-xs text-red-500 underline">Try again</button>
            </div>
          )}

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

        {step === 'review' && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <button onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-700">Cancel</button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{readyCount} of {products.length} ready</span>
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
            <button onClick={onClose} className="w-full bg-gray-900 text-white text-sm font-semibold rounded-xl py-2.5 hover:bg-gray-800 transition-colors">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
