'use client';

import { useRouter } from 'next/navigation';

export default function ProductCard({ product }) {
  const router = useRouter();
  const image = (product.images || [])[0] || null;
  const maxOff = product.max_discount_pct || 20;
  const floorPrice = Math.round(product.price * (1 - maxOff / 100));
  const savings = product.price - floorPrice;

  return (
    <div
      onClick={() => router.push(`/product/${product.id}`)}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all group"
    >
      {/* Image */}
      <div className="relative aspect-square bg-gray-50 overflow-hidden">
        {image ? (
          <img src={image} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-gray-200">🛍️</div>
        )}
        {product.is_sponsored && (
          <div className="absolute top-2 left-2 bg-amber-400 text-amber-900 text-xs font-bold px-2 py-0.5 rounded-full">Sponsored</div>
        )}
        <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          Negotiate
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="text-xs text-gray-400 mb-1">{product.store_name || product.vendor}</div>
        <div className="font-semibold text-gray-900 text-sm leading-snug mb-3 line-clamp-2">{product.title}</div>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-lg font-bold text-gray-900">${product.price}</span>
            {product.compare_at_price && product.compare_at_price > product.price && (
              <span className="text-xs text-gray-400 line-through ml-1.5">${product.compare_at_price}</span>
            )}
          </div>
          <div className="text-xs text-green-600 font-semibold">
            Save up to ${savings}
          </div>
        </div>
      </div>
    </div>
  );
}
