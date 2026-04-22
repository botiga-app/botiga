'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Nav from '../../../components/Nav';
import NegotiateModal from '../../../components/NegotiateModal';
import { API_BASE } from '../../../lib/api';

async function fetchProduct(id) {
  const res = await fetch(`${API_BASE}/api/marketplace/search?q=*&limit=1&offset=0`, {
    headers: { 'Content-Type': 'application/json' },
  });
  // Fallback: fetch directly from supabase via search — we'll use a direct product fetch endpoint below
  return null;
}

export default function ProductPage() {
  const { id } = useParams();
  const router = useRouter();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [negotiating, setNegotiating] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);

  useEffect(() => {
    // Fetch product from the search endpoint by ID
    fetch(`${API_BASE}/api/marketplace/product/${id}`)
      .then(r => r.json())
      .then(data => { setProduct(data.product); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  // Handle post-auth negotiation intent
  useEffect(() => {
    if (product && typeof window !== 'undefined') {
      const savedId = sessionStorage.getItem('btg_negotiate_product');
      if (savedId === product.id) {
        sessionStorage.removeItem('btg_negotiate_product');
        sessionStorage.removeItem('btg_after_auth');
        setNegotiating(true);
      }
    }
  }, [product]);

  if (loading) return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
      </div>
    </div>
  );

  if (!product) return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center text-gray-400">Product not found</div>
    </div>
  );

  const images = product.images || [];
  const maxOff = product.max_discount_pct || 20;
  const floorEst = Math.round(product.price * (1 - maxOff / 100));
  const variants = product.variants ? (typeof product.variants === 'string' ? JSON.parse(product.variants) : product.variants) : [];

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="max-w-5xl mx-auto px-4 py-10 w-full">
        <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1">
          ← Back
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Images */}
          <div>
            <div className="aspect-square rounded-2xl bg-gray-50 overflow-hidden mb-3">
              {images[selectedImage] ? (
                <img src={images[selectedImage]} alt={product.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl text-gray-200">🛍️</div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${i === selectedImage ? 'border-purple-500' : 'border-transparent'}`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">{product.store_name || product.vendor}</div>
              <h1 className="text-2xl font-bold text-gray-900 leading-snug mb-2">{product.title}</h1>

              <div className="flex items-baseline gap-3 mb-1">
                <span className="text-3xl font-extrabold text-gray-900">${product.price}</span>
                {product.compare_at_price && product.compare_at_price > product.price && (
                  <span className="text-base text-gray-400 line-through">${product.compare_at_price}</span>
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
                🤝 Negotiate down to ~${floorEst} ({maxOff}% off possible)
              </div>
            </div>

            {variants.length > 1 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-2">Options</div>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v, i) => (
                    <span key={i} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700">{v.title}</span>
                  ))}
                </div>
              </div>
            )}

            {product.description && (
              <div className="text-sm text-gray-500 leading-relaxed border-t border-gray-100 pt-4">
                {product.description.slice(0, 300)}{product.description.length > 300 ? '...' : ''}
              </div>
            )}

            <button
              onClick={() => setNegotiating(true)}
              className="mt-2 w-full bg-purple-600 text-white font-bold py-4 rounded-2xl hover:bg-purple-700 transition-colors text-base"
            >
              🤝 Make an offer
            </button>
            <div className="text-xs text-center text-gray-400">AI negotiates on your behalf · Deal locked for 48h</div>
          </div>
        </div>
      </main>

      {negotiating && (
        <NegotiateModal product={product} onClose={() => setNegotiating(false)} />
      )}
    </div>
  );
}
